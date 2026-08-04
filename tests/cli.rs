//! Seam A — the Agent's contract, exercised through the real binary.

mod harness;

use std::fs;

use harness::{Harness, ZombieDaemon};
use serde_json::{Value, json};

const DOC: &str = "# Plan\n\nAuth uses OAuth.\n";

/// Status code of a request that is expected to be refused.
fn status_of(request: ureq::RequestBuilder<ureq::typestate::WithoutBody>) -> u16 {
    match request.call() {
        Ok(response) => response.status().as_u16(),
        Err(ureq::Error::StatusCode(code)) => code,
        Err(other) => panic!("unexpected transport error: {other}"),
    }
}

fn status_of_json(sent: Result<ureq::http::Response<ureq::Body>, ureq::Error>) -> u16 {
    match sent {
        Ok(response) => response.status().as_u16(),
        Err(ureq::Error::StatusCode(code)) => code,
        Err(other) => panic!("unexpected transport error: {other}"),
    }
}

#[test]
fn wait_reports_pending_while_the_human_is_still_reviewing() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    let (result, code) = h.wait(&id, 1);

    assert_eq!(result["status"], "pending");
    assert_eq!(result["review_id"], id);
    assert_eq!(result["path"], "plan.md");
    assert_eq!(code, 2);
}

#[test]
fn submit_writes_the_humans_edits_and_hands_over_their_comments() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.submit(
        &id,
        "# Plan\n\nAuth uses sessions.\n",
        json!([{ "lines": [3, 3], "quote": "Auth uses sessions.", "body": "explain why" }]),
        "tighten the tone",
    );
    let (result, code) = h.wait(&id, 5);

    assert_eq!(h.read("plan.md"), "# Plan\n\nAuth uses sessions.\n");
    assert_eq!(result["status"], "submitted");
    assert_eq!(result["file_edited"], true);
    assert_eq!(result["overall"], "tighten the tone");
    assert_eq!(result["comments"][0]["lines"], json!([3, 3]));
    assert_eq!(result["comments"][0]["body"], "explain why");
    assert_eq!(code, 0);
}

#[test]
fn submitting_an_untouched_document_reports_that_nothing_was_edited() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.submit(&id, DOC, json!([]), "");
    let (result, _) = h.wait(&id, 5);

    assert_eq!(result["file_edited"], false);
}

#[test]
fn a_file_changed_on_disk_blocks_the_write_and_keeps_the_humans_version() {
    let (h, id) = Harness::with_doc("plan.md", DOC);
    fs::write(
        h.root.join("plan.md"),
        "# Plan\n\nRewritten by the agent.\n",
    )
    .unwrap();

    let response = h.submit(&id, "# Plan\n\nAuth uses sessions.\n", json!([]), "");
    let (result, code) = h.wait(&id, 5);

    assert_eq!(response["status"], "conflict");
    assert_eq!(
        h.read("plan.md"),
        "# Plan\n\nRewritten by the agent.\n",
        "the file on disk must be left exactly as the other writer left it"
    );
    assert_eq!(
        h.read("plan.mdvl-conflict.md"),
        "# Plan\n\nAuth uses sessions.\n",
        "the human's work must survive the conflict"
    );
    assert_eq!(result["status"], "conflict");
    assert_eq!(result["conflict_copy"], "plan.mdvl-conflict.md");
    assert_eq!(code, 4);
}

#[test]
fn ending_a_review_without_submitting_writes_nothing() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.cancel(&id);
    let (result, code) = h.wait(&id, 5);

    assert_eq!(h.read("plan.md"), DOC);
    assert_eq!(result["status"], "cancelled");
    assert_eq!(code, 3);
}

