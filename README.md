# mdvl

Hand a markdown file to a human, wait, and get back their judgement.

An agent writes a plan. You want to read it properly — rendered, with the mermaid
diagram actually drawn — fix the two sentences that are wrong yourself, and tell
the agent what to do about the rest. `mdvl` is the thing in between.

```
you:    /md-review docs/plan.md
agent:  mdvl review docs/plan.md   →  rv_8f3a, your browser opens
you:    (read, edit, comment, Submit)
agent:  mdvl wait rv_8f3a          →  your comments, with line numbers
```

## Install

```bash
cargo install --path .        # needs `web/build` — see Development
mdvl install                  # puts the skill into this project's agent tooling
```

`mdvl install` writes a `md-review` skill into whichever of `.claude/skills`,
`.agents/skills` or `.codex/prompts` your project already has. It marks the skill
so the agent cannot invoke it on its own — you start reviews, not the agent.

## Commands

| Command                    | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `mdvl review <path>`       | Opens the file for review. Prints a review id and returns. |
| `mdvl wait <id> [--timeout]` | Prints the result as JSON. Exit 0/2/3/4.                 |
| `mdvl install`             | Installs the review skill.                                 |

Set `MDVL_NO_BROWSER=1` and `review` prints the reviewer's URL on stderr instead
of opening anything — for machines with no browser to open, and for the tests.

`wait` exits `0` when the human submitted, `2` while they are still reading (run
it again), `3` if they ended the review, and `4` if the file changed underneath
them. On `submitted` the result carries their comments, each with the line range
of the file **as submitted** and a quote of what it was anchored to.

## What it will not do

It serves one project at a time and refuses any path outside that project's root.
It listens on loopback only, behind a token generated per daemon. It writes the
file once, on Submit, and only if the file's digest still matches what it was
when the review began — otherwise your version is parked in
`<name>.mdvl-conflict.md` and nothing is overwritten.

## Development

The Rust binary embeds the built SvelteKit app, so the web build comes first:

```bash
cd web && npm install && npm run build
cd .. && cargo build
```

Then:

```bash
cargo test                      # the agent's contract, through the real binary
cd web && npx playwright test   # the reviewer's contract, through a real browser
cd web && npm run lint          # prettier + eslint
cargo clippy --all-targets
```

A debug build reads `web/build` from disk at run time rather than embedding it,
so a frontend change needs `npm run build` and a refresh — not a Rust rebuild.
Release builds embed it.

For a live frontend loop, run `npm run dev` in `web/` and build the daemon with
`--features dev-proxy`: it serves the page straight from Vite while the API keeps
answering from the same origin, so nothing about authentication differs from a
real build.

The design lives in [CONTEXT.md](./CONTEXT.md) — the vocabulary —
[docs/adr](./docs/adr), which records the decisions a reader would otherwise
question, [docs/design](./docs/design) for the reviewer's screen, and
[.out-of-scope](./.out-of-scope) for what this project decided not to build, and
what would have to change to reopen each one.
