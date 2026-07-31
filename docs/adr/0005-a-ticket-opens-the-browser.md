# A ticket opens the browser, not the token

Opening the reviewer's browser means handing a URL to `open`, which puts it in a
command line that every other user on the machine can read out of the process
table. So the URL carries a single-use ticket, good for sixty seconds, that the
tab trades at `/api/exchange` for the daemon's real token. This replaces the
original design, where the token itself travelled in the URL fragment.

## Consequences

This does not make reading the process table harmless — someone who redeems the
ticket before the browser does gets the token. It turns a secret that lasts as
long as the daemon into a race that has to be won in the second it takes a
browser to start, and losing that race is visible: the reviewer's tab says it
could not open the review rather than silently working.

The token then lives in `localStorage` against `127.0.0.1:<port>`, not
`sessionStorage`, because a reviewer who closes the tab must be able to reopen
the same address — the ticket in their history is spent. A daemon's port and
token live and die together, so a stale entry can only fail authentication.