#[test]
fn submitting_the_last_open_review_stops_the_daemon_and_wait_reads_the_outcome_from_disk() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.submit(
        &id,
        "# Plan\n\nAuth uses sessions.\n",
        json!([]),
        "tighten the tone",
    );
    h.await_daemon_exit();
    let (result, code) = h.wait(&id, 5);

    assert_eq!(result["status"], "submitted");
    assert_eq!(
        code, 0,
        "the agent must learn the outcome even though the daemon is gone"
    );
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn cancelling_the_last_open_review_stops_the_daemon_and_wait_reads_the_outcome_from_disk() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.cancel(&id);
    h.await_daemon_exit();
    let (result, code) = h.wait(&id, 5);

    assert_eq!(result["status"], "cancelled");
    assert_eq!(
        code, 3,
        "the agent must stop waiting even though the daemon is gone"
    );
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn ending_one_of_two_open_reviews_leaves_the_daemon_running() {
    let (h, first) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("api.md"), "# API\n").unwrap();
    let _second = h.review(&h.root.join("api.md"));

    h.cancel(&first);
    // The daemon's own shutdown path sleeps 150ms before exiting, so half a
    // second is well past a wrongful exit — and the poll catches it the
    // moment it happens rather than at the end of the window.
    assert!(
        h.daemon_survives(std::time::Duration::from_millis(500)),
        "the daemon must not exit while another review is still open"
    );
    let (result, code) = h.wait(&first, 5);
    assert_eq!(result["status"], "cancelled");
    assert_eq!(code, 3, "a live daemon still answers wait over HTTP");
}

#[test]
fn a_review_still_pending_keeps_the_daemon_alive() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    let (result, code) = h.wait(&id, 1);

    assert_eq!(result["status"], "pending");
    assert_eq!(code, 2);
    assert!(
        h.daemon_alive(),
        "the daemon must outlive every wait call while a review is pending"
    );
}

#[test]
fn a_manual_shutdown_still_hands_wait_the_cancelled_outcome_from_disk() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.post("/api/shutdown", json!(null));
    h.await_daemon_exit();
    let (result, code) = h.wait(&id, 5);

    assert_eq!(result["status"], "cancelled");
    assert_eq!(
        code, 3,
        "the agent must stop waiting even when the app was stopped by hand"
    );
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn a_conflict_ends_the_review_stops_the_daemon_and_wait_reads_the_outcome_from_disk() {
    let (h, id) = Harness::with_doc("plan.md", DOC);
    fs::write(
        h.root.join("plan.md"),
        "# Plan\n\nRewritten by the agent.\n",
    )
    .unwrap();

    let response = h.submit(&id, "# Plan\n\nAuth uses sessions.\n", json!([]), "");
    assert_eq!(response["status"], "conflict");
    h.await_daemon_exit();
    let (result, code) = h.wait(&id, 5);

    assert_eq!(result["status"], "conflict");
    assert_eq!(result["conflict_copy"], "plan.mdvl-conflict.md");
    assert_eq!(
        code, 4,
        "the agent must learn of the conflict even though the daemon is gone"
    );
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn a_daemon_lost_after_the_health_check_leaves_wait_to_collect_the_outcome_from_disk() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.submit(&id, "# Plan\n\nAuth uses sessions.\n", json!([]), "");
    h.await_daemon_exit();
    // The port answers the health check, then dies on the real request —
    // connecting proves nothing about the daemon still being there.
    let _zombie = ZombieDaemon::occupy(h.port, &h.root);
    let (stdout, code) = h.wait_raw(&id, 5);

    let result: Value = serde_json::from_str(stdout.trim())
        .expect("wait must fall back to the outcome on disk when the daemon dies after connecting");
    assert_eq!(result["status"], "submitted");
    assert_eq!(
        code, 0,
        "a daemon that dies after the health check must not cost the agent the outcome"
    );
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn an_unreadable_outcome_file_is_a_failure_that_keeps_the_file() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    h.post("/api/shutdown", json!(null));
    h.await_daemon_exit();
    let files = h.result_files(&id);
    assert_eq!(files.len(), 1, "a cancelled review must leave its outcome");
    fs::write(&files[0], "{ this is not json").unwrap();
    let (_stdout, code) = h.wait_raw(&id, 5);

    assert_ne!(
        code, 0,
        "an outcome that cannot be read must surface as a failure"
    );
    assert!(
        files[0].exists(),
        "an outcome that was never delivered must not be deleted"
    );
}

