use std::convert::Infallible;
use std::fs;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::task::{Context as TaskContext, Poll};
use std::time::Duration;

use axum::Json;
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::broadcast::error::RecvError;
use tokio_stream::Stream;
use tokio_stream::wrappers::BroadcastStream;

use crate::retire;
use crate::review::{Comment, Review};
use crate::server::{App, Event, random_hex};
use crate::submit::{self, Written, digest};

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({ "error": self.1 }))).into_response()
    }
}

fn refused(error: anyhow::Error) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, format!("{error:#}"))
}

fn no_such_review() -> ApiError {
    ApiError(StatusCode::NOT_FOUND, "no such review".to_string())
}

pub async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    Json(json!({
        "app": "mdvl",
        "root": app.root.path().to_string_lossy(),
        "viewers": app.viewers.load(Ordering::SeqCst),
    }))
}

#[derive(Deserialize)]
pub struct RegisterRequest {
    pub path: String,
}

pub async fn register(
    State(app): State<Arc<App>>,
    Json(body): Json<RegisterRequest>,
) -> Result<Json<Value>, ApiError> {
    let absolute = app.root.resolve(Path::new(&body.path)).map_err(refused)?;
    let content = fs::read_to_string(&absolute).map_err(|error| refused(error.into()))?;
    let id = format!("rv_{}", random_hex(4));
    let relative = app.root.relative(&absolute);
    let review = Review::new(
        id.clone(),
        absolute,
        relative,
        content.clone(),
        digest(&content),
        app.root.result_file(&id),
    );
    app.reviews.lock().unwrap().insert(id.clone(), review);

    // An open tab takes the new Review itself rather than having another opened at it.
    let watching = app.viewers.load(Ordering::SeqCst) > 0;
    if watching {
        app.announce("review", &id);
        return Ok(Json(json!({ "id": id })));
    }
    // A ticket is issued only when a browser still has to be opened, so its
    // presence is what tells the caller to open one.
    Ok(Json(json!({ "id": id, "ticket": app.mint_ticket() })))
}

#[derive(Deserialize)]
pub struct ExchangeRequest {
    pub ticket: String,
}

/// The tab trades the single-use ticket from its URL for the daemon's token.
/// Opening a browser puts the ticket in a command line every local user can
/// read; spending it once and expiring it in a minute does not make reading it
/// harmless, but it turns a secret that lasts as long as the daemon into a race
/// the reader has to win, and losing that race is visible to the human.
pub async fn exchange(
    State(app): State<Arc<App>>,
    Json(body): Json<ExchangeRequest>,
) -> Result<Json<Value>, ApiError> {
    match app.redeem(&body.ticket) {
        Some(token) => Ok(Json(json!({ "token": token }))),
        None => Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "that ticket is spent or expired".to_string(),
        )),
    }
}

pub async fn fetch(
    State(app): State<Arc<App>>,
    UrlPath(id): UrlPath<String>,
) -> Result<Json<Value>, ApiError> {
    let reviews = app.reviews.lock().unwrap();
    let review = reviews.get(&id).ok_or_else(no_such_review)?;
    Ok(Json(json!({
        "id": review.id,
        "path": review.relative,
        "content": review.working,
        "state": review.state,
        "draft": review.draft,
    })))
}

#[derive(Deserialize)]
pub struct DraftRequest {
    pub content: String,
    #[serde(default)]
    pub draft: Option<Value>,
}

/// Park the reviewer's work in progress so closing the tab does not cost it.
pub async fn keep_draft(
    State(app): State<Arc<App>>,
    UrlPath(id): UrlPath<String>,
    Json(body): Json<DraftRequest>,
) -> Result<StatusCode, ApiError> {
    let mut reviews = app.reviews.lock().unwrap();
    let review = reviews.get_mut(&id).ok_or_else(no_such_review)?;
    review.working = body.content;
    review.draft = body.draft;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct SubmitRequest {
    pub content: String,
    #[serde(default)]
    pub comments: Vec<Comment>,
    #[serde(default)]
    pub overall: String,
}

pub async fn submit(
    State(app): State<Arc<App>>,
    UrlPath(id): UrlPath<String>,
    Json(body): Json<SubmitRequest>,
) -> Result<Json<Value>, ApiError> {
    let answer = {
        let mut reviews = app.reviews.lock().unwrap();
        let review = reviews.get_mut(&id).ok_or_else(no_such_review)?;
        if review.state.is_terminal() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "this review has already finished".to_string(),
            ));
        }
        match submit::apply(&review.absolute, &review.start_sha, &body.content).map_err(refused)? {
            Written::Applied => {
                review.submit(body.content, body.comments, body.overall);
                json!({ "status": "submitted" })
            }
            Written::Conflict(copy) => {
                let copy = app.root.relative(&copy);
                review.conflict(body.content, copy.clone());
                json!({ "status": "conflict", "conflict_copy": copy })
            }
        }
    };
    app.announce("state", &id);
    retire::if_drained(&app);
    Ok(Json(answer))
}

