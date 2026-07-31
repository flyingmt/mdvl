# Language Picker

The interface follows the browser's language. There is no in-app control for
choosing one.

## Why this is out of scope

The browser already knows, and it knows because the reviewer told it once. A
picker asks the same question a second time, in a place the reviewer has to find
before they can read the document they were handed.

`web/src/lib/i18n.ts` reads `navigator.languages` and falls back to English.
Adding a picker means a preference to store, a place to put the control, and a
decision about which wins when the two disagree — for a reviewer who is
reviewing one document and then leaving.

Reopen this if a reviewer's browser language is genuinely not the language they
want to review in — a shared machine, or a locale set for a different reason.
That is a real case; it just has not turned up.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "Deliberate
omissions".
