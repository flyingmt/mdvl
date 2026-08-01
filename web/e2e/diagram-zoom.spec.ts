import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileContents, openReview, openView, stopEverything } from './mdvl';

// Spec: docs/design/zooming-into-diagrams.md — a modal lightbox for reading
// mermaid diagrams. Written before the implementation exists; every test here
// must fail until the feature lands.
//
// Labels pinned by these tests (the spec requires the strings but not their
// wording): the ⤢ button 'Zoom into this diagram', the dialog's aria-label
// 'Diagram', 'Zoom in' / 'Zoom out' / 'Fit to screen' / 'Close', and a hint
// line matching /arrows move/. Arrow keys are read map-style, the spec's own
// framing ("Map-style"): ArrowRight pans the view east, so the diagram shifts
// 80px LEFT. If the team reads "arrows move" as the diagram following the
// arrow instead, flip the signs in the keyboard test.

const DOC = `# Plan

\`\`\`mermaid
graph TD
  A[Authenticate] --> B[Authorize]
  B --> C[Session]
\`\`\`

Tail.
`;

const BROKEN = `# Plan

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

\`\`\`mermaid
not a diagram at all {{{
\`\`\`
`;

// 300 nodes as ten chains of thirty, so the natural size is large in both
// axes — a single chain collapses to a few pixels tall once mermaid scales
// it. 290 edges, under mermaid's default maxEdges of 500.
const BIG = `# Big

\`\`\`mermaid
graph TD
${Array.from({ length: 300 }, (_, i) => `  n${i}["node ${i}"]`).join('\n')}
${Array.from({ length: 290 }, (_, i) => `  n${i} --> n${i + 10}`).join('\n')}
\`\`\`
`;

test.afterEach(stopEverything);

const blocks = (page: Page) => page.getByTestId('block');
const zoomEntry = (block: Locator) => block.getByRole('button', { name: 'Zoom into this diagram' });
const zoomDialog = (page: Page) => page.getByRole('dialog', { name: 'Diagram' });

type PanZoom = { s: number; x: number; y: number; ox: number; oy: number; ow: number; oh: number };

/** The modal's pan/zoom state: the nearest transformed ancestor of the diagram svg. */
async function readPanZoom(diagram: Locator): Promise<PanZoom> {
	return diagram.evaluate((svg) => {
		let node: HTMLElement | null = svg as unknown as HTMLElement;
		while (node) {
			const tf = getComputedStyle(node).transform;
			if (tf && tf !== 'none') {
				const m = new DOMMatrixReadOnly(tf);
				const parent = node.parentElement;
				if (!parent) break;
				const box = parent.getBoundingClientRect();
				return { s: m.a, x: m.e, y: m.f, ox: box.x, oy: box.y, ow: box.width, oh: box.height };
			}
			node = node.parentElement;
		}
		throw new Error('the diagram in the modal has no transformed pan/zoom wrapper');
	});
}

/** Waits out the ~150ms tweens; wheel and drag settle on the first poll. */
async function settled(diagram: Locator): Promise<PanZoom> {
	let last = await readPanZoom(diagram);
	for (let i = 0; i < 40; i++) {
		await new Promise((r) => setTimeout(r, 75));
		const now = await readPanZoom(diagram);
		if (Math.abs(now.s - last.s) < 1e-4 && Math.hypot(now.x - last.x, now.y - last.y) < 0.5)
			return now;
		last = now;
	}
	throw new Error('the pan/zoom transform never settled');
}

/** The diagram svg inside the dialog — the control icons are svgs too, so take the big one. */
async function modalDiagram(dlg: Locator, timeout = 15_000): Promise<Locator> {
	const index = () =>
		dlg.evaluate((el) => {
			const svgs = [...el.querySelectorAll('svg')];
			let best = -1;
			let area = 4000; // icon buttons never reach this
			svgs.forEach((svg, i) => {
				const r = svg.getBoundingClientRect();
				if (r.width * r.height > area) {
					area = r.width * r.height;
					best = i;
				}
			});
			return best;
		});
	await expect.poll(index, { timeout }).toBeGreaterThanOrEqual(0);
	return dlg.locator('svg').nth(await index());
}

