# Syntax Highlighting in Code Fences

Code fences in a reviewed document render as plain monospaced text. There is no
tokenizer and no colour.

## Why this is out of scope

The reviewer is judging prose. A code fence in a plan or a design document is
there to be skimmed or read deliberately — it is an illustration, not the thing
under review. Colouring it competes for attention with the sentences around it,
which are what the human is actually there to weigh.

The cost is also real: a highlighter is a dependency with a grammar per
language, and `CodeFence.svelte` deliberately keeps the fence's text out of the
markdown pipeline so it survives byte for byte. Highlighting would put a
transform back in that path.

Reopen this if reviews start regularly turning on whether a code sample is
*correct* rather than whether the document is. That would mean these documents
have become code review, and code review wants different tooling than this.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "Deliberate
omissions".
