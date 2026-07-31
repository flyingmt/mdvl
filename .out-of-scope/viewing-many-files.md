# Viewing Many Files at Once

`mdvl view` takes exactly one path. There is no `mdvl view a.md b.md`, no
directory view, no next/previous navigation between files.

## Why this is out of scope

One file per invocation is the shape the whole tool already has — the original
spec put reviewing more than one file out of scope for the same reason: the
document set is the Agent's concern, not the app's. A multi-file view needs an
ordering, a navigation model, and an answer to what a snapshot of *several*
files means when one of them changes — machinery that serves document browsing,
which is what a file tree or a wiki is for.

The single-file form also keeps the security story one line long: one path in,
one check against the Project Root, one file's bytes out.

Reopen this if reading a document *set* — an ADR and the plan it cites, a spec
and its glossary — becomes a stated need rather than two invocations. The shape
to reopen is a list of paths on the command line, not in-app browsing.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "The view
page".
