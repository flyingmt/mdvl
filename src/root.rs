use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

/// The directory a daemon serves. Nothing outside it can be reviewed.
#[derive(Clone, Debug)]
pub struct ProjectRoot(PathBuf);

impl ProjectRoot {
    /// The nearest ancestor holding a `.git`, falling back to `from` itself.
    pub fn discover(from: &Path) -> Result<Self> {
        let start = from
            .canonicalize()
            .with_context(|| format!("{} does not exist", from.display()))?;
        let mut cursor: &Path = &start;
        loop {
            if cursor.join(".git").exists() {
                return Ok(Self(cursor.to_path_buf()));
            }
            match cursor.parent() {
                Some(parent) => cursor = parent,
                None => return Ok(Self(start)),
            }
        }
    }

    pub fn at(path: &Path) -> Result<Self> {
        Ok(Self(path.canonicalize().with_context(|| {
            format!("{} does not exist", path.display())
        })?))
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn state_dir(&self) -> PathBuf {
        self.0.join(".mdvl")
    }

    /// Where a finished Review's outcome waits for `mdvl wait` to collect it.
    pub fn result_file(&self, id: &str) -> PathBuf {
        self.state_dir().join("results").join(format!("{id}.json"))
    }

    /// Prove a requested path is a markdown file inside this root, resolving
    /// symlinks and `..` before deciding — the check every request funnels through.
    pub fn resolve(&self, requested: &Path) -> Result<PathBuf> {
        let absolute = requested
            .canonicalize()
            .with_context(|| format!("{} does not exist", requested.display()))?;
        if !absolute.starts_with(&self.0) {
            bail!(
                "{} is outside the project root {}",
                requested.display(),
                self.0.display()
            );
        }
        if !absolute.is_file() {
            bail!("{} is not a file", requested.display());
        }
        match absolute.extension().and_then(|e| e.to_str()) {
            Some("md" | "markdown") => Ok(absolute),
            _ => bail!("{} is not markdown", requested.display()),
        }
    }

    pub fn relative(&self, absolute: &Path) -> String {
        absolute
            .strip_prefix(&self.0)
            .unwrap_or(absolute)
            .to_string_lossy()
            .into_owned()
    }
}
