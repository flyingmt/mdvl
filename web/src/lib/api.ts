import { z } from 'zod';
import type { Comment } from './blocks';

const TOKEN_KEY = 'mdvl-token';

let authenticating: Promise<void> | null = null;

/**
 * The daemon opens this tab with a single-use ticket in the URL fragment, which
 * never reaches the server. Trade it for the real token once and keep that
 * against this origin — a daemon's port and token live and die together, so a
 * reviewer who closes the tab can reopen the same address and carry on.
 */
export function authenticate(): Promise<void> {
	authenticating ??= redeemTicket();
	return authenticating;
}

async function redeemTicket(): Promise<void> {
	const found = /[#&]k=([a-f0-9]+)/.exec(location.hash);
	if (!found) {
		if (!token()) throw new Error('this tab was opened without a way in');
		return;
	}

	const response = await fetch('/api/exchange', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ ticket: found[1] })
	});
	if (response.ok) {
		localStorage.setItem(TOKEN_KEY, ExchangedToken.parse(await response.json()).token);
	} else if (!token()) {
		// Leave the ticket in the address bar: it is the only way in, and a reload
		// is the reviewer's obvious next move.
		throw new Error((await response.json().catch(() => ({}))).error ?? response.statusText);
	}
	// A spent ticket is ordinary when a closed tab is reopened from history — the
	// token already held is the one that counts. Either way it is finished with.
	history.replaceState(null, '', location.pathname + location.search);
}

function token(): string {
	return localStorage.getItem(TOKEN_KEY) ?? '';
}

async function call(path: string, init: RequestInit = {}) {
	await authenticate();
	const response = await fetch(`/api${path}`, {
		...init,
		// `keepalive` lets a request survive the page that started it, which is
		// the whole point when the reviewer is closing the tab.
		keepalive: init.keepalive ?? false,
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
const ExchangedToken = z.object({ token: z.string() });

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

export const keepDraft = (
	id: string,
	content: string,
	draft: Draft,
	survivingTheTab = false
): Promise<null> =>
	call(`/reviews/${id}/draft`, {
		method: 'PUT',
		body: JSON.stringify({ content, draft }),
		keepalive: survivingTheTab
	});

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
