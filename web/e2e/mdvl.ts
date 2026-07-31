import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BINARY = path.resolve(import.meta.dirname, '../../target/debug/mdvl');

export type Review = {
	root: string;
	file: string;
	id: string;
	port: number;
	token: string;
};

const running: Review[] = [];

/** A throwaway Project Root holding one document, with a Review already open on it. */
export function openReview(body: string, name = 'plan.md'): Review {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdvl-e2e-'));
	fs.mkdirSync(path.join(root, '.git'));
	const file = path.join(root, name);
	fs.writeFileSync(file, body);

	const id = execFileSync(BINARY, ['review', file], {
		cwd: root,
		encoding: 'utf8',
		env: { ...process.env, MDVL_NO_BROWSER: '1' }
	}).trim();

	const daemon = JSON.parse(fs.readFileSync(path.join(root, '.mdvl/daemon.json'), 'utf8'));
	const review = { root, file, id, port: daemon.port, token: daemon.token };
	running.push(review);
	return review;
}

/** A second Review in a root that already has a daemon. */
export function openAnother(review: Review, name: string, body: string): string {
	const file = path.join(review.root, name);
	fs.writeFileSync(file, body);
	return execFileSync(BINARY, ['review', file], {
		cwd: review.root,
		encoding: 'utf8',
		env: { ...process.env, MDVL_NO_BROWSER: '1' }
	}).trim();
}

/** How many tabs the daemon can see — the thing that decides tab reuse. */
export async function viewerCount(review: Review): Promise<number> {
	const response = await fetch(`http://127.0.0.1:${review.port}/api/health`, {
		headers: { Authorization: `Bearer ${review.token}` }
	});
	return (await response.json()).viewers;
}

export const reviewUrl = (review: Review, id = review.id) =>
	`http://127.0.0.1:${review.port}/r/${id}#t=${review.token}`;

/** What the Agent gets back. Non-zero exits still print the result. */
export function waitForResult(review: Review, seconds = 5) {
	try {
		return JSON.parse(
			execFileSync(BINARY, ['wait', review.id, '--timeout', String(seconds)], {
				cwd: review.root,
				encoding: 'utf8'
			})
		);
	} catch (error) {
		return JSON.parse((error as { stdout: string }).stdout);
	}
}

export const fileContents = (review: Review) => fs.readFileSync(review.file, 'utf8');

export async function stopEverything() {
	for (const review of running.splice(0)) {
		await fetch(`http://127.0.0.1:${review.port}/api/shutdown`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${review.token}` }
		}).catch(() => {});
	}
}
