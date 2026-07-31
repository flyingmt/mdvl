# A Review starts only when a human invokes the Skill

The obvious integration is to inject instructions into `AGENTS.md` / `CLAUDE.md` so the Agent calls `mdvl review` whenever it thinks a document needs eyes. We rejected that. `mdvl install` writes a Skill with `disable-model-invocation: true`, so the Agent can only reach the tool after a human runs it.

## Considered Options

Rule-file injection and an MCP server were both considered. Both let the Agent decide when the human should be interrupted, which is exactly the decision we want the human to keep. An Agent that opens a browser tab uninvited is worse than one that never opens it.

## Consequences

Discovery is the user's job — nothing makes the tool "just work" after install. If adoption suffers, the fix is better Skill copy, not automatic invocation.
