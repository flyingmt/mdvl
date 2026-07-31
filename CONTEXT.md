# md-view-linker

A coding agent hands a markdown file to a human, waits, and gets back the human's judgement.
This context is the vocabulary of that handoff.

## Language

**Agent**:
The coding assistant that starts a Review and consumes its result — Claude Code, Codex, pi agent, opencode.
_Avoid_: Client, caller, bot

**Skill**:
The manually-invoked entry point installed into the Agent's tooling. A human running it is the only way a Review begins — the Agent never starts one on its own.
_Avoid_: Command, integration, hook

**Review**:
One human pass over one markdown file, identified by a review id. Ends at Submit or Cancel; it does not span rounds.
_Avoid_: Session, task, request

**Block**:
One top-level element of the markdown document — heading, paragraph, list, code fence, mermaid diagram. The unit a human edits or comments on, and the thing that carries a line range back to the file.
_Avoid_: Node, section, chunk, element

**Comment**:
A human instruction anchored to a Block's line range. The Agent, not the app, carries it out.
_Avoid_: Note, feedback, annotation, suggestion

**Project Root**:
The nearest ancestor directory containing `.git`, or the working directory if there is none. One Review daemon serves one Project Root, and no file outside it can be reviewed.
_Avoid_: Workspace, repo, base dir

**Submit**:
The human declaring the Review finished — the human's own edits are written to disk and the Comments are released to the Agent. The only moment the app writes the file.
_Avoid_: Save, finish, done, approve

**Cancel**:
The human ending a Review without writing anything. The file on disk is untouched.
_Avoid_: Abort, reject, discard

**Conflict**:
The file on disk changed after the Review began, so Submit refused to write. The human's edits are not applied and the Agent is told why.
_Avoid_: Stale, dirty, race
