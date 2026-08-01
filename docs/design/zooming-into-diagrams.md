# Zooming into diagrams

How a human reads a mermaid diagram that the 46rem column makes too small to
judge. Vocabulary is `CONTEXT.md`'s; the decisions behind it are wayfinder map
[#2](https://github.com/flyingmt/mdvl/issues/2) (tickets #3–#7). It applies
wherever a mermaid Block is drawn — the review screen and the view page alike,
since both share the same component.

## The one thing this is for

Judging a diagram's content. A diagram in the reading column renders at its
natural size inside `overflow-x-auto`; past a few dozen nodes its text is
illegible, and illegible content cannot be reviewed. The zoom modal gives the
diagram the whole window so the human can actually read it — the judging itself
(comments, edits) stays in the document, and the modal carries none of it.

## Entry

Two paths in, both opening the same modal:

- **A ⤢ button.** On the review screen it joins the Block's hover/focus control
  group alongside ✎💬🗑 — the existing convention, controls live on the Block.
  On the view page there is no control group, so the button sits persistently
  on the mermaid Block.
- **Clicking the diagram itself**, with `cursor: zoom-in` as the affordance.

The entry is **absent when there is nothing to zoom**: while the Block is being
edited (the human is looking at markdown, not a drawing), while the diagram
failed to render (the amber box), and while it is still loading.

## The modal

```
┌────────────────────────────────────────────────────────┐
│ Diagram                                               [✕]│
├────────────────────────────────────────────────────────┤
│                                          [＋][－][fit] │
│              the diagram, panned and zoomed            │
│                                                        │
│ arrows move · +/− zoom · 0 fit                         │
└────────────────────────────────────────────────────────┘
```

- **It opens at fit.** The whole diagram is visible, centred. Fit is not
  capped at 100%: a column-sized diagram measures a fit of roughly 2.6×, so
  small diagrams open magnified. Reading starts from the overview; detail is a
  zoom-to-cursor away.
- **Reopening resets to fit.** No remembered pan or zoom. A re-rendered
  diagram (its source was edited) has new geometry that stale coordinates
  cannot match, and "open = overview" stays a reliable mental model.
- Closing: Esc, the ✕, or the backdrop. Only the modal closes; the document
  underneath is untouched.

## Interaction

Map-style: continuous zoom anchored at the cursor, drag to pan.

| Input | Effect |
| ----- | ------ |
| Wheel | Zoom to cursor, continuous, clamped 0.25×–4× |
| Drag (mouse or one finger) | Pan |
| ＋ / － buttons | Zoom 1.25× / 0.8× about the viewport centre |
| fit button | Back to the opening fit |
| Double-click | One 1.25× step in, anchored at the cursor |
| ⇧ + double-click | One 0.8× step out |
| Arrow keys | Pan 80px (⇧: 320px) |
| + / − keys | As the buttons |
| 0 | As the fit button |
| Esc | Close |

Keys work wherever focus sits inside the modal. Buttons zoom about the centre
because there is no cursor to anchor to.

**Discrete jumps are tweened; continuous input is not.** Buttons, double-click,
keyboard zoom and fit interpolate over ~150ms so the eye keeps its place; wheel
and drag stay 1:1 with the input. Under `prefers-reduced-motion` every
transition is instant (duration 0).

**Pinch is not supported.** One-finger pan comes free with Pointer Events, and
a desktop terminal workflow is where this screen lives. If touch demand ever
appears, that is the recorded trigger to switch the implementation to
`@panzoom/panzoom` (see below).

## Accessibility

- The modal is a `role="dialog"` with `aria-modal="true"` and an `aria-label`;
  it traps focus, per the reviewer's existing modal convention.
- **Focus lands on the dialog container** (`tabindex="-1"`) when it opens, so
  the keyboard gestures work immediately. On close, focus returns to the ⤢
  that opened it.
- Every control is a real `<button>` with an `aria-label`.
- A keyboard hint line sits at the bottom-left of the viewport; discovery does
  not depend on this document.

## Language

New strings join the dictionary keyed by English (`i18n.ts` — a missing key
fails the build): the ⤢ button's label, the dialog's `aria-label`, the zoom
controls' labels, and the hint line.

## Implementation notes

- **Hand-rolled, zero new dependencies.** Pointer Events on the viewport
  (`setPointerCapture`), a CSS `transform: translate(x, y) scale(s)` with
  `transform-origin: 0 0` on a wrapper div around the rendered SVG, and a
  requestAnimationFrame tween for the discrete jumps. Research compared
  svg-pan-zoom (stale), anvaka/panzoom (heavy, 150 open issues) and
  `@panzoom/panzoom` (sound, but native-less on keyboard and needs lifecycle
  wrapping around the re-rendered `{@html}` SVG); ~100 lines of orthogonal
  code covers the scope. The recorded flip trigger is pinch.
- **Zoom-to-cursor** keeps the point under the cursor fixed:
  `p′ = c − (c − p)·(s′/s)`. This one line is the classic failure point; a
  seam-B (Playwright) regression test asserts the cursor point does not move.
- **Fit is measured, not assumed:** read the SVG's rendered size before any
  transform, then `scale = min(vw/sw, vh/sh)`, centred. The modal renders its
  own mermaid SVG from the same fence, so the document's copy is undisturbed.
- **Build completion bar:** a several-hundred-node diagram must pan and zoom
  smoothly, checked with a seam-B fixture.

## Rejected alternatives

- **Stepped zoom (buttons/double-click only, no wheel).** Its fixed absolute
  steps invert when fit exceeds 100% — "zoom in" zooms out. Steps would have
  to be multiples of fit, and the continuous wheel felt right regardless.
- **Region zoom (drag selects an area to fill).** Drag then means both
  "select a region" (at fit) and "pan" (zoomed in); the mode switch proved
  more to learn than it saved.
- **Pinch-to-zoom.** Out of scope above, recorded with its flip trigger.

Out of scope for this feature entirely (map #2): zooming the whole document,
exporting the diagram to PNG/SVG, searching text inside a diagram.