#[cfg(unix)]
#[test]
fn a_review_whose_outcome_cannot_be_persisted_keeps_the_daemon_alive() {
    use std::os::unix::fs::PermissionsExt;
    let (h, id) = Harness::with_doc("plan.md", DOC);

    let results = h.root.join(".mdvl/results");
    fs::create_dir_all(&results).unwrap();
    fs::set_permissions(&results, fs::Permissions::from_mode(0o500)).unwrap();
    h.submit(&id, "# Plan\n\nAuth uses sessions.\n", json!([]), "");
    let survived = h.daemon_survives(std::time::Duration::from_millis(500));
    fs::set_permissions(&results, fs::Permissions::from_mode(0o700)).unwrap();

    assert!(
        survived,
        "the daemon must stay alive when the outcome could not be persisted — once it exits, disk is the only channel left"
    );
    let (result, code) = h.wait(&id, 5);
    assert_eq!(result["status"], "submitted");
    assert_eq!(code, 0, "a live daemon still hands the outcome over HTTP");
}

#[test]
fn a_path_outside_the_project_root_is_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "# Secret\n").unwrap();

    let sideways = elsewhere.path().file_name().unwrap();
    let plain = h.review_expecting_refusal(&secret);
    let traversal = h.review_expecting_refusal(&h.root.join("..").join(sideways).join("secret.md"));

    assert!(plain.contains("outside"), "unhelpful message: {plain}");
    assert!(
        traversal.contains("outside"),
        "unhelpful message: {traversal}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_pointing_out_of_the_project_root_is_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "# Secret\n").unwrap();
    let bait = h.root.join("bait.md");
    std::os::unix::fs::symlink(&secret, &bait).unwrap();

    let message = h.review_expecting_refusal(&bait);

    assert!(message.contains("outside"), "unhelpful message: {message}");
}

#[test]
fn the_ticket_that_opens_the_browser_buys_the_token_once() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let exchange =
        |ticket: &str| ureq::post(h.url("/api/exchange")).send_json(json!({ "ticket": ticket }));

    let mut first = exchange(&h.ticket).expect("first exchange");
    let bought: serde_json::Value = first.body_mut().read_json().unwrap();

    assert_eq!(bought["token"], h.token);
    assert_eq!(
        status_of_json(exchange(&h.ticket)),
        401,
        "a ticket read out of the process table must be worthless once spent"
    );
    assert_eq!(status_of_json(exchange("not-a-ticket")), 401);
}

#[test]
fn the_api_is_closed_to_requests_without_the_daemons_token() {
    let (h, id) = Harness::with_doc("plan.md", DOC);
    let path = format!("/api/reviews/{id}");

    let missing = status_of(ureq::get(h.url(&path)));
    let wrong = status_of(ureq::get(h.url(&path)).header("Authorization", "Bearer nope"));

    assert_eq!(missing, 401);
    assert_eq!(wrong, 401);
}

#[test]
fn a_token_in_the_query_string_opens_only_the_event_stream() {
    let (h, id) = Harness::with_doc("plan.md", DOC);
    let query = format!("token={}", h.token);

    // The stream is the one request a browser cannot put a header on.
    let stream = status_of(ureq::get(h.url(&format!("/api/events?{query}"))));
    let review = status_of(ureq::get(h.url(&format!("/api/reviews/{id}?{query}"))));
    let health = status_of(ureq::get(h.url(&format!("/api/health?{query}"))));

    assert_eq!(stream, 200);
    assert_eq!(
        review, 401,
        "a query-string token must not reach anything but the stream"
    );
    assert_eq!(health, 401);
}

#[test]
fn the_api_is_closed_to_pages_served_from_another_origin() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    let code = status_of(
        ureq::get(h.url(&format!("/api/reviews/{id}")))
            .header("Authorization", format!("Bearer {}", h.token))
            .header("Origin", "http://evil.example"),
    );

    assert_eq!(code, 403);
}

