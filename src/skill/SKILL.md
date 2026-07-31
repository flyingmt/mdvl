---
name: md-review
description: Hand a markdown file to the human for review in a browser, wait for them, then carry out what they ask for.
disable-model-invocation: true
---

# Markdown review

Show the human a rendered view of a markdown file, wait while they read and edit
it, then act on what they say. Only the human starts this — never begin a review
because a document merely looks like it needs one.

## Steps

### 1. Pick the file

Use the path the human gave you. If they gave none, use the markdown file you
most recently wrote or changed, and say which one you picked before continuing.

### 2. Start the review

```bash
mdvl review <path>
```

It prints a review id and opens their browser. It returns immediately — it does
not wait for the human.

### 3. Wait

```bash
mdvl wait <id> --timeout 300
```

A human reading a document takes minutes, not seconds. While the status is
`pending`, run the same command again. Keep going. Do not ask whether they are
done, do not decide they have abandoned it, and do not touch the file while you
wait — you would cause a conflict with the person editing it.

| Exit code | Status      | Meaning                                   |
| --------- | ----------- | ----------------------------------------- |
| 0         | `submitted` | They finished. Act on it.                 |
| 2         | `pending`   | Still reading. Run `wait` again.          |
| 3         | `cancelled` | They ended the review without submitting. |
| 4         | `conflict`  | The file changed underneath them.         |
| 1         | —           | mdvl itself failed; see stderr.           |

Exit 1 usually means the human stopped the app from their browser, which takes
the review with it. Stop waiting, say so, and ask what they want — do not start
another review.

### 4. Act on the result

**`submitted`** — their own edits are already written to the file, so re-read it
before you change anything. Then carry out each entry in `comments`. Each one
carries `lines`, the range in the file it was anchored to, and `quote`, a
fragment of what it was anchored to; use `quote` to find the text if the lines
have moved. `overall` applies to the document as a whole.

Comments are instructions for you, not edits the human already made. If a
comment asks a question rather than requesting a change, answer it.

**`cancelled`** — they chose not to review. Leave the file alone and ask what
they would like instead.

**`conflict`** — the file changed on disk while they were reviewing, so nothing
of theirs was written. Their version is at the path in `conflict_copy`.
Reconcile it with what is on disk, then tell them what you did with it.

### 5. Offer another round

When you have applied their comments, tell them and offer another review. Do not
start one yourself.
