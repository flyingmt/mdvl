//! Drives the real `mdvl` binary against a throwaway Project Root, standing in
//! for the browser by talking to the daemon's HTTP API directly.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

pub struct Harness {
    pub root: PathBuf,
    pub port: u16,
    pub token: String,
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

        let id = review(&root, &root.join(name));
        let info: Value = serde_json::from_str(
            &fs::read_to_string(root.join(".mdvl/daemon.json")).expect("daemon.json"),
        )
        .expect("daemon.json is json");

        let harness = Harness {
            port: info["port"].as_u64().expect("port") as u16,
            token: info["token"].as_str().expect("token").to_string(),
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
        let out = Command::new(env!("CARGO_BIN_EXE_mdvl"))
            .args(["wait", id, "--timeout", &timeout.to_string()])
            .current_dir(&self.root)
            .output()
            .expect("run wait");
        let stdout = String::from_utf8_lossy(&out.stdout);
        let parsed = serde_json::from_str(stdout.trim())
            .unwrap_or_else(|_| panic!("wait printed non-json: {stdout}"));
        (parsed, out.status.code().unwrap_or(-1))
    }

    pub fn read(&self, name: &str) -> String {
        fs::read_to_string(self.root.join(name)).expect("read file")
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
