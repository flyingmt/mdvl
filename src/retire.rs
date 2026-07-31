//! When the daemon steps aside. A daemon nobody uses retires on its own, and
//! a daemon whose Reviews no longer need it — none open, every outcome safely
//! on disk — exits once its answers have landed.

use std::sync::Arc;
use std::time::Duration;

use crate::server::App;

/// How long a daemon lingers with nothing to review before stepping aside.
const IDLE_LIMIT: Duration = Duration::from_secs(30 * 60);

/// A daemon nobody talks to eventually steps aside on its own.
pub async fn when_idle(app: Arc<App>) {
    loop {
        tokio::time::sleep(Duration::from_secs(60)).await;
        if !needed(&app) && app.idle_for() > IDLE_LIMIT {
            std::process::exit(0);
        }
    }
}

/// The daemon's work ends when no Review still needs it. Give in-flight
/// responses a moment to land, then step aside — unless a new Review
/// arrived meanwhile.
pub fn if_drained(app: &Arc<App>) {
    if needed(app) {
        return;
    }
    // Let anyone waiting on a Review hear that it ended before the process goes.
    app.announce("state", "");
    let app = Arc::clone(app);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        if !needed(&app) {
            std::process::exit(0);
        }
    });
}

/// A Review needs the daemon while it is open, and after ending until its
/// outcome reaches the disk that outlives the daemon.
fn needed(app: &App) -> bool {
    app.reviews
        .lock()
        .unwrap()
        .values()
        .any(|review| review.needs_daemon())
}
