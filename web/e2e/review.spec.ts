import { expect, test, type Page } from '@playwright/test';
import {
	fileContents,
	openAnother,
	openReview,
	stopEverything,
	viewerCount,
	waitForResult
} from './mdvl';

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

test.afterEach(stopEverything);

const blocks = (page: Page) => page.getByTestId('block');

async function editBlock(page: Page, index: number, markdown: string) {
	const block = blocks(page).nth(index);
	await block.hover();
	await block.getByRole('button', { name: 'Edit this block' }).click();
	await block.getByRole('textbox', { name: 'Markdown source of this block' }).fill(markdown);
	await block.getByRole('button', { name: 'Done' }).click();
}

async function commentOn(page: Page, index: number, body: string) {
	const block = blocks(page).nth(index);
	await block.hover();
	await block.getByRole('button', { name: 'Comment on this block' }).click();
	await block.getByRole('textbox', { name: 'New comment on this block' }).fill(body);
	await block.getByRole('button', { name: 'Add comment' }).click();
}

test('renders the document as blocks and draws the mermaid diagram', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await expect(page.getByRole('heading', { name: 'Plan' })).toBeVisible();
	await expect(page.getByText('Auth uses OAuth.')).toBeVisible();
	await expect(blocks(page)).toHaveCount(6);
	await expect(blocks(page).nth(3).getByTestId('diagram').locator('svg')).toBeVisible();
});

test('a code fence is shown as code rather than prose', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await expect(blocks(page).nth(5).locator('pre code')).toContainText('mdvl review plan.md');
});

test('a diagram that will not parse shows its source without hiding the document', async ({
	page
}) => {
	const review = openReview(
		`# Plan\n\n\`\`\`mermaid\nnot a diagram at all {{{\n\`\`\`\n\nAfter.\n`
	);
	await page.goto(review.url);

	await expect(page.getByText('This diagram could not be drawn.')).toBeVisible();
	await expect(page.getByText('not a diagram at all').first()).toBeVisible();
	await expect(page.getByText('After.')).toBeVisible();
});

test('an edit to one block reaches the file on submit', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await editBlock(page, 1, 'Auth uses sessions.');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();

	expect(fileContents(review)).toContain('Auth uses sessions.');
	expect(fileContents(review)).not.toContain('OAuth');
	expect(waitForResult(review)).toMatchObject({ status: 'submitted', file_edited: true });
});

test('two paragraphs typed into one editor become two blocks', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await editBlock(page, 1, 'First half.\n\nSecond half.');

	await expect(blocks(page)).toHaveCount(7);
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();
	expect(fileContents(review)).toContain('First half.\n\nSecond half.');
});

test('a block inserted between two others lands there in the file', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	// Insertion points sit before every block, so the second one follows the heading.
	await page.getByTestId('insertion-point').nth(1).click();
	await page.getByRole('textbox', { name: 'Markdown for the new block' }).fill('An added note.');
	await page.getByRole('button', { name: 'Insert', exact: true }).click();
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();

	expect(fileContents(review)).toBe(DOC.replace('# Plan\n\n', '# Plan\n\nAn added note.\n\n'));
});

test('deleting a block takes its comments with it', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await commentOn(page, 1, 'explain why');
	await expect(page.getByText('explain why')).toBeVisible();

	const block = blocks(page).nth(1);
	await block.hover();
	await block.getByRole('button', { name: 'Delete this block' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();

	await expect(blocks(page)).toHaveCount(5);
	await expect(page.getByText('explain why')).toHaveCount(0);
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();
	expect(waitForResult(review).comments).toEqual([]);
});

test('emptying a commented block asks before taking the comments with it', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	await commentOn(page, 1, 'explain why');

	// Clearing the editor is a deletion by another route; it must not slip past
	// the confirmation.
	const block = blocks(page).nth(1);
	await block.hover();
	await block.getByRole('button', { name: 'Edit this block' }).click();
	await block.getByRole('textbox', { name: 'Markdown source of this block' }).fill('');
	await block.getByRole('button', { name: 'Done' }).click();

	await expect(page.getByText('Delete this block and its 1 comment?')).toBeVisible();
	await page.getByRole('dialog').getByRole('button', { name: 'Keep' }).click();
	await expect(page.getByText('explain why')).toBeVisible();
	await expect(blocks(page)).toHaveCount(6);
});

