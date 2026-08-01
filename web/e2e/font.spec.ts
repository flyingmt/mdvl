import { expect, test, type Locator } from '@playwright/test';
import { openView, stopEverything } from './mdvl';

const DOC = `# Plan

Body text in the rendered document.

Inline \`code\` stays monospaced.
`;

test.afterEach(stopEverything);

const computedFont = (locator: Locator) =>
	locator.evaluate((el) => getComputedStyle(el).fontFamily);

test('the whole UI, markdown body included, is set in Pretendard Variable', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);

	const body = page.getByText('Body text in the rendered document.');
	await expect(body).toBeVisible();

	// `html { @apply font-sans }` is the root application — it inherits down to
	// `.rendered`, so these two checks cover chrome and markdown alike.
	expect(
		await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily),
		'--font-sans must name Pretendard Variable, the contract-chosen typeface'
	).toContain('Pretendard');
	expect(
		await computedFont(body),
		'the markdown body must render in Pretendard Variable, not Inter or a fallback'
	).toContain('Pretendard');
});

test('code stays monospaced — the font swap must not reach it', async ({ page }) => {
	const view = openView(DOC);
	await page.goto(view.url);

	const code = page.locator('.rendered code').first();
	await expect(code).toBeVisible();

	// Boundary guard, not proof of the change: this passes before and after —
	// "only code is monospaced" (reviewer-app.md) must survive the swap.
	expect(
		await computedFont(code),
		'Pretendard applies to prose only; code keeps its monospace stack'
	).not.toContain('Pretendard');
});