#[cfg(unix)]
#[test]
fn the_daemon_file_is_readable_only_by_its_owner() {
    use std::os::unix::fs::PermissionsExt;
    let (h, _id) = Harness::with_doc("plan.md", DOC);

    let mode = fs::metadata(h.root.join(".mdvl/daemon.json"))
        .unwrap()
        .permissions()
        .mode();

    assert_eq!(mode & 0o777, 0o600);
}

#[test]
fn the_daemon_directory_keeps_itself_out_of_git() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);

    assert_eq!(h.read(".mdvl/.gitignore").trim(), "*");
}

#[test]
fn a_second_review_in_the_same_root_reuses_the_running_daemon() {
    let (h, first) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("api.md"), "# API\n").unwrap();

    let second = h.review(&h.root.join("api.md"));
    let port_now: serde_json::Value = serde_json::from_str(&h.read(".mdvl/daemon.json")).unwrap();

    assert_ne!(first, second, "each review gets its own id");
    assert_eq!(port_now["port"].as_u64().unwrap() as u16, h.port);
    assert_eq!(h.get(&format!("/api/reviews/{second}")).status(), 200);
}

#[test]
fn install_places_the_skill_in_the_agent_tooling_that_is_already_there() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir(root.join(".git")).unwrap();
    fs::create_dir_all(root.join(".claude/skills")).unwrap();

    let out = std::process::Command::new(env!("CARGO_BIN_EXE_mdvl"))
        .arg("install")
        .current_dir(&root)
        .output()
        .unwrap();

    let skill = fs::read_to_string(root.join(".claude/skills/md-review/SKILL.md")).unwrap();
    assert!(out.status.success());
    assert!(
        skill.contains("disable-model-invocation: true"),
        "the agent must not be able to start a review on its own"
    );
    assert!(skill.contains("mdvl wait"));
    assert!(
        !root.join(".agents").exists(),
        "tooling directories that are not there must not be invented"
    );
}

#[test]
fn a_codex_prompt_gets_the_skill_without_frontmatter_it_cannot_read() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    fs::create_dir(root.join(".git")).unwrap();
    fs::create_dir_all(root.join(".codex/prompts")).unwrap();

    let out = std::process::Command::new(env!("CARGO_BIN_EXE_mdvl"))
        .arg("install")
        .current_dir(&root)
        .output()
        .unwrap();

    let prompt = fs::read_to_string(root.join(".codex/prompts/md-review.md")).unwrap();
    assert!(out.status.success());
    assert!(prompt.starts_with("# Markdown review"));
    assert!(
        !prompt.contains("disable-model-invocation"),
        "frontmatter this tooling does not read would show up as body text"
    );
    assert!(prompt.contains("mdvl wait"));
}

#[test]
fn a_review_of_something_that_is_not_markdown_is_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("notes.txt"), "hello").unwrap();

    let message = h.review_expecting_refusal(&h.root.join("notes.txt"));

    assert!(message.contains("markdown"), "unhelpful message: {message}");
}

#[test]
fn viewing_a_file_prints_a_url_with_a_ticket_and_hides_the_daemons_token() {
    let (h, url) = Harness::with_view("plan.md", DOC);

    assert!(
        url.contains("#k="),
        "the browser URL must carry a single-use ticket: {url}"
    );
    assert!(
        !url.contains(&h.token),
        "the daemon's token must never appear on a command line: {url}"
    );
}

#[test]
fn the_view_ticket_buys_the_token_once() {
    let (h, _url) = Harness::with_view("plan.md", DOC);
    let exchange =
        |ticket: &str| ureq::post(h.url("/api/exchange")).send_json(json!({ "ticket": ticket }));

    let mut first = exchange(&h.ticket).expect("first exchange");
    let bought: serde_json::Value = first.body_mut().read_json().unwrap();

    assert_eq!(bought["token"], h.token);
    assert_eq!(
        status_of_json(exchange(&h.ticket)),
        401,
        "a ticket read out of the process table must be worthless once spent"
    );
}

