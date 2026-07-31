use std::collections::HashMap;
use std::fs;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::Path;
use std::sync::atomic::AtomicUsize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, StatusCode, Uri, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use rust_embed::RustEmbed;
use serde::Serialize;
use tokio::sync::broadcast;

use crate::api;
use crate::review::{Review, State as ReviewState};
use crate::root::ProjectRoot;

/// The reviewer's app, baked into the binary by `web/build`.
#[derive(RustEmbed)]
#[folder = "web/build"]
struct Assets;

/// How long a daemon lingers with nothing to review before stepping aside.
const IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Serialize)]
pub struct Event {
    pub kind: &'static str,
    pub id: String,
}

pub struct App {
    pub root: ProjectRoot,
    pub token: String,
    pub port: u16,
    pub reviews: Mutex<HashMap<String, Review>>,
    pub events: broadcast::Sender<Event>,
    /// Open browser tabs, so a second Review can reuse one instead of opening another.
    pub viewers: AtomicUsize,
    last_activity: Mutex<Instant>,
}

impl App {
    pub fn touch(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    pub fn announce(&self, kind: &'static str, id: &str) {
        let _ = self.events.send(Event {
            kind,
            id: id.to_string(),
        });
    }

    fn idle_for(&self) -> Duration {
        self.last_activity.lock().unwrap().elapsed()
    }

    fn has_pending(&self) -> bool {
        self.reviews
            .lock()
            .unwrap()
            .values()
            .any(|review| review.state == ReviewState::Pending)
    }
}

pub async fn serve(root: ProjectRoot) -> Result<()> {
    let state_dir = root.state_dir();
    fs::create_dir_all(&state_dir).context("could not create .mdvl")?;
    fs::write(state_dir.join(".gitignore"), "*\n").context("could not write .mdvl/.gitignore")?;

    let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .context("could not bind a local port")?;
    let port = listener.local_addr()?.port();
    let token = random_hex(32);
    write_daemon_file(&state_dir, port, &token)?;

    let (events, _) = broadcast::channel(64);
    let app = Arc::new(App {
        root,
        token,
        port,
        reviews: Mutex::new(HashMap::new()),
        events,
        viewers: AtomicUsize::new(0),
        last_activity: Mutex::new(Instant::now()),
    });

    tokio::spawn(retire_when_idle(app.clone()));
    axum::serve(listener, router(app)).await?;
    Ok(())
}

fn router(app: Arc<App>) -> Router {
    let api = Router::new()
        .route("/health", get(api::health))
        .route("/reviews", post(api::register))
        .route("/reviews/{id}", get(api::fetch))
        .route("/reviews/{id}/content", put(api::save_content))
        .route("/reviews/{id}/submit", post(api::submit))
        .route("/reviews/{id}/cancel", post(api::cancel))
        .route("/reviews/{id}/result", get(api::result))
        .route("/events", get(api::events))
        .route("/shutdown", post(api::shutdown))
        .layer(middleware::from_fn_with_state(app.clone(), guard))
        .with_state(app);

    Router::new().nest("/api", api).fallback(asset)
}

/// The daemon's token is the only thing standing between the reviewer's files
/// and anything else that can reach a loopback port.
async fn guard(State(app): State<Arc<App>>, request: Request, next: Next) -> Response {
    if !presents_token(&request, &app.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if !addressed_to_us(request.headers(), app.port) {
        return StatusCode::FORBIDDEN.into_response();
    }
    app.touch();
    next.run(request).await
}

fn presents_token(request: &Request, expected: &str) -> bool {
    let from_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    // `EventSource` cannot carry a header, so the tab's stream presents the same
    // secret in the query string instead.
    let from_query = request.uri().query().and_then(|query| {
        query
            .split('&')
            .find_map(|pair| pair.strip_prefix("token="))
    });

    let Some(offered) = from_header.or(from_query) else {
        return false;
    };
    let (offered, expected) = (offered.as_bytes(), expected.as_bytes());
    offered.len() == expected.len()
        && offered
            .iter()
            .zip(expected)
            .fold(0u8, |differences, (a, b)| differences | (a ^ b))
            == 0
}

/// A page on another origin, or a name that resolves here by way of DNS
/// rebinding, is not the reviewer's tab.
fn addressed_to_us(headers: &HeaderMap, port: u16) -> bool {
    let read = |name: header::HeaderName| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string)
    };
    let origin_belongs = match read(header::ORIGIN) {
        Some(origin) => origin == format!("http://127.0.0.1:{port}"),
        None => true,
    };
    let host_belongs = match read(header::HOST) {
        Some(host) => host == format!("127.0.0.1:{port}") || host == format!("localhost:{port}"),
        None => true,
    };
    origin_belongs && host_belongs
}

async fn asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    embedded(path)
        .or_else(|| embedded("index.html"))
        .unwrap_or_else(|| {
            (StatusCode::NOT_FOUND, "the reviewer app was not built").into_response()
        })
}

fn embedded(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = file.metadata.mimetype().to_string();
    Some(([(header::CONTENT_TYPE, mime)], file.data.into_owned()).into_response())
}

async fn retire_when_idle(app: Arc<App>) {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        if !app.has_pending() && app.idle_for() > IDLE_LIMIT {
            std::process::exit(0);
        }
    }
}

fn write_daemon_file(state_dir: &Path, port: u16, token: &str) -> Result<()> {
    let body = serde_json::json!({ "port": port, "token": token, "pid": std::process::id() });
    let path = state_dir.join("daemon.json");
    let _ = fs::remove_file(&path);

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .with_context(|| format!("{} could not be written", path.display()))?;
    std::io::Write::write_all(&mut file, body.to_string().as_bytes())?;
    Ok(())
}

pub fn random_hex(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the operating system has randomness");
    buffer.iter().map(|byte| format!("{byte:02x}")).collect()
}
