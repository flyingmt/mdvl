# Proxying Remote Images

`![](https://example.com/a.png)` is fetched by the browser, straight from the
host that holds it. The daemon does not fetch it, does not cache it, and does
not rewrite its address — only addresses that land under the Project Root are
rewritten, and a remote one never does.

## Why this is out of scope

The daemon binds loopback and speaks to nothing off the machine. The original
spec puts any access from outside the machine out of scope, and a proxy is
exactly that access wearing the daemon's name. It would also make the daemon
the one part of the tool that reaches the network on behalf of a document it
does not trust: the file under review was written by an Agent that may have
been reading the open web, so the hosts it names are somebody else's choice,
and fetching them from here turns the reviewer's machine into the one that
asks — and the one whose address the far end sees.

The reasons usually offered do not hold up against this tool. Reading offline
is not something mdvl promises; a snapshot of one file, opened from a terminal
by the person sitting at it, is not a document archive. Privacy from the far
host is real but is the browser's business, and a reviewer who cares about it
already has the setting for it. Consistency with local pictures is the one
argument with weight, and it costs a request queue, a cache with an
invalidation story, a timeout policy, and a failure mode to render — for the
case where the Agent could have put the file in the repository instead, where
it is already served.

Reopen this if documents routinely have to be read where the browser cannot
reach the hosts they name but the daemon can — an air-gapped machine, or a
corporate proxy the terminal traverses and the browser does not — and putting
the pictures into the repository first has been tried and found worse. The
shape to reopen is a fetch the human asks for, per document, with the addresses
shown before anything is requested; not a transparent proxy that makes every
render a set of outbound requests nobody saw coming.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "Pictures in
the document".