/** Opens the modal from a block's ⤢ button and waits out the entrance animation. */
async function openZoomModal(page: Page, blockIndex = 1, timeout = 15_000): Promise<Locator> {
	const block = blocks(page).nth(blockIndex);
	const entry = zoomEntry(block);
	// Top-left: on the several-hundred-node fixture the block's centre point can
	// sit under the next insertion point, which swallows the hover.
	await block.hover({ position: { x: 40, y: 40 } });
	await expect(entry).toBeVisible();
	await entry.click();
	const dlg = zoomDialog(page);
	await expect(dlg).toBeVisible();
	const diagram = await modalDiagram(dlg, timeout);
	// The dialog's entrance transition moves the boxes for ~100ms; measure after it.
	await page.waitForTimeout(300);
	return diagram;
}

/** p′ = c − (c − p)·(s′/s) — the point under the cursor must not move. */
function expectAnchored(
	before: PanZoom,
	after: PanZoom,
	at: { x: number; y: number },
	label: string
) {
	const ratio = after.s / before.s;
	const cx = at.x - before.ox;
	const cy = at.y - before.oy;
	expect(
		Math.abs(after.x - (cx - (cx - before.x) * ratio)),
		`${label}: the point under the cursor must stay fixed (p′ = c − (c − p)·(s′/s))`
	).toBeLessThan(4);
	expect(
		Math.abs(after.y - (cy - (cy - before.y) * ratio)),
		`${label}: the point under the cursor must stay fixed (p′ = c − (c − p)·(s′/s))`
	).toBeLessThan(4);
}

test('the ⤢ button on a review block opens the modal over an untouched document diagram', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const block = blocks(page).nth(1);

	const diagram = await openZoomModal(page);
	const dlg = zoomDialog(page);
	await expect(dlg).toHaveAttribute('aria-modal', 'true');
	// The modal draws its own copy from the same fence; the document's stays put.
	await expect(block.getByTestId('diagram').locator('svg')).toHaveCount(1);
	await expect(diagram).toBeVisible();

	// Every control is a real button with a label; the hint line sits bottom-left.
	await expect(dlg.getByRole('button', { name: 'Zoom in' })).toBeVisible();
	await expect(dlg.getByRole('button', { name: 'Zoom out' })).toBeVisible();
	await expect(dlg.getByRole('button', { name: 'Fit to screen' })).toBeVisible();
	await expect(dlg.getByRole('button', { name: 'Close' })).toBeVisible();
	const hint = dlg.getByText(/arrows move/);
	await expect(hint).toBeVisible();
	const hintBox = await hint.boundingBox();
	const dlgBox = await dlg.boundingBox();
	if (!hintBox || !dlgBox) throw new Error('the dialog or its hint line is not laid out');
	expect(
		hintBox.y + hintBox.height / 2,
		'the keyboard hint line belongs in the lower half of the modal'
	).toBeGreaterThan(dlgBox.y + dlgBox.height / 2);
	expect(
		hintBox.x + hintBox.width / 2,
		'the keyboard hint line belongs in the left half of the modal'
	).toBeLessThan(dlgBox.x + dlgBox.width / 2);
});

test('clicking the diagram itself — marked with cursor: zoom-in — opens the same modal', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const drawn = blocks(page).nth(1).getByTestId('diagram');
	await expect(drawn.locator('svg')).toHaveCSS('cursor', 'zoom-in');

	await drawn.click();
	await expect(zoomDialog(page)).toBeVisible();
});

test('the view page shows the ⤢ button persistently — no hover — and it opens the modal', async ({
	page
}) => {
	const view = openView(DOC);
	await page.goto(view.url);
	const entry = zoomEntry(blocks(page).nth(1));
	await expect(entry).toBeVisible();

	await entry.click();
	await expect(zoomDialog(page)).toBeVisible();
});

test('the zoom entry is absent while the block is being edited', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const block = blocks(page).nth(1);
	await block.hover();
	await expect(zoomEntry(block)).toBeVisible();

	// While the human is looking at markdown, there is nothing to zoom into.
	await block.getByRole('button', { name: 'Edit this block' }).click();
	await expect(zoomEntry(block)).toHaveCount(0);

	await block.getByRole('button', { name: 'Cancel' }).click();
	await expect(zoomEntry(block)).toBeVisible();
});