test('work survives closing and reopening the tab', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await editBlock(page, 1, 'Auth uses sessions.');
	await commentOn(page, 4, 'cut this');
	await page
		.getByRole('textbox', { name: 'Anything about the document as a whole?' })
		.fill('too long');
	// What a closing tab gets: no unload handler is guaranteed to finish, so the
	// app flushes on hide.
	await page.evaluate(() => dispatchEvent(new Event('pagehide')));
	await page.reload();

	await expect(page.getByText('Auth uses sessions.')).toBeVisible();
	await expect(page.getByText('cut this')).toBeVisible();
	await expect(
		page.getByRole('textbox', { name: 'Anything about the document as a whole?' })
	).toHaveValue('too long');
});

test('comments carry the line ranges of the document as submitted', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await commentOn(page, 1, 'use sessions');
	await commentOn(page, 4, 'cut this');

	// Removing the heading shifts everything up; the Agent must be told where the
	// comments landed, not where they started.
	const heading = blocks(page).nth(0);
	await heading.hover();
	await heading.getByRole('button', { name: 'Delete this block' }).click();

	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();

	const result = waitForResult(review);
	expect(result.comments).toEqual([
		{ lines: [1, 1], quote: 'Auth uses OAuth.', body: 'use sessions' },
		{ lines: [11, 11], quote: 'Last paragraph.', body: 'cut this' }
	]);
	expect(fileContents(review).split('\n')[0]).toBe('Auth uses OAuth.');
	expect(fileContents(review).split('\n')[10]).toBe('Last paragraph.');
});

test('a document-wide comment reaches the agent', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await page
		.getByRole('textbox', { name: 'Anything about the document as a whole?' })
		.fill('too long');
	await page.getByRole('button', { name: 'Submit' }).click();
	await expect(page.getByText('Sent to the agent.')).toBeVisible();

	expect(waitForResult(review).overall).toBe('too long');
});

test('ending the review from the browser leaves the file alone', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await editBlock(page, 1, 'Auth uses sessions.');
	await page.getByRole('button', { name: 'End review' }).click();
	await page.getByRole('dialog').getByRole('button', { name: 'End review' }).click();

	await expect(page.getByText('Review ended.')).toBeVisible();
	expect(fileContents(review)).toBe(DOC);
	expect(waitForResult(review)).toMatchObject({ status: 'cancelled' });
});

test('a file changed underneath the reviewer keeps their version aside', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	await editBlock(page, 1, 'Auth uses sessions.');

	const { writeFileSync } = await import('node:fs');
	writeFileSync(review.file, '# Plan\n\nRewritten elsewhere.\n');
	await page.getByRole('button', { name: 'Submit' }).click();

	await expect(page.getByText('The file changed while you were reviewing.')).toBeVisible();
	expect(fileContents(review)).toBe('# Plan\n\nRewritten elsewhere.\n');
	expect(waitForResult(review)).toMatchObject({
		status: 'conflict',
		conflict_copy: 'plan.mdvl-conflict.md'
	});
});

test('a second review arrives in the tab that is already open', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);
	// Reuse hinges on the daemon seeing this tab, so wait until it does.
	await expect.poll(() => viewerCount(review)).toBe(1);

	const second = openAnother(review, 'api.md', '# API\n\nGET /things\n');

	await expect(page).toHaveURL(new RegExp(`/r/${second}$`));
	await expect(page.getByRole('heading', { name: 'API' })).toBeVisible();
});

test.describe('in Korean', () => {
	test.use({ locale: 'ko-KR' });

	test('the interface speaks the language the browser asked for', async ({ page }) => {
		const review = openReview(DOC);
		await page.goto(review.url);

		await expect(page.getByRole('button', { name: '제출' })).toBeVisible();
		await expect(page.getByRole('button', { name: '리뷰 종료' })).toBeVisible();
		await expect(page.getByText('문서 전체에 대해')).toBeVisible();

		await page.getByRole('button', { name: '제출' }).click();
		await expect(page.getByText('에이전트에게 보냈습니다.')).toBeVisible();
	});
});

test('stopping the app from the browser stops the daemon', async ({ page }) => {
	const review = openReview(DOC);
	await page.goto(review.url);

	await page.getByRole('button', { name: 'Stop app' }).click();
	await expect(page.getByText('mdvl has stopped.')).toBeVisible();

	await expect
		.poll(async () => {
			try {
				await fetch(`http://127.0.0.1:${review.port}/api/health`, {
					headers: { Authorization: `Bearer ${review.token}` }
				});
				return 'answering';
			} catch {
				return 'gone';
			}
		})
		.toBe('gone');
});
