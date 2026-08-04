# One daemon per Project Root

The daemon is scoped to a Project Root and records its port and token in `<root>/.mdvl/daemon.json` (mode 0600), rather than running one shared daemon per machine. Scoping it this way makes the file-access boundary trivial to enforce: a daemon that only knows one root can refuse every path that does not canonicalize beneath it.

## Consequences

Several daemons run when several projects are in play, each with its own port and browser tab. That is the cost of the boundary; a machine-wide daemon would have to carry per-request root checks instead, and a bug there would expose any file on disk.

The boundary now guards more than the one markdown file a Review or a View opens: the daemon also answers for the pictures that document points at, so every read still funnels through this root check, and the surface it stands in front of is larger than it was. See [0008](./0008-the-daemon-serves-pictures-from-the-project-root.md).
