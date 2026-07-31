import type { Comment } from './blocks';

const TOKEN_KEY = 'mdvl-token';

/**
 * The daemon hands the tab its token in the URL fragment, which never reaches
 * the server. Move it into session storage so a reload keeps working and the
 * secret stops being visible in the address bar.
 */
export function captureToken(): void {
	const found = /[#&]t=([a-f0-9]+)/.exec(location.hash);
	if (!found) return;
	sessionStorage.setItem(TOKEN_KEY, found[1]);
	history.replaceState(null, '', location.pathname + location.search);
}

function token(): string {
	return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

async function call(path: string, init: RequestInit = {}) {
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

export type ReviewState = 'pending' | 'submitted' | 'cancelled' | 'conflict';

/**
 * The reviewer's work-in-progress that isn't part of the file — parked with the
 * daemon so closing the tab doesn't cost them their comments.
 */
export type Draft = { comments: string[][]; overall: string };

export type LoadedReview = {
	id: string;
	path: string;
	content: string;
	state: ReviewState;
	draft: Draft | null;
};

export type OutgoingComment = {
	lines: [number, number];
	quote: string;
	body: string;
};

export type SubmitOutcome = {
	status: 'submitted' | 'conflict';
	conflict_copy?: string;
};

export const fetchReview = (id: string): Promise<LoadedReview> => call(`/reviews/${id}`);

export const saveContent = (id: string, content: string, draft: Draft): Promise<null> =>
	call(`/reviews/${id}/content`, { method: 'PUT', body: JSON.stringify({ content, draft }) });

export const submitReview = (
	id: string,
	body: { content: string; comments: OutgoingComment[]; overall: string }
): Promise<SubmitOutcome> =>
	call(`/reviews/${id}/submit`, { method: 'POST', body: JSON.stringify(body) });

export const cancelReview = (id: string): Promise<null> =>
	call(`/reviews/${id}/cancel`, { method: 'POST' });

export const shutdownApp = (): Promise<null> => call('/shutdown', { method: 'POST' });

/**
 * A live connection is also how the daemon knows this tab is open, so a second
 * Review arrives here instead of opening another window at the reviewer.
 */
export function watchForReviews(onReview: (id: string) => void): () => void {
	const source = new EventSource(`/api/events?token=${encodeURIComponent(token())}`);
	source.onmessage = (message) => {
		const event = JSON.parse(message.data);
		if (event.kind === 'review') onReview(event.id);
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
