# Re-using an Open View Tab for the Same File

Every `mdvl view <path>` opens a new tab, even if that exact file is already
open in a view tab.

## Why this is out of scope

Tab re-use needs someone to remember which tabs are open, and the only one who
could is the daemon — but a view registers nothing with the daemon, by design.
The daemon never learns a view exists, so there is no registry to query, no tab
identity to match, and no push channel to retarget (a view tab deliberately
does not subscribe to `/api/events`). Re-use would mean inventing view
registration to serve a nicety, and with it a lifecycle to reap: the daemon
cannot know when a tab has closed.

A new tab per invocation is also semantically honest: a view is a snapshot, and
two invocations are two snapshots. Re-using the tab would silently replace the
older snapshot the reader might still be comparing against.

Reopen this if repeated viewing of the same file demonstrably piles up tabs and
readers complain — that would be evidence the snapshot-per-invocation model is
costing more than the registration it avoids.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "The view
page".
