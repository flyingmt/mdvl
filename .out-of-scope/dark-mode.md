# Dark Mode

The reviewer's app is pinned to a light theme. There is no dark mode and no
theme switcher.

## Why this is out of scope

Nothing asked for it, and one theme is one thing to get right. The reviewer is
here to read a document and decide whether it is any good; a second palette adds
a second set of contrast ratios to verify, a second set of mermaid diagram
colours to check, and a preference to persist and honour.

The design tokens for it already exist — shadcn-svelte's `init` wrote a `.dark`
block into `web/src/app.css`, and every colour in the interface is a token
rather than a literal. So this is not blocked on architecture. It is a decision
not to own the second theme.

Reopen this if a reviewer says the light page is genuinely hard to read at the
hour they review, which is the only argument this decision does not already
answer. That would be a claim about the reviewer's eyes, not about the palette.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "Deliberate
omissions".
