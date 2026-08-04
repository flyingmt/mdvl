import { expect, test, type Page } from '@playwright/test';
import { openReview, openView, stopEverything } from './mdvl';

// Vertical rhythm between Blocks. The reviewer reads a document, not a wall of
// text, so where one Block ends and the next begins has to be visible — and it
// has to look the same whether the document is being reviewed or only viewed.

const MIXED = `# Plan

Auth uses OAuth.

Sessions expire after a day.

- one
- two

> A quoted line.

| Grant | Use |
| --- | --- |
| code | web |

\`\`\`sh
mdvl review plan.md
\`\`\`

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`;

const HIERARCHY = `# Plan

Intro paragraph.

## Section

Body paragraph.

### Detail

Another paragraph.

Trailing paragraph.
`;

const TWO_HEADINGS = `# Plan

Intro paragraph.

# Second part

Body paragraph.
`;

test.afterEach(stopEverything);

const blocks = (page: Page) => page.getByTestId('block');

/**
 * The vertical space above a Block: from the bottom of whatever sits directly
 * above it in the flow to the Block's own top edge. In a review that neighbour
 * is an InsertionPoint, so its 1.25rem of review-only chrome is never counted —
 * this measures the same thing on both screens. With nothing above it, the
 * Block's container's padding is subtracted instead.
 */
function spaceAbove(page: Page, index: number): Promise<number> {
	return blocks(page)
		.nth(index)
		.evaluate((el) => {
			const top = el.getBoundingClientRect().top;
			const previous = el.previousElementSibling;
			const space = previous
				? top - previous.getBoundingClientRect().bottom
				: top -
					el.parentElement!.getBoundingClientRect().top -
					parseFloat(getComputedStyle(el.parentElement!).paddingTop) -
					parseFloat(getComputedStyle(el.parentElement!).borderTopWidth);
			return Math.round(space * 100) / 100;
		});
}

test('adjacent Blocks in a view are separated by space rather than touching', async ({ page }) => {
	const view = openView(MIXED);
	await page.goto(view.url);
	await expect(blocks(page)).toHaveCount(8);
	// A drawn diagram, not the loading placeholder — otherwise a diagram that
	// never arrives would be measured as a grey box that happens to have space.
	await expect(page.getByTestId('diagram').locator('svg')).toBeVisible();

	// A table and a diagram each scroll inside their own box. That box is a
	// block formatting context, so its margin only shows as a gap between Blocks
	// while it sits on the box itself — put it on the `table` inside and the
	// space is trapped where a neighbour never sees it.
	const kinds = ['heading', 'paragraph', 'paragraph', 'list', 'quote', 'table', 'code', 'diagram'];
	const measured = [];
	for (let index = 1; index < kinds.length; index += 1) {
		measured.push({ above: kinds[index], px: await spaceAbove(page, index) });
	}

	// Not "some space somewhere" — every seam between two Blocks has to be
	// visible, or the document reads as one undifferentiated run of text.
	const touching = measured.filter((gap) => gap.px < 1);
	expect(
		touching,
		`Blocks with no space above them, so they touch the Block before: ${JSON.stringify(touching)}. All measured gaps: ${JSON.stringify(measured)}`
	).toEqual([]);
});

test('a heading claims more space above it than the prose it introduces', async ({ page }) => {
	const view = openView(HIERARCHY);
	await page.goto(view.url);
	await expect(blocks(page)).toHaveCount(7);

	const h2 = await spaceAbove(page, 2);
	const h3 = await spaceAbove(page, 4);
	const paragraph = await spaceAbove(page, 6);

	// Space is what carries the hierarchy — uniform gaps would satisfy the test
	// above while telling the reviewer nothing about where a section starts.
	const measured = `h2 ${h2}px, h3 ${h3}px, paragraph ${paragraph}px`;
	expect(
		h2,
		`a section heading must open more space than a subsection: ${measured}`
	).toBeGreaterThan(h3);
	expect(
		h3,
		`a subsection heading must open more space than a run of prose: ${measured}`
	).toBeGreaterThan(paragraph);
});

test('the document opens the same way in a view and in a review', async ({ page }) => {
	const view = openView(TWO_HEADINGS);
	await page.goto(view.url);
	await expect(blocks(page)).toHaveCount(4);
	const viewFirst = await spaceAbove(page, 0);
	const viewLaterHeading = await spaceAbove(page, 2);

	const review = openReview(TWO_HEADINGS);
	await page.goto(review.url);
	await expect(blocks(page)).toHaveCount(4);
	const reviewFirst = await spaceAbove(page, 0);

	// A review's `main` opens with an InsertionPoint, so a first-Block reset
	// written against the container's first child fires in a view and not in a
	// review. The Block rendering is contractually the same on both screens.
	expect(
		Math.abs(reviewFirst - viewFirst),
		`the first Block sits ${viewFirst}px from the top of the document in a view but ${reviewFirst}px in a review; the same Block must render the same way on both screens`
	).toBeLessThan(0.5);
	expect(
		Math.max(viewFirst, reviewFirst),
		`the document must not open with empty space above its first Block (view ${viewFirst}px, review ${reviewFirst}px)`
	).toBeLessThan(1);
	expect(
		viewLaterHeading,
		`the first Block's space is reset, not absent: a heading of the same level later in the document keeps its space, but measured ${viewLaterHeading}px against the first Block's ${viewFirst}px`
	).toBeGreaterThan(viewFirst);
});
