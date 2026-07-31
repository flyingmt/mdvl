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