test('the zoom entry is absent where the diagram failed to render', async ({ page }) => {
	const review = openReview(BROKEN);
	await page.goto(review.url);
	await expect(page.getByText('This diagram could not be drawn.')).toBeVisible();

	// The good diagram offers the entry; the amber box has nothing to zoom.
	await expect(zoomEntry(blocks(page).nth(1))).toBeVisible();
	await expect(zoomEntry(blocks(page).nth(2))).toHaveCount(0);
});

test('the zoom entry is absent while the diagram is still loading', async ({ page }) => {
	// Watches from before the first paint: an entry seen while no diagram is on
	// screen flips the flag, however short the loading window ends up.
	await page.addInitScript(() => {
		(window as unknown as { __entryBeforeDiagram: boolean }).__entryBeforeDiagram = false;
		new MutationObserver(() => {
			const entry = [...document.querySelectorAll('button')].some(
				(b) => b.getAttribute('aria-label') === 'Zoom into this diagram'
			);
			if (entry && !document.querySelector('[data-testid="diagram"]')) {
				(window as unknown as { __entryBeforeDiagram: boolean }).__entryBeforeDiagram = true;
			}
		}).observe(document, { subtree: true, childList: true });
	});
	const review = openReview(DOC);
	await page.goto(review.url);

	await expect(zoomEntry(blocks(page).nth(1))).toBeVisible();
	expect(
		await page.evaluate(
			() => (window as unknown as { __entryBeforeDiagram: boolean }).__entryBeforeDiagram
		),
		'there is nothing to zoom while the diagram is still loading, so the entry must not exist yet'
	).toBe(false);
});

test('the modal opens at fit — the whole diagram visible, centred, magnified past 100%', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const state = await settled(diagram);
	const box = await diagram.boundingBox();
	if (!box) throw new Error('the diagram in the modal is not laid out');

	expect(
		box.x,
		'fit means the whole diagram is visible inside the viewport'
	).toBeGreaterThanOrEqual(state.ox - 1);
	expect(
		box.y,
		'fit means the whole diagram is visible inside the viewport'
	).toBeGreaterThanOrEqual(state.oy - 1);
	expect(
		box.x + box.width,
		'fit means the whole diagram is visible inside the viewport'
	).toBeLessThanOrEqual(state.ox + state.ow + 1);
	expect(
		box.y + box.height,
		'fit means the whole diagram is visible inside the viewport'
	).toBeLessThanOrEqual(state.oy + state.oh + 1);
	expect(
		state.s,
		'fit is not capped at 100% — a column-sized diagram opens magnified'
	).toBeGreaterThan(1.2);
	expect(
		Math.abs(box.x + box.width / 2 - (state.ox + state.ow / 2)),
		'fit centres the diagram in the viewport'
	).toBeLessThan(30);
	expect(
		Math.abs(box.y + box.height / 2 - (state.oy + state.oh / 2)),
		'fit centres the diagram in the viewport'
	).toBeLessThan(30);
});

test('wheel zooming keeps the point under the cursor fixed', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const before = await settled(diagram);
	const at = { x: before.ox + before.ow * 0.35, y: before.oy + before.oh * 0.55 };

	await page.mouse.move(at.x, at.y);
	await page.mouse.wheel(0, -240);
	const after = await settled(diagram);
	expect(after.s, 'scrolling up must zoom in').toBeGreaterThan(before.s);
	expectAnchored(before, after, at, 'wheel zoom-to-cursor');
});

test('dragging pans 1:1 with the pointer', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const before = await settled(diagram);
	const start = { x: before.ox + before.ow * 0.4, y: before.oy + before.oh * 0.5 };

	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x + 130, start.y + 90, { steps: 5 });
	await page.mouse.up();
	const after = await settled(diagram);
	expect(Math.abs(after.x - (before.x + 130)), 'drag is 1:1, never tweened').toBeLessThan(2);
	expect(Math.abs(after.y - (before.y + 90)), 'drag is 1:1, never tweened').toBeLessThan(2);
	expect(after.s, 'panning must not change the scale').toBeCloseTo(before.s, 3);
});

