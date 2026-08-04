import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const BINARY = path.resolve(import.meta.dirname, '../../target/debug/mdvl');

/** Stands in for the browser mdvl would have opened. */
const AS_IF_A_BROWSER = { ...process.env, MDVL_NO_BROWSER: '1' };

export type Review = {
	root: string;
	file: string;
	id: string;
	/** The page mdvl would have opened, ticket and all. */
	url: string;
	port: number;
	token: string;
};

export type View = {
	root: string;
	file: string;
	/** The page mdvl would have opened, ticket and all. */
	url: string;
	port: number;
	token: string;
};

const running: { port: number; token: string }[] = [];

/** Files the document points at, named relative to the Project Root. */
export type Alongside = Record<string, string | Buffer>;

function place(root: string, name: string, body: string | Buffer): string {
	const target = path.join(root, name);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, body);
	return target;
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(typed));
	return Buffer.concat([length, typed, crc]);
}

/**
 * A real PNG of the size asked for. The size is the point: `naturalWidth` then
 * names which file the browser actually decoded, so a test can tell the image
 * it wanted from one that merely happened to load.
 */
export function pngBytes(width: number, height: number): Buffer {
	const rows = Array.from({ length: height }, () =>
		Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0xff)])
	);
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 2, 0, 0, 0], 8);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** A throwaway Project Root holding one document, with a Review already open on it. */
export function openReview(body: string, name = 'plan.md', alongside: Alongside = {}): Review {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdvl-e2e-'));
	fs.mkdirSync(path.join(root, '.git'));
	const file = place(root, name, body);
	for (const [beside, bytes] of Object.entries(alongside)) place(root, beside, bytes);

	const started = spawnSync(BINARY, ['review', file], {
		cwd: root,
		encoding: 'utf8',
		env: AS_IF_A_BROWSER
	});
	if (started.status !== 0) throw new Error(`mdvl review failed: ${started.stderr}`);

	const daemon = JSON.parse(fs.readFileSync(path.join(root, '.mdvl/daemon.json'), 'utf8'));
	const review = {
		root,
		file,
		id: started.stdout.trim(),
		url: started.stderr.trim(),
		port: daemon.port,
		token: daemon.token
	};
	running.push(review);
	return review;
}

/** A throwaway Project Root holding one document, opened read-only with `mdvl view`. */
export function openView(body: string, name = 'plan.md', alongside: Alongside = {}): View {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdvl-e2e-'));
	fs.mkdirSync(path.join(root, '.git'));
	const file = place(root, name, body);
	for (const [beside, bytes] of Object.entries(alongside)) place(root, beside, bytes);

	const started = spawnSync(BINARY, ['view', file], {
		cwd: root,
		encoding: 'utf8',
		env: AS_IF_A_BROWSER
	});
	if (started.status !== 0) throw new Error(`mdvl view failed: ${started.stderr}`);

	const daemon = JSON.parse(fs.readFileSync(path.join(root, '.mdvl/daemon.json'), 'utf8'));
	const view = {
		root,
		file,
		url: started.stderr.trim(),
		port: daemon.port,
		token: daemon.token
	};
	running.push(view);
	return view;
}

/** A Review started alongside a view — stderr carries the tab's URL when a tab opens. */
export function openReviewAlongside(view: View, name: string, body: string): Review {
	const file = path.join(view.root, name);
	fs.writeFileSync(file, body);

	const started = spawnSync(BINARY, ['review', file], {
		cwd: view.root,
		encoding: 'utf8',
		env: AS_IF_A_BROWSER
	});
	if (started.status !== 0) throw new Error(`mdvl review failed: ${started.stderr}`);

	const review = {
		root: view.root,
		file,
		id: started.stdout.trim(),
		url: started.stderr.trim(),
		port: view.port,
		token: view.token
	};
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
		env: AS_IF_A_BROWSER
	}).trim();
}

/** How many tabs the daemon can see — the thing that decides tab reuse. */
export async function viewerCount(daemon: { port: number; token: string }): Promise<number> {
	const response = await fetch(`http://127.0.0.1:${daemon.port}/api/health`, {
		headers: { Authorization: `Bearer ${daemon.token}` }
	});
	return (await response.json()).viewers;
}

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