#[test]
fn a_view_of_a_path_outside_the_project_root_is_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "# Secret\n").unwrap();

    let sideways = elsewhere.path().file_name().unwrap();
    let plain = h.view_expecting_refusal(&secret);
    let traversal = h.view_expecting_refusal(&h.root.join("..").join(sideways).join("secret.md"));

    assert!(plain.contains("outside"), "unhelpful message: {plain}");
    assert!(
        traversal.contains("outside"),
        "unhelpful message: {traversal}"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_pointing_out_of_the_project_root_is_refused_to_the_viewer() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "# Secret\n").unwrap();
    let bait = h.root.join("bait.md");
    std::os::unix::fs::symlink(&secret, &bait).unwrap();

    let message = h.view_expecting_refusal(&bait);

    assert!(message.contains("outside"), "unhelpful message: {message}");
}

#[test]
fn a_view_of_something_that_is_not_markdown_is_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("notes.txt"), "hello").unwrap();

    let message = h.view_expecting_refusal(&h.root.join("notes.txt"));

    assert!(message.contains("markdown"), "unhelpful message: {message}");
}

#[test]
fn viewing_a_file_registers_nothing_and_the_daemon_stays_up() {
    let (h, _url) = Harness::with_view("plan.md", DOC);

    let results = h.root.join(".mdvl/results");
    let left: Vec<_> = match fs::read_dir(&results) {
        Ok(entries) => entries.collect(),
        Err(_) => Vec::new(),
    };
    assert!(
        left.is_empty(),
        "a view must not leave an outcome behind: {left:?}"
    );
    let missing = status_of(
        ureq::get(h.url("/api/reviews/rv_nothere"))
            .header("Authorization", format!("Bearer {}", h.token)),
    );
    assert_eq!(
        missing, 404,
        "a view registers nothing, so no id can ever fetch it as a review"
    );
    assert!(
        h.daemon_survives(std::time::Duration::from_millis(500)),
        "a view fires no drain — the daemon must only ever retire on idle"
    );
}

#[test]
fn a_view_during_an_open_review_changes_nothing_for_the_review() {
    let (h, id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("notes.md"), "# Notes\n").unwrap();

    let _url = h.view(&h.root.join("notes.md"));

    h.submit(&id, "# Plan\n\nAuth uses sessions.\n", json!([]), "");
    h.await_daemon_exit();
    let (result, code) = h.wait(&id, 5);

    assert_eq!(result["status"], "submitted");
    assert_eq!(
        code, 0,
        "the review's outcome must arrive exactly as if no view had happened"
    );
    assert_eq!(h.read("plan.md"), "# Plan\n\nAuth uses sessions.\n");
    assert!(
        h.result_files(&id).is_empty(),
        "a delivered outcome must not linger on disk"
    );
}

#[test]
fn the_view_content_endpoint_hands_back_the_files_bytes_unchanged() {
    let (h, _url) = Harness::with_view("plan.md", DOC);

    let mut response = h.get("/api/views/content?path=plan.md");
    let body = response.body_mut().read_to_string().expect("content body");

    assert_eq!(
        body, DOC,
        "the daemon never parses markdown — the browser must get the file's exact bytes"
    );
}

#[test]
fn the_view_content_endpoint_refuses_paths_outside_the_root() {
    let (h, _url) = Harness::with_view("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.md");
    fs::write(&secret, "# Secret\n").unwrap();
    let sideways = elsewhere.path().file_name().unwrap();
    let ask = |path: &str| {
        status_of(
            ureq::get(h.url(&format!("/api/views/content?path={path}")))
                .header("Authorization", format!("Bearer {}", h.token)),
        )
    };

    let absolute = ask(&secret.to_string_lossy());
    let traversal = ask(&format!("../{}/secret.md", sideways.to_string_lossy()));

    assert!(
        (400..500).contains(&absolute),
        "a view of an outside path must be refused, got {absolute}"
    );
    assert!(
        (400..500).contains(&traversal),
        "a view that walks out of the root must be refused, got {traversal}"
    );
}

/// A one-pixel PNG, real enough for a browser to decode.
const PIXEL: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82,
];

/// Bytes that live outside the Project Root. Seeing them in a response is the
/// failure — what they are does not matter.
const OUTSIDE: &[u8] = b"bytes from outside the project root\n";