test('the ＋/－ buttons zoom about the viewport centre and fit restores the opening view', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const dlg = zoomDialog(page);
	const opening = await settled(diagram);
	const centre = { x: opening.ox + opening.ow / 2, y: opening.oy + opening.oh / 2 };

	await dlg.getByRole('button', { name: 'Zoom in' }).click();
	const zoomedIn = await settled(diagram);
	expect(zoomedIn.s / opening.s, 'the ＋ button steps in 1.25×').toBeCloseTo(1.25, 2);
	expectAnchored(opening, zoomedIn, centre, 'buttons zoom about the viewport centre');

	await dlg.getByRole('button', { name: 'Zoom out' }).click();
	const zoomedOut = await settled(diagram);
	expect(zoomedOut.s / zoomedIn.s, 'the － button steps out 0.8×').toBeCloseTo(0.8, 2);
	expectAnchored(zoomedIn, zoomedOut, centre, 'buttons zoom about the viewport centre');

	// fit returns to the opening state after the view has moved.
	await page.mouse.move(centre.x, centre.y);
	await page.mouse.wheel(0, -240);
	await settled(diagram);
	await dlg.getByRole('button', { name: 'Fit to screen' }).click();
	const refit = await settled(diagram);
	expect(Math.abs(refit.s - opening.s), 'fit restores the opening view').toBeLessThan(
		opening.s * 0.01
	);
	expect(
		Math.hypot(refit.x - opening.x, refit.y - opening.y),
		'fit restores the opening view'
	).toBeLessThan(3);
});

test('double-click steps in at the cursor; ⇧ double-click steps out', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const before = await settled(diagram);
	const at = { x: before.ox + before.ow * 0.45, y: before.oy + before.oh * 0.4 };

	await page.mouse.dblclick(at.x, at.y);
	const steppedIn = await settled(diagram);
	expect(steppedIn.s / before.s, 'double-click is one 1.25× step in').toBeCloseTo(1.25, 2);
	expectAnchored(before, steppedIn, at, 'double-click zooms about the cursor');

	await page.keyboard.down('Shift');
	await page.mouse.dblclick(at.x, at.y);
	await page.keyboard.up('Shift');
	const steppedOut = await settled(diagram);
	expect(steppedOut.s / steppedIn.s, '⇧ double-click is one 0.8× step out').toBeCloseTo(0.8, 2);
	expectAnchored(steppedIn, steppedOut, at, '⇧ double-click zooms about the cursor');
});

test('arrow keys pan 80px (⇧ 320px), +/− zoom, 0 fits, Esc closes', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const fit = await settled(diagram);

	await page.keyboard.press('ArrowRight');
	let now = await settled(diagram);
	expect(
		Math.abs(now.x - (fit.x - 80)),
		'map-style: ArrowRight moves the view east, so the diagram shifts 80px left'
	).toBeLessThan(2);
	expect(Math.abs(now.y - fit.y), 'a horizontal pan must not move vertically').toBeLessThan(2);
	expect(now.s, 'panning must not change the scale').toBeCloseTo(fit.s, 3);

	await page.keyboard.press('ArrowDown');
	now = await settled(diagram);
	expect(
		Math.abs(now.y - (fit.y - 80)),
		'map-style: ArrowDown moves the view south, so the diagram shifts 80px up'
	).toBeLessThan(2);

	await page.keyboard.press('Shift+ArrowRight');
	now = await settled(diagram);
	expect(Math.abs(now.x - (fit.x - 80 - 320)), '⇧ arrow pans 320px, not 80px').toBeLessThan(2);

	await page.keyboard.press('Shift+ArrowUp');
	now = await settled(diagram);
	expect(Math.abs(now.y - (fit.y - 80 + 320)), '⇧ arrow pans 320px, not 80px').toBeLessThan(2);

	await page.keyboard.press('+');
	const zoomed = await settled(diagram);
	expect(zoomed.s / now.s, 'the + key zooms like the ＋ button').toBeCloseTo(1.25, 2);
	expectAnchored(
		now,
		zoomed,
		{ x: now.ox + now.ow / 2, y: now.oy + now.oh / 2 },
		'keyboard zoom is about the viewport centre'
	);

	await page.keyboard.press('-');
	const zoomedBack = await settled(diagram);
	expect(zoomedBack.s / zoomed.s, 'the − key zooms like the － button').toBeCloseTo(0.8, 2);

	await page.keyboard.press('0');
	const refit = await settled(diagram);
	expect(Math.abs(refit.s - fit.s), '0 fits, as the fit button does').toBeLessThan(fit.s * 0.01);
	expect(
		Math.hypot(refit.x - fit.x, refit.y - fit.y),
		'0 fits, as the fit button does'
	).toBeLessThan(3);

	await page.keyboard.press('Escape');
	await expect(zoomDialog(page)).toHaveCount(0);
});