pub async fn cancel(
    State(app): State<Arc<App>>,
    UrlPath(id): UrlPath<String>,
) -> Result<StatusCode, ApiError> {
    {
        let mut reviews = app.reviews.lock().unwrap();
        reviews.get_mut(&id).ok_or_else(no_such_review)?.cancel();
    }
    app.announce("state", &id);
    retire::if_drained(&app);
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct WaitFor {
    pub timeout: Option<u64>,
}

/// Holds the request open until the human finishes, or until the Agent's
/// patience runs out and it is told the Review is still pending.
pub async fn result(
    State(app): State<Arc<App>>,
    UrlPath(id): UrlPath<String>,
    Query(limit): Query<WaitFor>,
) -> Result<Json<Value>, ApiError> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(limit.timeout.unwrap_or(300));
    let mut changes = app.events.subscribe();
    let outcome = loop {
        let settled = {
            let reviews = app.reviews.lock().unwrap();
            let review = reviews.get(&id).ok_or_else(no_such_review)?;
            review.state.is_terminal().then(|| review.outcome())
        };
        if let Some(outcome) = settled {
            break outcome;
        }

        let give_up = tokio::select! {
            _ = tokio::time::sleep_until(deadline) => true,
            change = changes.recv() => matches!(change, Err(RecvError::Closed)),
        };
        if give_up {
            let reviews = app.reviews.lock().unwrap();
            break reviews.get(&id).ok_or_else(no_such_review)?.outcome();
        }
    };
    // Delivered over HTTP, so nothing may linger for a later wait. A pending
    // outcome was never persisted, so there is nothing to remove.
    let _ = fs::remove_file(app.root.result_file(&id));
    Ok(Json(outcome))
}

pub async fn events(State(app): State<Arc<App>>) -> impl IntoResponse {
    app.viewers.fetch_add(1, Ordering::SeqCst);
    let stream = ViewerStream {
        inner: BroadcastStream::new(app.events.subscribe()),
        app,
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

/// A connected tab. Counting these is how a second Review knows it can arrive
/// in the tab the reviewer already has open.
pub struct ViewerStream {
    inner: BroadcastStream<Event>,
    app: Arc<App>,
}

impl Drop for ViewerStream {
    fn drop(&mut self) {
        self.app.viewers.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Stream for ViewerStream {
    type Item = Result<SseEvent, Infallible>;

    fn poll_next(self: Pin<&mut Self>, cx: &mut TaskContext<'_>) -> Poll<Option<Self::Item>> {
        let this = self.get_mut();
        loop {
            return match Pin::new(&mut this.inner).poll_next(cx) {
                Poll::Ready(Some(Ok(event))) => Poll::Ready(Some(Ok(SseEvent::default()
                    .json_data(event)
                    .unwrap_or_default()))),
                // A tab that fell behind only needs the next event, not the missed ones.
                Poll::Ready(Some(Err(_))) => continue,
                Poll::Ready(None) => Poll::Ready(None),
                Poll::Pending => Poll::Pending,
            };
        }
    }
}

pub async fn shutdown(State(app): State<Arc<App>>) -> StatusCode {
    {
        let mut reviews = app.reviews.lock().unwrap();
        for review in reviews.values_mut() {
            review.cancel();
        }
    }
    // Let anyone waiting on a Review hear that it ended before the process goes.
    app.announce("state", "");
    tokio::spawn(async {
        tokio::time::sleep(Duration::from_millis(150)).await;
        std::process::exit(0);
    });
    StatusCode::NO_CONTENT
}
