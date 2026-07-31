use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Pending,
    Submitted,
    Cancelled,
    Conflict,
}

impl State {
    pub fn is_terminal(self) -> bool {
        self != State::Pending
    }
}

/// A human instruction anchored to a line range of the reviewed file.
#[derive(Clone, Serialize, Deserialize)]
pub struct Comment {
    pub lines: [usize; 2],
    #[serde(default)]
    pub quote: String,
    pub body: String,
}

pub struct Review {
    pub id: String,
    pub absolute: PathBuf,
    pub relative: String,
    /// The file's digest when the Review began, used to detect a Conflict.
    pub start_sha: String,
    /// The file's text when the Review began, used to tell whether it was edited.
    pub original: String,
    pub working: String,
    /// Whatever the reviewer's tab wants back if it is reopened — comments in
    /// progress and the document-wide note. The daemon only stores it.
    pub draft: Option<Value>,
    pub state: State,
    pub comments: Vec<Comment>,
    pub overall: String,
    pub file_edited: bool,
    pub conflict_copy: Option<String>,
}

impl Review {
    pub fn new(
        id: String,
        absolute: PathBuf,
        relative: String,
        content: String,
        sha: String,
    ) -> Self {
        Review {
            id,
            absolute,
            relative,
            start_sha: sha,
            working: content.clone(),
            original: content,
            draft: None,
            state: State::Pending,
            comments: Vec::new(),
            overall: String::new(),
            file_edited: false,
            conflict_copy: None,
        }
    }

    /// The human finished: their text is on disk and their Comments are released.
    pub fn submit(&mut self, content: String, comments: Vec<Comment>, overall: String) {
        self.file_edited = content != self.original;
        self.working = content;
        self.comments = comments;
        self.overall = overall;
        self.state = State::Submitted;
    }

    /// Someone else changed the file first, so the human's version waits elsewhere.
    pub fn conflict(&mut self, content: String, copy: String) {
        self.working = content;
        self.conflict_copy = Some(copy);
        self.state = State::Conflict;
    }

    pub fn cancel(&mut self) {
        if !self.state.is_terminal() {
            self.state = State::Cancelled;
        }
    }

    /// What `mdvl wait` prints. Comments are released only on Submit.
    pub fn outcome(&self) -> Value {
        let mut outcome = json!({
            "status": self.state,
            "review_id": self.id,
            "path": self.relative,
        });
        match self.state {
            State::Submitted => {
                outcome["file_edited"] = json!(self.file_edited);
                outcome["comments"] = json!(self.comments);
                outcome["overall"] = json!(self.overall);
            }
            State::Conflict => {
                outcome["conflict_copy"] = json!(self.conflict_copy);
            }
            _ => {}
        }
        outcome
    }
}