test('the keyboard gestures work wherever focus sits inside the modal', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const dlg = zoomDialog(page);

	// Clicking a control leaves focus on it; the keys must still reach the modal.
	await dlg.getByRole('button', { name: 'Zoom in' }).click();
	const zoomed = await settled(diagram);

	await page.keyboard.press('ArrowDown');
	const panned = await settled(diagram);
	expect(
		Math.abs(panned.y - (zoomed.y - 80)),
		'arrows pan even while a control inside the modal has focus'
	).toBeLessThan(2);
	expect(panned.s, 'panning must not change the scale').toBeCloseTo(zoomed.s, 3);

	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);
});

test('Esc, the ✕, and the backdrop each close the modal and leave the document untouched', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const dlg = zoomDialog(page);

	await openZoomModal(page);
	await page.keyboard.press('Escape');
	await expect(dlg).toHaveCount(0);

	await openZoomModal(page);
	await dlg.getByRole('button', { name: 'Close' }).click();
	await expect(dlg).toHaveCount(0);

	await openZoomModal(page);
	// The backdrop, off the modal's top-left corner. A full-bleed modal would
	// swallow this click — the spec lists the backdrop as a way out.
	await page.mouse.click(12, 12);
	await expect(dlg).toHaveCount(0);

	await expect(blocks(page)).toHaveCount(3);
	await expect(blocks(page).nth(1).getByTestId('diagram').locator('svg')).toHaveCount(1);
	expect(fileContents(review), 'closing the modal must not touch the document').toBe(DOC);
});

test('focus lands on the dialog container, stays trapped, and returns to the ⤢ button', async ({
	page
}) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const block = blocks(page).nth(1);
	await block.hover();
	const entry = zoomEntry(block);
	await expect(entry).toBeVisible();
	await entry.click();
	const dlg = zoomDialog(page);
	await expect(dlg).toBeVisible();

	await expect(
		dlg,
		'focus lands on the dialog container so the keyboard gestures work immediately'
	).toBeFocused();
	for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
	expect(
		await page.evaluate(() => {
			const dialog = document.querySelector('[role="dialog"]');
			return (
				!!dialog && (dialog === document.activeElement || dialog.contains(document.activeElement))
			);
		}),
		'the modal traps focus — Tab must not let it escape'
	).toBe(true);

	await page.keyboard.press('Escape');
	await expect(entry, 'closing returns focus to the ⤢ that opened the modal').toBeFocused();
});

test('reopening the modal resets to fit — no remembered pan or zoom', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	let diagram = await openZoomModal(page);
	const fit = await settled(diagram);

	await page.mouse.move(fit.ox + fit.ow / 2, fit.oy + fit.oh / 2);
	await page.mouse.wheel(0, -480);
	const moved = await settled(diagram);
	expect(
		moved.s,
		'the view must actually have moved for this test to mean anything'
	).toBeGreaterThan(fit.s);
	await page.keyboard.press('Escape');
	await expect(zoomDialog(page)).toHaveCount(0);

	diagram = await openZoomModal(page);
	const again = await settled(diagram);
	expect(Math.abs(again.s - fit.s), 'a reopened modal starts from the overview again').toBeLessThan(
		fit.s * 0.01
	);
	expect(
		Math.hypot(again.x - fit.x, again.y - fit.y),
		'a reopened modal starts from the overview again'
	).toBeLessThan(3);
});

