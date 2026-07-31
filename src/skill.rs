use std::fs;
use std::process::ExitCode;

use anyhow::{Context, Result};

use crate::root::ProjectRoot;

const SKILL: &str = include_str!("skill/SKILL.md");

/// Where each kind of agent tooling keeps a manually-invoked skill, and whether
/// that tooling reads the skill frontmatter. The container must already exist —
/// installing a skill is not a reason to invent an agent's configuration
/// directory.
const HOMES: [(&str, &str, bool); 3] = [
    (".claude/skills", "md-review/SKILL.md", true),
    (".agents/skills", "md-review/SKILL.md", true),
    // A codex prompt is only ever reached by a human typing its name, so it
    // needs no marker keeping the agent out — and would show one as body text.
    (".codex/prompts", "md-review.md", false),
];

pub fn install(root: &ProjectRoot) -> Result<ExitCode> {
    let mut installed = 0;
    for (container, leaf, keeps_frontmatter) in HOMES {
        let container = root.path().join(container);
        if !container.is_dir() {
            continue;
        }
        let target = container.join(leaf);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("{} could not be created", parent.display()))?;
        }
        let text = if keeps_frontmatter {
            SKILL
        } else {
            without_frontmatter(SKILL)
        };
        fs::write(&target, text)
            .with_context(|| format!("{} could not be written", target.display()))?;
        println!("{}", root.relative(&target));
        installed += 1;
    }

    if installed == 0 {
        eprintln!(
            "mdvl: no agent tooling found in {}.\n\
             Create .claude/skills, .agents/skills or .codex/prompts and run this again.",
            root.path().display()
        );
        return Ok(ExitCode::FAILURE);
    }
    println!("\nInvoke it yourself with /md-review — agents cannot start a review on their own.");
    Ok(ExitCode::SUCCESS)
}

fn without_frontmatter(skill: &str) -> &str {
    skill
        .strip_prefix("---\n")
        .and_then(|rest| rest.split_once("\n---\n"))
        .map_or(skill, |(_, body)| body.trim_start())
}
