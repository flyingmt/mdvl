use std::fs;
use std::process::ExitCode;

use anyhow::{Context, Result};

use crate::root::ProjectRoot;

const SKILL: &str = include_str!("skill/SKILL.md");

/// Where each kind of agent tooling keeps a manually-invoked skill. The
/// container must already exist — installing a skill is not a reason to invent
/// an agent's configuration directory.
const HOMES: [(&str, &str); 3] = [
    (".claude/skills", "md-review/SKILL.md"),
    (".agents/skills", "md-review/SKILL.md"),
    (".codex/prompts", "md-review.md"),
];

pub fn install(root: &ProjectRoot) -> Result<ExitCode> {
    let mut installed = 0;
    for (container, leaf) in HOMES {
        let container = root.path().join(container);
        if !container.is_dir() {
            continue;
        }
        let target = container.join(leaf);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("{} could not be created", parent.display()))?;
        }
        fs::write(&target, SKILL)
            .with_context(|| format!("{} could not be written", target.display()))?;
        println!("{}", root.relative(&target));
        installed += 1;
    }

    if installed == 0 {
        eprintln!(
            "mdvl: no agent tooling found in {}.\n\
             Create one of .claude/skills, .agents/skills or .codex/prompts and run this again.",
            root.path().display()
        );
        return Ok(ExitCode::FAILURE);
    }
    println!("\nInvoke it yourself with /md-review — agents cannot start a review on their own.");
    Ok(ExitCode::SUCCESS)
}
