mod api;
mod daemon;
mod review;
mod root;
mod server;
mod skill;
mod submit;

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

fn start_review(path: PathBuf) -> Result<ExitCode> {
    let root = here()?;
    let handle = daemon::connect_or_spawn(&root)?;
    let requested = std::env::current_dir()?.join(&path);

    let mut response = daemon::agent(Duration::from_secs(15))
        .post(handle.url("/api/reviews"))
        .header("Authorization", handle.bearer())
        .send_json(serde_json::json!({ "path": requested }))
        .context("the review daemon did not answer")?;
    let refused = !response.status().is_success();
    let body: Value = response.body_mut().read_json().unwrap_or(Value::Null);
    if refused {
        bail!(
            "{}",
            body["error"]
                .as_str()
                .unwrap_or("the review daemon refused this file")
        );
    }

    let id = body["id"]
        .as_str()
        .context("the review daemon did not return a review id")?;
    if body["should_open"].as_bool().unwrap_or(true)
        && std::env::var_os("MDVL_NO_BROWSER").is_none()
    {
        let page = format!("{}#t={}", handle.url(&format!("/r/{id}")), handle.token);
        let _ = open::that(page);
    }
    println!("{id}");
    Ok(ExitCode::SUCCESS)
}

fn wait_for_result(id: &str, timeout: u64) -> Result<ExitCode> {
    let root = here()?;
    let handle = daemon::connect(&root)?;

    let mut response = daemon::agent(Duration::from_secs(timeout + 15))
        .get(handle.url(&format!("/api/reviews/{id}/result?timeout={timeout}")))
        .header("Authorization", handle.bearer())
        .call()
        .context("the review daemon did not answer")?;
    let refused = !response.status().is_success();
    let outcome: Value = response.body_mut().read_json().unwrap_or(Value::Null);
    if refused {
        bail!("{}", outcome["error"].as_str().unwrap_or("no such review"));
    }

    println!("{outcome}");
    Ok(match outcome["status"].as_str() {
        Some("submitted") => ExitCode::SUCCESS,
        Some("pending") => ExitCode::from(2),
        Some("cancelled") => ExitCode::from(3),
        Some("conflict") => ExitCode::from(4),
        _ => ExitCode::FAILURE,
    })
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