/// Markup that would run in the daemon's own origin, where the token is kept.
const MARKUP: &str = "<script>/* MDVL-SEAM-A-SCRIPT-MARKER */ alert(1)</script>\n";

/// A drawing is markup too — navigate to one and its script runs.
const DRAWING: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\">\
<script>/* MDVL-SEAM-A-DRAWING-MARKER */ alert(1)</script></svg>\n";

struct Served {
    status: u16,
    content_type: String,
    nosniff: bool,
    body: Vec<u8>,
}

/// What an `<img>` tag does: a plain GET with no token, because a tag cannot
/// put a header on its request. Nothing in the reviewer's page can do better,
/// so this is the whole of what the daemon has to decide on.
fn as_a_tag_would(h: &Harness, path: &str) -> Served {
    let header = |response: &ureq::http::Response<ureq::Body>, name: &str| {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };
    match ureq::get(h.url(path)).call() {
        Ok(mut response) => {
            let status = response.status().as_u16();
            let content_type = header(&response, "content-type");
            let nosniff = header(&response, "x-content-type-options") == "nosniff";
            let body = response.body_mut().read_to_vec().expect("response body");
            Served {
                status,
                content_type,
                nosniff,
                body,
            }
        }
        // A refusal has no body to inspect, which is itself the property the
        // tests below are asserting.
        Err(ureq::Error::StatusCode(code)) => Served {
            status: code,
            content_type: String::new(),
            nosniff: false,
            body: Vec::new(),
        },
        Err(other) => panic!("unexpected transport error: {other}"),
    }
}

#[test]
fn an_image_under_the_project_root_reaches_the_page_as_itself() {
    let (h, _id) = Harness::with_doc("plan.md", "# Plan\n\n![shot](docs/shot.png)\n");
    fs::create_dir_all(h.root.join("docs")).unwrap();
    fs::write(h.root.join("docs/shot.png"), PIXEL).unwrap();

    let served = as_a_tag_would(&h, "/docs/shot.png");

    assert_eq!(
        served.status, 200,
        "an image the document points at has to reach the page, and a tag carries no token"
    );
    assert_eq!(
        served.body, PIXEL,
        "the browser needs the file's exact bytes or it has nothing to decode"
    );
    assert_eq!(
        served.content_type, "image/png",
        "the type is decided by the extension and nothing else"
    );
    assert!(
        served.nosniff,
        "without nosniff the browser is free to decide the type for itself, \
         which is the sniffing the extension whitelist exists to prevent"
    );
}

#[test]
fn nothing_under_the_daemons_own_directory_is_reachable_over_http() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    // A whitelisted extension inside `.mdvl/`, so this pins the hard exclusion
    // and not the extension whitelist that would also have stopped it.
    fs::write(h.root.join(".mdvl/decoy.png"), PIXEL).unwrap();

    let token_file = as_a_tag_would(&h, "/.mdvl/daemon.json");
    let decoy = as_a_tag_would(&h, "/.mdvl/decoy.png");

    assert!(
        !String::from_utf8_lossy(&token_file.body).contains(&h.token),
        "daemon.json is written 0600 so only its owner can read it — the daemon \
         serving the Project Root must not hand the token to anything that reaches the port"
    );
    assert_ne!(
        decoy.body, PIXEL,
        "`.mdvl/` holds the token and the human's comments, so it is closed \
         whatever the file is called"
    );
}

#[cfg(unix)]
#[test]
fn a_daemon_directory_reached_through_a_symlink_is_still_refused() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    // `.mdvl` as a link to a real directory elsewhere in the root. The daemon
    // is happy either way — `create_dir_all` succeeds on a link that already
    // points at a directory — but the refusal compares a path that has been
    // canonicalised against a `<root>/.mdvl` that has not, and a link is
    // exactly where those two spellings come apart.
    fs::rename(h.root.join(".mdvl"), h.root.join("hidden")).unwrap();
    std::os::unix::fs::symlink(h.root.join("hidden"), h.root.join(".mdvl")).unwrap();
    fs::write(h.root.join("hidden/pic.png"), PIXEL).unwrap();

    let served = as_a_tag_would(&h, "/.mdvl/pic.png");

    assert_ne!(
        served.body, PIXEL,
        "the directory refusal and the extension list are meant to hold `.mdvl` \
         shut independently — through a link the list is left holding it alone"
    );
}

