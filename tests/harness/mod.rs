//! Drives the real `mdvl` binary against a throwaway Project Root, standing in
//! for the browser by talking to the daemon's HTTP API directly.

use std::fs;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, TcpListener};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

pub struct Harness {
    pub root: PathBuf,
    pub port: u16,
    pub token: String,
    /// The single-use ticket the browser would have carried in its URL.
    pub ticket: String,
    _dir: tempfile::TempDir,
}

impl Harness {
    /// A Project Root containing a git directory and one markdown file, with a
    /// daemon already running for it.
    pub fn with_doc(name: &str, body: &str) -> (Self, String) {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().canonicalize().expect("canonical root");
        fs::create_dir(root.join(".git")).expect("git dir");
        fs::write(root.join(name), body).expect("write doc");

        let out = run_review(&root, &root.join(name));
        assert!(
            out.status.success(),
            "review failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let id = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let opened = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let info: Value = serde_json::from_str(
            &fs::read_to_string(root.join(".mdvl/daemon.json")).expect("daemon.json"),
        )
        .expect("daemon.json is json");

        let harness = Harness {
            port: info["port"].as_u64().expect("port") as u16,
            token: info["token"].as_str().expect("token").to_string(),
            ticket: opened
                .rsplit_once("#k=")
                .map(|(_, ticket)| ticket.to_string())
                .unwrap_or_default(),
            root,
            _dir: dir,
        };
        (harness, id)
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn get(&self, path: &str) -> ureq::http::Response<ureq::Body> {
        ureq::get(self.url(path))
            .header("Authorization", format!("Bearer {}", self.token))
            .call()
            .expect("request")
    }

    pub fn post(&self, path: &str, body: Value) -> ureq::http::Response<ureq::Body> {
        ureq::post(self.url(path))
            .header("Authorization", format!("Bearer {}", self.token))
            .send_json(body)
            .expect("request")
    }

    pub fn submit(&self, id: &str, content: &str, comments: Value, overall: &str) -> Value {
        let mut response = self.post(
            &format!("/api/reviews/{id}/submit"),
            serde_json::json!({ "content": content, "comments": comments, "overall": overall }),
        );
        response.body_mut().read_json().expect("submit response")
    }

    pub fn cancel(&self, id: &str) {
        self.post(&format!("/api/reviews/{id}/cancel"), Value::Null);
    }

    /// `mdvl wait`, returning the printed JSON alongside the exit code.
    pub fn wait(&self, id: &str, timeout: u32) -> (Value, i32) {
        let (stdout, code) = self.wait_raw(id, timeout);
        let parsed = serde_json::from_str(stdout.trim())
            .unwrap_or_else(|_| panic!("wait printed non-json: {stdout}"));
        (parsed, code)
    }

    /// `mdvl wait` exactly as the agent sees it: raw stdout and the exit code,
    /// for tests that expect wait itself to fail.
    pub fn wait_raw(&self, id: &str, timeout: u32) -> (String, i32) {
        let out = Command::new(env!("CARGO_BIN_EXE_mdvl"))
            .args(["wait", id, "--timeout", &timeout.to_string()])
            .current_dir(&self.root)
            .output()
            .expect("run wait");
        (
            String::from_utf8_lossy(&out.stdout).into_owned(),
            out.status.code().unwrap_or(-1),
        )
    }

    pub fn read(&self, name: &str) -> String {
        fs::read_to_string(self.root.join(name)).expect("read file")
    }

    /// A refused connection is how the daemon's exit becomes visible from
    /// outside.
    pub fn daemon_alive(&self) -> bool {
        ureq::get(self.url("/api/health"))
            .header("Authorization", format!("Bearer {}", self.token))
            .call()
            .is_ok()
    }

    /// The daemon's own shutdown path sleeps 150ms before exiting, so a
    /// window past that is long enough to catch a wrongful exit — and polling
    /// catches it the moment it happens rather than at the window's end.
    pub fn daemon_survives(&self, window: Duration) -> bool {
        let deadline = Instant::now() + window;
        while Instant::now() < deadline {
            if !self.daemon_alive() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        true
    }

    /// The daemon exits on its own once no review is pending; poll until the
    /// port stops answering.
    pub fn await_daemon_exit(&self) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.daemon_alive() {
            assert!(
                Instant::now() < deadline,
                "the daemon must exit once no review is pending"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// A finished Review leaves its outcome somewhere under `.mdvl/` for
    /// `mdvl wait` to pick up once the daemon is gone. The contract pins only
    /// "under .mdvl/" — the exact path is the implementer's choice, so every
    /// test finds the file here and nowhere else.
    pub fn result_files(&self, id: &str) -> Vec<PathBuf> {
        fn walk(dir: &Path, id: &str, found: &mut Vec<PathBuf>) {
            for entry in fs::read_dir(dir).expect("list .mdvl") {
                let path = entry.expect("dir entry").path();
                if path.is_dir() {
                    walk(&path, id, found);
                } else if path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().contains(id))
                {
                    found.push(path);
                }
            }
        }
        let mut found = Vec::new();
        walk(&self.root.join(".mdvl"), id, &mut found);
        found
    }

    /// A Project Root containing a git directory and one markdown file, with a
    /// daemon that came up to serve a view of it. Returns the URL the browser
    /// would have opened — no id exists, a view registers nothing.
    pub fn with_view(name: &str, body: &str) -> (Self, String) {
        let dir = tempfile::tempdir().expect("temp dir");
        let root = dir.path().canonicalize().expect("canonical root");
        fs::create_dir(root.join(".git")).expect("git dir");
        fs::write(root.join(name), body).expect("write doc");

        let out = run_view(&root, &root.join(name));
        assert!(
            out.status.success(),
            "view failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        let opened = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let info: Value = serde_json::from_str(
            &fs::read_to_string(root.join(".mdvl/daemon.json")).expect("daemon.json"),
        )
        .expect("daemon.json is json");

        let harness = Harness {
            port: info["port"].as_u64().expect("port") as u16,
            token: info["token"].as_str().expect("token").to_string(),
            ticket: opened
                .rsplit_once("#k=")
                .map(|(_, ticket)| ticket.to_string())
                .unwrap_or_default(),
            root,
            _dir: dir,
        };
        (harness, opened)
    }

    /// `mdvl view` on a path inside this root, returning the URL the browser
    /// would have opened.
    pub fn view(&self, path: &Path) -> String {
        let out = run_view(&self.root, path);
        assert!(
            out.status.success(),
            "view failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stderr).trim().to_string()
    }

    /// `mdvl view` on a path the daemon should refuse.
    pub fn view_expecting_refusal(&self, path: &Path) -> String {
        let out = run_view(&self.root, path);
        assert!(
            !out.status.success(),
            "expected {} to be refused, got: {}",
            path.display(),
            String::from_utf8_lossy(&out.stdout)
        );
        String::from_utf8_lossy(&out.stderr).to_string()
    }

    pub fn review(&self, path: &Path) -> String {
        review(&self.root, path)
    }

    /// `mdvl review` on a path the daemon should refuse.
    pub fn review_expecting_refusal(&self, path: &Path) -> String {
        let out = run_review(&self.root, path);
        assert!(
            !out.status.success(),
            "expected {} to be refused, got: {}",
            path.display(),
            String::from_utf8_lossy(&out.stdout)
        );
        String::from_utf8_lossy(&out.stderr).to_string()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = ureq::post(self.url("/api/shutdown"))
            .header("Authorization", format!("Bearer {}", self.token))
            .send_empty();
    }
}

/// A socket bound where the real daemon used to listen. It answers the health
/// check so `mdvl wait` connects, then drops every other request unanswered —
/// what a daemon that dies between connect and answer looks like from outside.
pub struct ZombieDaemon {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl ZombieDaemon {
    pub fn occupy(port: u16, root: &Path) -> Self {
        let listener =
            TcpListener::bind((Ipv4Addr::LOCALHOST, port)).expect("the dead daemon's port");
        listener.set_nonblocking(true).expect("nonblocking");
        let health = json!({
            "app": "mdvl",
            "root": root.to_string_lossy(),
            "viewers": 0,
        })
        .to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = Arc::clone(&stop);
        let thread = std::thread::spawn(move || {
            while !stopping.load(Ordering::SeqCst) {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        socket.set_nonblocking(false).ok();
                        socket
                            .set_read_timeout(Some(Duration::from_millis(500)))
                            .ok();
                        let mut buffer = [0u8; 4096];
                        let read = socket.read(&mut buffer).unwrap_or(0);
                        let request = String::from_utf8_lossy(&buffer[..read]);
                        if request.contains("/api/health") {
                            let head = format!(
                                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                                health.len()
                            );
                            let _ = socket.write_all(head.as_bytes());
                            let _ = socket.write_all(health.as_bytes());
                        }
                        // Anything else: the socket closes without answering.
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(_) => break,
                }
            }
        });
        ZombieDaemon {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for ZombieDaemon {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run_view(cwd: &Path, path: &Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mdvl"))
        .arg("view")
        .arg(path)
        .current_dir(cwd)
        .env("MDVL_NO_BROWSER", "1")
        .output()
        .expect("run view")
}

fn run_review(cwd: &Path, path: &Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_mdvl"))
        .arg("review")
        .arg(path)
        .current_dir(cwd)
        .env("MDVL_NO_BROWSER", "1")
        .output()
        .expect("run review")
}

fn review(cwd: &Path, path: &Path) -> String {
    let out = run_review(cwd, path);
    assert!(
        out.status.success(),
        "review failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}
