use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use serde::Deserialize;

use crate::root::ProjectRoot;

/// How to reach the daemon serving a Project Root.
#[derive(Clone, Deserialize)]
pub struct Handle {
    pub port: u16,
    pub token: String,
}

impl Handle {
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn bearer(&self) -> String {
        format!("Bearer {}", self.token)
    }
}

pub fn connect_or_spawn(root: &ProjectRoot) -> Result<Handle> {
    if let Some(handle) = healthy(root) {
        return Ok(handle);
    }

    fs::create_dir_all(root.state_dir()).context("could not create .mdvl")?;
    let lock = root.state_dir().join("spawn.lock");
    if abandoned(&lock) {
        let _ = fs::remove_file(&lock);
    }

    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock)
    {
        Ok(_) => {
            let outcome = spawn(root).and_then(|()| wait_for_health(root));
            let _ = fs::remove_file(&lock);
            outcome
        }
        // Another process is already starting the daemon we want.
        Err(_) => wait_for_health(root),
    }
}

pub fn connect(root: &ProjectRoot) -> Result<Handle> {
    healthy(root).context("no review daemon is running for this project")
}

/// A daemon counts only if it answers on its recorded port and serves this root
/// — a stale `daemon.json` from a previous run must not be trusted.
fn healthy(root: &ProjectRoot) -> Option<Handle> {
    let recorded = fs::read_to_string(root.state_dir().join("daemon.json")).ok()?;
    let handle: Handle = serde_json::from_str(&recorded).ok()?;
    let mut response = agent(Duration::from_millis(800))
        .get(handle.url("/api/health"))
        .header("Authorization", handle.bearer())
        .call()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body: serde_json::Value = response.body_mut().read_json().ok()?;
    (body["root"].as_str()? == root.path().to_string_lossy()).then_some(handle)
}

fn spawn(root: &ProjectRoot) -> Result<()> {
    let binary = std::env::current_exe().context("could not find the mdvl binary")?;
    let mut command = Command::new(binary);
    command
        .arg("serve")
        .arg("--root")
        .arg(root.path())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Outlive the shell that started it, and the agent that ran the shell.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
        .spawn()
        .context("could not start the review daemon")?;
    Ok(())
}

fn wait_for_health(root: &ProjectRoot) -> Result<Handle> {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if let Some(handle) = healthy(root) {
            return Ok(handle);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    bail!("the review daemon did not start")
}

fn abandoned(lock: &Path) -> bool {
    fs::metadata(lock)
        .and_then(|meta| meta.modified())
        .map(|when| {
            when.elapsed()
                .is_ok_and(|age| age > Duration::from_secs(30))
        })
        .unwrap_or(false)
}

/// Refusals carry their reason in the body, so let the caller read the status
/// rather than turning every 4xx into a bare transport error.
pub fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(timeout))
        .http_status_as_error(false)
        .build()
        .into()
}