#[test]
fn a_path_that_walks_out_of_the_project_root_hands_back_nothing() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    fs::write(elsewhere.path().join("secret.png"), OUTSIDE).unwrap();
    let sideways = elsewhere
        .path()
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();

    // A browser collapses `..` before it sends, so the escape that actually
    // arrives on the wire is the encoded one; the plain form is here because a
    // process that is not a browser can still send it.
    let encoded = as_a_tag_would(&h, &format!("/%2e%2e/{sideways}/secret.png"));
    let double_encoded = as_a_tag_would(&h, &format!("/%2e%2e%2f{sideways}%2fsecret.png"));

    assert_ne!(
        encoded.body, OUTSIDE,
        "the root check happens after `..` is resolved, so no spelling of it gets out"
    );
    assert_ne!(
        double_encoded.body, OUTSIDE,
        "decoding the path must not happen after the root check"
    );
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_project_root_hands_back_nothing() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    let elsewhere = tempfile::tempdir().unwrap();
    let secret = elsewhere.path().join("secret.png");
    fs::write(&secret, OUTSIDE).unwrap();
    std::os::unix::fs::symlink(&secret, h.root.join("bait.png")).unwrap();

    let served = as_a_tag_would(&h, "/bait.png");

    assert_ne!(
        served.body, OUTSIDE,
        "canonicalize resolves the link before the root check, so a link is not a way out"
    );
}

#[test]
fn an_html_file_under_the_project_root_never_reaches_the_page_as_itself() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("notes.html"), MARKUP).unwrap();

    let served = as_a_tag_would(&h, "/notes.html");

    assert!(
        !String::from_utf8_lossy(&served.body).contains("MDVL-SEAM-A-SCRIPT-MARKER"),
        "the token lives in this origin's localStorage — a document written by an \
         Agent must never run as a page here"
    );
}

#[test]
fn an_svg_under_the_project_root_never_reaches_the_page_as_itself() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("diagram.svg"), DRAWING).unwrap();

    let served = as_a_tag_would(&h, "/diagram.svg");

    assert!(
        !String::from_utf8_lossy(&served.body).contains("MDVL-SEAM-A-DRAWING-MARKER"),
        "an svg navigated to directly runs its script in this origin, and the \
         token is in this origin's localStorage — diagrams are drawn by mermaid \
         in the browser, so nothing is lost by leaving svg off the list"
    );
    assert_ne!(
        served.content_type, "image/svg+xml",
        "widening the list to svg is a decision with an owner, not something \
         that should arrive as a side effect"
    );
}

#[test]
fn a_route_the_daemon_does_not_recognise_still_hands_back_the_app_shell() {
    let (h, id) = Harness::with_doc("plan.md", DOC);

    let deep_link = as_a_tag_would(&h, &format!("/r/{id}"));
    let body = String::from_utf8_lossy(&deep_link.body).into_owned();

    assert_eq!(
        deep_link.status, 200,
        "a review's deep link is not a file on disk — it is the app, and losing \
         the fallback makes every review page a 404"
    );
    assert!(
        deep_link.content_type.starts_with("text/html"),
        "the app shell is html, got {}",
        deep_link.content_type
    );
    assert!(
        body.contains("modulepreload"),
        "the shell that boots the reviewer app must come back, not an empty 200"
    );
}

#[test]
fn the_project_files_are_closed_to_pages_served_from_another_origin() {
    let (h, _id) = Harness::with_doc("plan.md", DOC);
    fs::write(h.root.join("shot.png"), PIXEL).unwrap();

    let code = status_of(ureq::get(h.url("/shot.png")).header("Origin", "http://evil.example"));

    assert_eq!(
        code, 403,
        "the fallback now hands out the Project Root, so it has to turn away \
         another origin exactly as /api already does"
    );
}
