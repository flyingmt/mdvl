# Upgrading a View into a Review

A view has no button that turns it into a review of the same file. To review
after viewing, close the tab and run `mdvl review <path>`.

## Why this is out of scope

The upgrade looks like one click but is a different feature wearing a button.
A view registers nothing with the daemon — that is what makes it cheap and
safe — and a review is precisely a registration: an id, a state machine, an
outcome. The button would have to mint that registration from the browser,
mid-session, on a page that was loaded with a single-use ticket and carries no
review identity.

It would also blur the one boundary the design depends on: a review starts only
when a human invokes the Skill (ADR-0002). A browser-side "start the review
here" is a second starting line, one the Agent could learn to aim a human at
instead of asking for the Skill.

Reopen this if viewing-then-reviewing the same file becomes the everyday
pattern — if humans routinely run `mdvl view`, read, and then have to retype
the same path as a review. That would mean the two commands are one workflow,
not two.

## Where this was decided

[docs/design/reviewer-app.md](../docs/design/reviewer-app.md) — "The view
page".
