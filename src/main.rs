mod api;
mod daemon;
mod retire;
mod review;
mod root;
mod server;
mod skill;
mod submit;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use serde_json::Value;

use crate::root::ProjectRoot;

#[derive(Parser)]
#[command(
    name = "mdvl",
    version,
    about = "Hand a markdown file to a human, wait, and get back their judgement."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Open a markdown file for a human to review. Prints the review id and returns.
    Review { path: PathBuf },
    /// Wait for a review to finish. Prints the result as JSON.
    Wait {
        id: String,
        #[arg(long, default_value_t = 300)]
        timeout: u64,
    },
    /// Install the review skill into this project's agent tooling.
    Install,
    /// Run the review daemon. Started for you by `review`.
    #[command(hide = true)]
    Serve {
        #[arg(long)]
        root: PathBuf,
    },
}

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(error) => {
            eprintln!("mdvl: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode> {
    match Cli::parse().command {
        Command::Review { path } => start_review(path),
        Command::Wait { id, timeout } => wait_for_result(&id, timeout),
        Command::Install => skill::install(&here()?),
        Command::Serve { root } => serve(&root),
    }
}

fn here() -> Result<ProjectRoot> {
    let cwd = std::env::current_dir().context("could not read the working directory")?;
    ProjectRoot::discover(&cwd)
}

/// The daemon puts the reason it refused in the body; surface that rather than
/// a bare status code.
fn read_answer(mut response: ureq::http::Response<ureq::Body>, fallback: &str) -> Result<Value> {
    let refused = !response.status().is_success();
    let body: Value = response.body_mut().read_json().unwrap_or(Value::Null);
    if refused {
        bail!("{}", body["error"].as_str().unwrap_or(fallback));
    }
    Ok(body)
}

fn start_review(path: PathBuf) -> Result<ExitCode> {
    let root = here()?;
    let handle = daemon::connect_or_spawn(&root)?;
    let requested = std::env::current_dir()?.join(&path);

    let body = read_answer(
        daemon::agent(Duration::from_secs(15))
            .post(handle.url("/api/reviews"))
            .header("Authorization", handle.bearer())
            .send_json(serde_json::json!({ "path": requested }))
            .context("the review daemon did not answer")?,
        "the review daemon refused this file",
    )?;

    let id = body["id"]
        .as_str()
        .context("the review daemon did not return a review id")?;
    // A ticket comes back only when no tab is watching. It buys the token once,
    // so the secret itself never appears in a command line.
    if let Some(ticket) = body["ticket"].as_str() {
        let reviewer_page = format!("{}#k={ticket}", handle.url(&format!("/r/{id}")));
        match std::env::var_os("MDVL_NO_BROWSER") {
            Some(_) => eprintln!("{reviewer_page}"),
            None => {
                let _ = open::that(reviewer_page);
            }
        }
    }
    println!("{id}");
    Ok(ExitCode::SUCCESS)
}

fn wait_for_result(id: &str, timeout: u64) -> Result<ExitCode> {
    let root = here()?;
    let asked = daemon::connect(&root).and_then(|handle| {
        read_answer(
            daemon::agent(Duration::from_secs(timeout + 15))
                .get(handle.url(&format!("/api/reviews/{id}/result?timeout={timeout}")))
                .header("Authorization", handle.bearer())
                .call()
                .context("the review daemon did not answer")?,
            "no such review",
        )
    });
    // The daemon exits once the last Review ends — and it can die between
    // connecting and answering — so a finished Review's persisted outcome
    // may be all that is left to read.
    let (outcome, on_disk) = match asked {
        Ok(outcome) => (outcome, None),
        Err(daemon_error) => match outcome_from_disk(&root, id) {
            Ok(found) => (found.0, Some(found.1)),
            // Nothing answered and nothing was left behind: say what failed.
            Err(disk_error) => return Err(daemon_error.context(format!("{disk_error:#}"))),
        },
    };

    println!("{outcome}");
    // Printed, so the outcome is delivered; nothing may linger for a later wait.
    if let Some(path) = on_disk {
        let _ = fs::remove_file(path);
    }
    Ok(match outcome["status"].as_str() {
        Some("submitted") => ExitCode::SUCCESS,
        Some("pending") => ExitCode::from(2),
        Some("cancelled") => ExitCode::from(3),
        Some("conflict") => ExitCode::from(4),
        _ => ExitCode::FAILURE,
    })
}

/// Collect an outcome the daemon persisted before exiting. The id becomes a
/// file name, so refuse anything that could walk out of it. The file leaves
/// only once its outcome is delivered — deletion is the caller's job.
fn outcome_from_disk(root: &ProjectRoot, id: &str) -> Result<(Value, PathBuf)> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        bail!("a review id is only ascii letters, digits and underscores");
    }
    let path = root.result_file(id);
    let body = fs::read_to_string(&path)
        .with_context(|| format!("no outcome of review {id} was left on disk"))?;
    let outcome =
        serde_json::from_str(&body).context("the stored review outcome could not be read")?;
    Ok((outcome, path))
}

fn serve(root: &Path) -> Result<ExitCode> {
    let root = ProjectRoot::at(root)?;
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .context("could not start the daemon runtime")?
        .block_on(server::serve(root))?;
    Ok(ExitCode::SUCCESS)
}