test('wheel zoom is clamped between 0.25× and 4×', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	const diagram = await openZoomModal(page);
	const fit = await settled(diagram);
	await page.mouse.move(fit.ox + fit.ow / 2, fit.oy + fit.oh / 2);

	for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -240);
	const maxed = await settled(diagram);
	expect(maxed.s, 'wheel zoom-in is clamped at 4×').toBeGreaterThan(3.95);
	expect(maxed.s, 'wheel zoom-in is clamped at 4×').toBeLessThan(4.05);

	for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 240);
	const mined = await settled(diagram);
	expect(mined.s, 'wheel zoom-out is clamped at 0.25×').toBeGreaterThan(0.24);
	expect(mined.s, 'wheel zoom-out is clamped at 0.25×').toBeLessThan(0.26);
});

test('a several-hundred-node diagram renders in the modal and pans and zooms', async ({ page }) => {
	test.setTimeout(180_000);
	const review = openReview(BIG);
	await page.goto(review.url);
	await expect(blocks(page).nth(1).getByTestId('diagram').locator('svg')).toBeVisible({
		timeout: 60_000
	});

	const diagram = await openZoomModal(page, 1, 60_000);
	const before = await settled(diagram);
	expect(before.s, 'a wall of a diagram fits by shrinking far below 100%').toBeLessThan(0.5);

	// Drag stays 1:1 at this size.
	const start = { x: before.ox + before.ow * 0.5, y: before.oy + before.oh * 0.5 };
	await page.mouse.move(start.x, start.y);
	await page.mouse.down();
	await page.mouse.move(start.x - 200, start.y, { steps: 4 });
	await page.mouse.up();
	const panned = await settled(diagram);
	expect(
		Math.abs(panned.x - (before.x - 200)),
		'drag stays 1:1 with the pointer on the big fixture'
	).toBeLessThan(3);
	expect(panned.s, 'panning must not change the scale').toBeCloseTo(before.s, 3);

	// Wheel zooms to the cursor.
	const at = { x: before.ox + before.ow * 0.4, y: before.oy + before.oh * 0.5 };
	await page.mouse.move(at.x, at.y);
	await page.mouse.wheel(0, -360);
	const zoomed = await settled(diagram);
	expect(zoomed.s, 'wheel zooms in on the big fixture').toBeGreaterThan(panned.s);
	expectAnchored(panned, zoomed, at, 'the big fixture keeps the cursor point fixed');
});

test.describe('with reduced motion', () => {
	test.use({ contextOptions: { reducedMotion: 'reduce' } });

	test('discrete jumps are instant', async ({ page }) => {
		const review = openReview(DOC);
		await page.goto(review.url);
		const diagram = await openZoomModal(page);
		const before = await settled(diagram);
		const dlg = zoomDialog(page);

		// One frame after the click the final scale must already be applied —
		// under normal motion the ~150ms tween would still be climbing.
		const scale = await dlg.getByRole('button', { name: 'Zoom in' }).evaluate(
			(el) =>
				new Promise<number>((resolve, reject) => {
					(el as HTMLElement).click();
					requestAnimationFrame(() =>
						requestAnimationFrame(() => {
							const dialog = el.closest('[role="dialog"]');
							if (!dialog) return reject(new Error('no dialog'));
							let big: Element | null = null;
							let area = 4000;
							for (const svg of dialog.querySelectorAll('svg')) {
								const r = svg.getBoundingClientRect();
								if (r.width * r.height > area) {
									area = r.width * r.height;
									big = svg;
								}
							}
							let node: Element | null = big;
							while (node) {
								const tf = getComputedStyle(node).transform;
								if (tf && tf !== 'none') return resolve(new DOMMatrixReadOnly(tf).a);
								node = node.parentElement;
							}
							reject(new Error('no transformed wrapper'));
						})
					);
				})
		);
		expect(
			Math.abs(scale - before.s * 1.25),
			'prefers-reduced-motion makes every transition instant (duration 0)'
		).toBeLessThan(before.s * 0.02);
	});
});
