import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { openReviewAlongside, openView, stopEverything, viewerCount } from './mdvl';

const DOC = `# Plan

Auth uses OAuth.

- one
- two

\`\`\`mermaid
graph TD
  A --> B
\`\`\`

Last paragraph.

\`\`\`sh
mdvl review plan.md
\`\`\`
`;

const VIEW_REFERENCE_DOC = `Read [full][full-ref], [collapsed][], [shortcut], and [duplicate].
Keep [missing] literal.

[full-ref]: https://example.com/full

[collapsed]: https://example.com/collapsed

[shortcut]: https://example.com/shortcut

[duplicate]: https://example.com/first
[DUPLICATE]: https://example.com/second
`;

test.afterEach(stopEverything);

const blocks = (page: Page) => page.getByTestId('block');

test('renders the document with the review renderer, mermaid and all', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);

	await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
	await expect(page.getByText('Auth uses OAuth.')).toBeVisible();
	await expect(blocks(page).nth(2).getByText('one')).toBeVisible();
	await expect(blocks(page)).toHaveCount(6);
	await expect(blocks(page).nth(3).getByTestId('diagram').locator('svg')).toBeVisible();
	await expect(blocks(page).nth(5).locator('pre code')).toContainText('mdvl review plan.md');
});

test('reference links resolve all forms from later definitions while preserving fallbacks', async ({
	page
}) => {
	const view = openView(VIEW_REFERENCE_DOC);
	await page.goto(view.url);

	const referenceBlock = blocks(page).first();
	const expectedLinks = [
		['full', 'https://example.com/full'],
		['collapsed', 'https://example.com/collapsed'],
		['shortcut', 'https://example.com/shortcut'],
		['duplicate', 'https://example.com/first']
	] as const;
	for (const [name, target] of expectedLinks) {
		await expect(
			referenceBlock.getByRole('link', { name, exact: true }),
			`${name} must resolve against definitions that follow its Block`
		).toHaveAttribute('href', target);
	}

	await expect(
		referenceBlock,
		'an unresolved reference must remain literal Markdown'
	).toContainText('[missing]');
	await expect(
		referenceBlock.getByRole('link', { name: 'missing', exact: true }),
		'an unresolved reference must not become a link'
	).toHaveCount(0);
	await expect(
		page.locator('main'),
		'definition source must not be visible in View'
	).not.toContainText('[full-ref]:');
});

test('a diagram that will not parse shows its source without hiding the document', async ({
	page
}) => {
	const view = openView(`# Plan\n\n\`\`\`mermaid\nnot a diagram at all {{{\n\`\`\`\n\nAfter.\n`);
	await page.goto(view.url);

	await expect(page.getByText('This diagram could not be drawn.')).toBeVisible();
	await expect(page.getByText('not a diagram at all').first()).toBeVisible();
	await expect(page.getByText('After.')).toBeVisible();
});

test('offers no control that could change the document or stop the app', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);
	await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();

	await blocks(page).nth(1).hover();
	await expect(page.getByRole('button', { name: 'Edit this block' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Comment on this block' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Delete this block' })).toHaveCount(0);
	await expect(page.getByTestId('insertion-point')).toHaveCount(0);
	// Nothing editable means no inputs at all.
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Submit' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'End review' })).toHaveCount(0);
	// The header shows the file's path and nothing else — a Stop button here
	// could kill a review running on the same daemon. Scoped to the banner:
	// the fixture's own code fence quotes `mdvl review plan.md` in the body.
	await expect(page.getByRole('banner').getByText('plan.md')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Stop app' })).toHaveCount(0);
});

test('shows the file as it was when the page loaded', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);
	await expect(page.getByText('Auth uses OAuth.')).toBeVisible();

	writeFileSync(view.file, '# Plan\n\nRewritten after the view opened.\n');

	// A static snapshot: seeing the new content means re-running `mdvl view`.
	// Limit proven by mutation testing: a view that re-fetched could not be
	// failed this way — the write happens only after the first expect confirms
	// the load finished, and the asserts that follow settle within milliseconds,
	// inside any real fetch round-trip. What this pins is that the page as built
	// never swaps in the new bytes on its own, not that every re-fetching
	// implementation would be caught.
	await expect(page.getByText('Auth uses OAuth.')).toBeVisible();
	await expect(page.getByText('Rewritten after the view opened.')).toHaveCount(0);
});

test('a view tab is not a viewer, so a later review still opens its own tab', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);
	await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();

	// Proving a negative: if the view page subscribed to /api/events the daemon
	// would count it as a viewer — the subscription happens on mount, so it
	// would be visible by now. The deterministic backstop is the review below:
	// a counted tab makes `mdvl review` announce over SSE instead of printing a
	// URL, so no tab would ever show the review (story 35).
	await page.waitForTimeout(300);
	expect(await viewerCount(view)).toBe(0);

	const review = openReviewAlongside(view, 'api.md', '# API\n');
	expect(review.url, 'a review started while only a view is open must open its own tab').toContain(
		'#k='
	);
});
