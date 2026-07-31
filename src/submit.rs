use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

pub fn digest(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub enum Written {
    /// The file carried the human's edits.
    Applied,
    /// Someone else changed the file first; the human's version is parked here.
    Conflict(PathBuf),
}

/// Write the human's version, but never over someone else's changes.
pub fn apply(absolute: &Path, start_sha: &str, content: &str) -> Result<Written> {
    let on_disk = fs::read_to_string(absolute)
        .with_context(|| format!("{} could not be read", absolute.display()))?;

    if digest(&on_disk) != start_sha {
        let copy = conflict_copy_path(absolute);
        fs::write(&copy, content)
            .with_context(|| format!("{} could not be written", copy.display()))?;
        return Ok(Written::Conflict(copy));
    }

    write_atomically(absolute, content)?;
    Ok(Written::Applied)
}

/// `docs/plan.md` becomes `docs/plan.mdvl-conflict.md`, beside the original.
fn conflict_copy_path(absolute: &Path) -> PathBuf {
    let stem = absolute
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "review".to_string());
    absolute.with_file_name(format!("{stem}.mdvl-conflict.md"))
}

/// Replace via a rename so a crash mid-write cannot truncate the document.
fn write_atomically(absolute: &Path, content: &str) -> Result<()> {
    let name = absolute.file_name().unwrap_or_default().to_string_lossy();
    let temporary = absolute.with_file_name(format!(".{name}.mdvl-tmp"));

    fs::write(&temporary, content)
        .with_context(|| format!("{} could not be written", temporary.display()))?;
    if let Ok(existing) = fs::metadata(absolute) {
        let _ = fs::set_permissions(&temporary, existing.permissions());
    }
    fs::rename(&temporary, absolute)
        .with_context(|| format!("{} could not be replaced", absolute.display()))?;
    Ok(())
}
