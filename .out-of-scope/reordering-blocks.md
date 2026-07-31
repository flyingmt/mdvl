# Reordering Blocks by Dragging

A reviewer can edit a Block, insert one, and delete one. They cannot drag one to
a new position.

## Why this is out of scope

Moving a section is what a Comment is for. "Put the auth section before the data
model" is one sentence for the human and an obvious instruction for the Agent,
and it carries the *reason* for the move in a way a drag never can.

Dragging also costs more than it looks: a drag state model, keyboard equivalents
so the feature is not mouse-only, and nested-list behaviour that has to decide
whether a dragged item leaves its parent. `blocks.ts` keeps the gap text between
Blocks so an untouched document rewrites byte for byte — reordering has to
decide what happens to those gaps, which is a correctness question, not a
gesture question.

Reopen this if reviews start routinely restructuring documents rather than
correcting them. That would mean the Agent is producing the wrong shape, and the
fix might be upstream of this app entirely.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "Deliberate
omissions".
