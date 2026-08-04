import { expect, test, type Locator } from '@playwright/test';
import { openReview, openView, pngBytes, stopEverything } from './mdvl';

test.afterEach(stopEverything);

/**
 * What the reviewer sees. A decoded image reports the size it decoded; anything
 * the browser could not read as an image — the app shell served back under an
 * image's name, a 404, a refusal — reports 0.
 */
const decodedWidth = (image: Locator) =>
	image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0));

test('an image beside the document is drawn in a view', async ({ page }) => {
	const view = openView('# Plan\n\n![shot](docs/shot.png)\n', 'plan.md', {
		'docs/shot.png': pngBytes(7, 5)
	});
	await page.goto(view.url);

	const shot = page.getByRole('img', { name: 'shot' });
	await expect(shot).toBeAttached();
	await expect
		.poll(() => decodedWidth(shot), {
			message: 'the reviewer must see the picture the document points at, not a broken frame'
		})
		.toBe(7);
});

test('an image beside the document is drawn in a review', async ({ page }) => {
	// The review page lives at `/r/<id>`, so the same `docs/shot.png` resolves
	// against a different base than it does in a view. A fix that only works for
	// one of the two routes has to fail here.
	const review = openReview('# Plan\n\n![shot](docs/shot.png)\n', 'plan.md', {
		'docs/shot.png': pngBytes(11, 3)
	});
	await page.goto(review.url);

	const shot = page.getByRole('img', { name: 'shot' });
	await expect(shot).toBeAttached();
	await expect
		.poll(() => decodedWidth(shot), {
			message:
				'a review page is one path segment deeper than a view, and the image still has to arrive'
		})
		.toBe(11);
});

test('a relative image resolves against its document, not the Project Root', async ({ page }) => {
	const view = openView('# Plan\n\n![shot](img/a.png)\n', 'notes/plan.md', {
		// The decoy sits exactly where a resolver anchored at the root would look.
		'img/a.png': pngBytes(2, 2),
		'notes/img/a.png': pngBytes(13, 4)
	});
	await page.goto(view.url);

	const shot = page.getByRole('img', { name: 'shot' });
	await expect(shot).toBeAttached();
	await expect
		.poll(() => decodedWidth(shot), {
			message:
				'`img/a.png` inside `notes/plan.md` means `notes/img/a.png` — loading the root decoy is the wrong file, not a near miss'
		})
		.toBe(13);
});

test('a remote image is left for the browser to fetch, not routed through the daemon', async ({
	page
}) => {
	// Hermetic: nothing here should leave the machine, and the assertion is about
	// the address the page holds, not what comes back from it.
	await page.route('https://example.com/**', (route) => route.abort());
	const inline = `data:image/png;base64,${pngBytes(1, 1).toString('base64')}`;
	const view = openView(
		`# Plan\n\n![remote](https://example.com/remote.png)\n\n![inline](${inline})\n`
	);
	await page.goto(view.url);

	await expect(
		page.getByRole('img', { name: 'remote' }),
		'the daemon is bound to loopback and fetches nothing from outside the machine — an absolute address must survive untouched'
	).toHaveAttribute('src', 'https://example.com/remote.png');
	// `rehype-sanitize` allows only http and https for an img src, so a `data:`
	// one is already stripped before any rewriting reaches it — measured, not
	// assumed. This cannot prove a `data:` src survives rewriting, because none
	// survives sanitising. What it does pin is the failure that would matter: an
	// image carrying its own bytes must not come back as a path the daemon is
	// then asked for.
	const inlineSrc = (await page.getByRole('img', { name: 'inline' }).getAttribute('src')) ?? '';
	expect(
		inlineSrc,
		'an image already carrying its own bytes has no file for the daemon to resolve'
	).not.toMatch(/^\/|^http:\/\/127\.0\.0\.1/);
});
