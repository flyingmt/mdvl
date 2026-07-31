# The CLI does not block waiting for the human

`mdvl review <path>` returns a review id immediately; the Agent then calls `mdvl wait <id> --timeout 300`, which returns `pending` with a non-zero exit code if the human is not done. A blocking call would be simpler, but a human reviewing a document takes as long as it takes, and agent harnesses cap how long a shell command may run — Claude Code's ceiling is ten minutes. A blocked call that gets killed loses the Review with no way to resume.

## Consequences

The Skill must carry retry instructions, and the daemon must keep Review state alive between `wait` calls — which is why the daemon outlives any single command. See [0004](./0004-one-daemon-per-project-root.md).
