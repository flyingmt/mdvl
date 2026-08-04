# Markdown is parsed in the browser, not in Rust

The reviewer edits and comments on Blocks, and every Comment must carry a line range back into the source file. That demands an AST with source positions driving the rendered components, so the markdown pipeline (remark/unified) lives in the SvelteKit app and mermaid renders client-side. The Rust binary never parses markdown — it serves the embedded assets, holds Review state, and does the file I/O.

## Consequences

A reader expecting a Rust app to render its own markdown will not find `pulldown-cmark` anywhere. Any future need for server-side rendering (static export, non-browser client) means building a second pipeline, not reusing this one.

"The embedded assets" describes what the binary served when this was written; what it serves has since widened to the pictures a document points at, and it is this decision that keeps the daemon from being able to tell which ones those are. See [0008](./0008-the-daemon-serves-pictures-from-the-project-root.md).
