//! A human's own read of one markdown file. A view registers nothing — no
//! Review, no outcome, no trace — so all the daemon does for it is vouch for
//! the file and hand back its bytes.

use std::fs;
use std::path::Path;
use std::sync::Arc;

use axum::Json;
use axum::extract::{Query, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::api::{ApiError, refused};
use crate::server::App;

#[derive(Deserialize)]
pub struct OpenRequest {
    pub path: String,
}

/// The one check every view funnels through — the same gate a Review passes.
/// Nothing is stored; the ticket is all that comes back, and it always comes
/// back, because a view never arrives in a tab that is already open.
pub async fn open(
    State(app): State<Arc<App>>,
    Json(body): Json<OpenRequest>,
) -> Result<Json<Value>, ApiError> {
    let absolute = app.root.resolve(Path::new(&body.path)).map_err(refused)?;
    Ok(Json(json!({
        "path": app.root.relative(&absolute),
        "ticket": app.mint_ticket(),
    })))
}

#[derive(Deserialize)]
pub struct ContentQuery {
    path: String,
}

/// The file's exact bytes — the daemon never parses markdown (ADR 0001). The
/// path arrives from the browser rather than the CLI, so it is checked again
/// here, against the root, before a byte leaves the daemon.
pub async fn content(
    State(app): State<Arc<App>>,
    Query(query): Query<ContentQuery>,
) -> Result<Response, ApiError> {
    let absolute = app
        .root
        .resolve(&app.root.path().join(&query.path))
        .map_err(refused)?;
    let bytes = fs::read(&absolute).map_err(|error| refused(error.into()))?;
    Ok((
        [(header::CONTENT_TYPE, "text/markdown; charset=utf-8")],
        bytes,
    )
        .into_response())
}
