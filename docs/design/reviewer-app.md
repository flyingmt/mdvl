# The reviewer's app

What the human sees when an Agent hands them a file, and why it looks the way it
does. Vocabulary is `CONTEXT.md`'s; the behaviour it serves is issue #1.

## The one thing this screen is for

Judging writing. Everything else — editing, commenting, the controls themselves —
is secondary and gets out of the way until it is wanted.

That single goal decides most of what follows: the document is rendered, not
shown as source; it sits at a reading width rather than filling the window; and
nothing is coloured, boxed, or bordered unless it is telling the reviewer
something they need.

## Layout

```
┌──────────────────────────────────────────────┐
│ docs/plan.md                    [⏻ Stop app] │  sticky header
├──────────────────────────────────────────────┤
│                                              │
│        # Plan                  [✎][💬][🗑]   │  controls appear on
│        ───── + ─────                         │  hover / focus
│        Auth uses OAuth.        [✎][💬][🗑]   │
│        │ use sessions instead                │  comment, amber rule
│        ───── + ─────                         │
│        ╭──────────╮                          │
│        │  A → B   │                          │  mermaid, drawn
│        ╰──────────╯                          │
│                                              │
│        Anything about the document?          │
│        ┌────────────────────────────┐        │
│        └────────────────────────────┘        │
├──────────────────────────────────────────────┤
│ [Submit] [End review]           2 comments   │  sticky footer
└──────────────────────────────────────────────┘
```

- **Body width 46rem.** Long-form prose past roughly 80 characters a line is
  measurably harder to track back to the next line, and these documents are read
  end to end.
- **Header and footer stick.** The two actions that end a Review must be reachable
  from anywhere in a long document without scrolling to hunt for them.
- **Controls live on the Block, not in a toolbar.** A toolbar would need a
  selection model; hover and focus already say which Block is meant.

## Type and colour

The palette is shadcn-svelte's neutral token set — `background`, `foreground`,
`muted`, `border`, `ring`, `destructive`. Nothing hard-codes a grey, so the whole
interface moves together. Colour outside those tokens is reserved for meaning:

| Colour | Reserved for                                             |
| ------ | -------------------------------------------------------- |
| Amber  | Comments, and diagrams that would not draw                |
| Red    | Destructive actions and their confirmations               |
| Blue   | Links inside the document — the document's own, not ours  |

Body text is Inter at 17px/1.7; only code is monospaced. Headings are weight 600
with tightened tracking, sized 28/22/18 — enough to structure a document without
turning it into a poster.

## One component per Block kind

`heading`, `paragraph`, `list`, `blockquote`, `table`, `code`, `mermaid`. Each
owns how its kind is drawn, and its CSS is named after it, so changing how lists
look is one file and one rule block rather than a hunt through a shared sheet.
Three of them earn the split outright: a table scrolls inside its own box rather
than pushing the document sideways, a code fence bypasses the markdown pipeline
so its text survives byte for byte, and a diagram is drawn by mermaid.

## Language

Wording lives in one dictionary keyed by an English source of truth; every other
language is typed against it, so a missing key fails the build rather than the
reviewer. The language is taken from the browser — a reviewer never has to find
a setting.

## Interaction rules

- **Editing shows markdown.** A reviewer fixing a typo wants to see exactly what
  they are changing, not a rich-text approximation of it (ADR-0001 puts the
  parser in the browser; that does not make this a word processor).
- **Every small editor behaves identically**: ⌘/Ctrl+Enter accepts, Escape backs
  out, and opening one moves focus into it. Implemented once, in `editors.ts`.
- **Destructive actions confirm in a modal.** Losing comments or a whole review
  is worth stopping for, and a modal is the one thing that cannot be missed while
  the reviewer's attention is elsewhere in a long document. It traps focus on
  purpose: while the question is open, answering it is the only thing to do.
- **Only two things confirm**: deleting a Block that carries comments, and ending
  a review. Deleting an empty Block does not — there is nothing to lose that
  re-typing does not restore.
- **Nothing is written to the file until Submit.** The reviewer can experiment.

## Accessibility

- Every control is a real `<button>` with an `aria-label`; icons are
  `aria-hidden` and never carry meaning alone.
- Hover-revealed controls are also revealed by `:focus-within`, so keyboard
  users reach everything a mouse can.
- Colour is never the only signal: comments have a rule and a position, not just
  a hue; failed diagrams say so in words.
- Focus is visible everywhere via a 2px outline with offset.

## Deliberate omissions

Each of these has a file in [`.out-of-scope/`](../../.out-of-scope) carrying the
full argument and what would have to change to reopen it. That directory is the
one an agent reads before building a feature; this list is the summary.

- **No dark mode.** The tokens exist for it, but the page is pinned light: one
  theme is one thing to get right, and nothing asked for two.
  → [dark-mode.md](../../.out-of-scope/dark-mode.md)
- **No syntax highlighting in code fences.** The reviewer is judging prose; a
  highlighter is a dependency and a distraction.
  → [syntax-highlighting.md](../../.out-of-scope/syntax-highlighting.md)
- **No language picker.** The browser already knows.
  → [language-picker.md](../../.out-of-scope/language-picker.md)
- **No reordering by dragging.** Moving a section is what a comment is for.
  → [reordering-blocks.md](../../.out-of-scope/reordering-blocks.md)
