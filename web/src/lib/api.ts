import { z } from 'zod';
import type { Comment } from './blocks';

const TOKEN_KEY = 'mdvl-token';

let arriving: Promise<void> | null = null;

/**
 * The daemon opens this tab with a single-use ticket in the URL fragment, which
 * never reaches the server. Trade it for the real token once, keep that in
 * session storage so a reload still works, and take the spent ticket out of the
 * address bar.
 */
export function authenticate(): Promise<void> {
	arriving ??= redeemTicket();
	return arriving;
}

async function redeemTicket(): Promise<void> {
	const found = /[#&]k=([a-f0-9]+)/.exec(location.hash);
	if (!found) return;
	history.replaceState(null, '', location.pathname + location.search);

	const response = await fetch('/api/exchange', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ticket: found[1] })
	});
	if (!response.ok) return;
	const bought = Bought.parse(await response.json());
	sessionStorage.setItem(TOKEN_KEY, bought.token);
}

function token(): string {
	return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

async function call(path: string, init: RequestInit = {}) {
	await authenticate();
	const response = await fetch(`/api${path}`, {
		...init,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token()}`,
			...(init.headers ?? {})
		}
	});
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error ?? response.statusText);
	}
	return response.status === 204 ? null : response.json();
}

/**
 * Everything crossing the wire is checked on arrival. The daemon is trusted,
 * but a version of it that disagrees with this page should say so here rather
 * than surface as an undefined three components down.
 */
const Bought = z.object({ token: z.string() });

/**
 * The reviewer's work-in-progress that isn't part of the file — parked with the
 * daemon so closing the tab doesn't cost them their comments.
 */
const DraftSchema = z.object({
	comments: z.array(z.array(z.string())),
	overall: z.string()
});

const LoadedReviewSchema = z.object({
	id: z.string(),
	path: z.string(),
	content: z.string(),
	state: z.enum(['pending', 'submitted', 'cancelled', 'conflict']),
	draft: DraftSchema.nullable()
});

const SubmitOutcomeSchema = z.object({
	status: z.enum(['submitted', 'conflict']),
	conflict_copy: z.string().optional()
});

const ArrivingReviewSchema = z.object({ kind: z.string(), id: z.string() });

export type Draft = z.infer<typeof DraftSchema>;
export type LoadedReview = z.infer<typeof LoadedReviewSchema>;
export type SubmitOutcome = z.infer<typeof SubmitOutcomeSchema>;

export type OutgoingComment = {
	lines: [number, number];
	quote: string;
	body: string;
};

export const fetchReview = async (id: string): Promise<LoadedReview> =>
	LoadedReviewSchema.parse(await call(`/reviews/${id}`));

export const keepDraft = (id: string, content: string, draft: Draft): Promise<null> =>
	call(`/reviews/${id}/draft`, { method: 'PUT', body: JSON.stringify({ content, draft }) });

export const submitReview = async (
	id: string,
	body: { content: string; comments: OutgoingComment[]; overall: string }
): Promise<SubmitOutcome> =>
	SubmitOutcomeSchema.parse(
		await call(`/reviews/${id}/submit`, { method: 'POST', body: JSON.stringify(body) })
	);

export const cancelReview = (id: string): Promise<null> =>
	call(`/reviews/${id}/cancel`, { method: 'POST' });

export const shutdownApp = (): Promise<null> => call('/shutdown', { method: 'POST' });

/**
 * A live connection is also how the daemon knows this tab is open, so a second
 * Review arrives here instead of opening another window at the reviewer.
 */
export async function watchForReviews(onReview: (id: string) => void): Promise<() => void> {
	await authenticate();
	const source = new EventSource(`/api/events?token=${encodeURIComponent(token())}`);
	source.onmessage = (message) => {
		const event = ArrivingReviewSchema.safeParse(JSON.parse(message.data));
		if (event.success && event.data.kind === 'review') onReview(event.data.id);
	};
	return () => source.close();
}

/** The Agent reads `quote` when the lines have moved under it. */
export function quoteOf(source: string): string {
	const firstLine = source.split('\n', 1)[0].trim();
	return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine;
}

export function newComment(body: string): Comment {
	return { id: `c${Date.now()}${Math.random().toString(16).slice(2, 6)}`, body };
}
