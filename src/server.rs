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
#[cfg(not(feature = "dev-proxy"))]
use rust_embed::RustEmbed;
use serde::Serialize;
use tokio::sync::broadcast;

use crate::api;
use crate::retire;
use crate::review::Review;
use crate::root::ProjectRoot;

/// The reviewer's app, baked into the binary by `web/build`.
#[cfg(not(feature = "dev-proxy"))]
#[derive(RustEmbed)]
#[folder = "web/build"]
struct Assets;

/// Where `npm run dev` listens, for builds carrying the `dev-proxy` feature.
#[cfg(feature = "dev-proxy")]
const VITE: &str = "http://127.0.0.1:5273";

/// Long enough for a browser to start, short enough that a ticket read out of
/// the process table is worthless by the time anyone acts on it.
const TICKET_LIFE: Duration = Duration::from_secs(60);

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
    /// Unspent stand-ins for the token, each good once.
    tickets: Mutex<HashMap<String, Instant>>,
    last_activity: Mutex<Instant>,
}

impl App {
    pub fn touch(&self) {
        *self.last_activity.lock().unwrap() = Instant::now();
    }

    pub fn mint_ticket(&self) -> String {
        let ticket = random_hex(16);
        let mut tickets = self.tickets.lock().unwrap();
        tickets.retain(|_, issued| issued.elapsed() < TICKET_LIFE);
        tickets.insert(ticket.clone(), Instant::now());
        ticket
    }

    pub fn redeem(&self, ticket: &str) -> Option<String> {
        let issued = self.tickets.lock().unwrap().remove(ticket)?;
        (issued.elapsed() < TICKET_LIFE).then(|| self.token.clone())
    }

    pub fn announce(&self, kind: &'static str, id: &str) {
        let _ = self.events.send(Event {
            kind,
            id: id.to_string(),
        });
    }

    pub(crate) fn idle_for(&self) -> Duration {
        self.last_activity.lock().unwrap().elapsed()
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
        tickets: Mutex::new(HashMap::new()),
        last_activity: Mutex::new(Instant::now()),
    });

    tokio::spawn(retire::when_idle(app.clone()));
    axum::serve(listener, router(app)).await?;
    Ok(())
}

fn router(app: Arc<App>) -> Router {
    let guarded = Router::new()
        .route("/health", get(api::health))
        .route("/reviews", post(api::register))
        .route("/reviews/{id}", get(api::fetch))
        .route("/reviews/{id}/draft", put(api::keep_draft))
        .route("/reviews/{id}/submit", post(api::submit))
        .route("/reviews/{id}/cancel", post(api::cancel))
        .route("/reviews/{id}/result", get(api::result))
        .route("/events", get(api::events))
        .route("/shutdown", post(api::shutdown))
        .layer(middleware::from_fn_with_state(app.clone(), guard));

    // The one route a tab reaches before it holds the token.
    let unauthenticated = Router::new()
        .route("/exchange", post(api::exchange))
        .layer(middleware::from_fn_with_state(app.clone(), only_from_us));

    let api = guarded.merge(unauthenticated).with_state(app);
    Router::new().nest("/api", api).fallback(asset)
}

/// The daemon's token is the only thing standing between the reviewer's files
/// and anything else that can reach a loopback port.
async fn guard(State(app): State<Arc<App>>, request: Request, next: Next) -> Response {
    if !presents_token(&request, &app.token) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    only_from_us(State(app), request, next).await
}

async fn only_from_us(State(app): State<Arc<App>>, request: Request, next: Next) -> Response {
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
    // `EventSource` cannot carry a header, so the tab's stream — and only the
    // stream — may present the same secret in the query string.
    let from_query = request
        .uri()
        .path()
        .ends_with("/events")
        .then(|| {
            request.uri().query().and_then(|query| {
                query
                    .split('&')
                    .find_map(|pair| pair.strip_prefix("token="))
            })
        })
        .flatten();

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

#[cfg(not(feature = "dev-proxy"))]
async fn asset(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    embedded(path)
        .or_else(|| embedded("index.html"))
        .unwrap_or_else(|| {
            (StatusCode::NOT_FOUND, "the reviewer app was not built").into_response()
        })
}

#[cfg(not(feature = "dev-proxy"))]
fn embedded(path: &str) -> Option<Response> {
    let file = Assets::get(path)?;
    let mime = file.metadata.mimetype().to_string();
    Some(([(header::CONTENT_TYPE, mime)], file.data.into_owned()).into_response())
}

/// Hand the page straight through from Vite so a frontend edit is one refresh
/// away. The API keeps answering from this same origin, so nothing about
/// authentication changes between development and a real build.
#[cfg(feature = "dev-proxy")]
async fn asset(uri: Uri) -> Response {
    let target = format!("{VITE}{}", uri.path_and_query().map_or("/", |p| p.as_str()));
    let fetched = tokio::task::spawn_blocking(move || {
        let mut response = ureq::get(&target).call()?;
        let mime = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("text/html")
            .to_string();
        let status = response.status().as_u16();
        let body = response.body_mut().read_to_vec()?;
        Ok::<_, anyhow::Error>((status, mime, body))
    })
    .await;

    match fetched {
        Ok(Ok((status, mime, body))) => (
            StatusCode::from_u16(status).unwrap_or(StatusCode::OK),
            [(header::CONTENT_TYPE, mime)],
            body,
        )
            .into_response(),
        _ => (
            StatusCode::BAD_GATEWAY,
            format!("dev-proxy is on but nothing is serving {VITE} — run `npm run dev` in web/"),
        )
            .into_response(),
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
