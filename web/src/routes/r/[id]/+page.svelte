<script lang="ts">
	import { Power } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import * as api from '$lib/api';
	import {
		insertAfter,
		lineRanges,
		parseDocument,
		removeBlock,
		replaceBlock,
		serialise,
		type Comment,
		type Document
	} from '$lib/blocks';
	import BlockView from '$lib/components/BlockView.svelte';
	import Button from '$lib/components/Button.svelte';
	import InsertionPoint from '$lib/components/InsertionPoint.svelte';

	let path = $state('');
	let doc = $state<Document>({ prelude: '', blocks: [] });
	let overall = $state('');
	let loading = $state(true);
	let problem = $state('');
	let confirmingEnd = $state(false);
	let outcome = $state<{ status: string; conflictCopy?: string } | null>(null);
	let stopped = $state(false);

	const id = $derived(page.params.id ?? '');
	const commentCount = $derived(
		doc.blocks.reduce((total, block) => total + block.comments.length, 0)
	);

	onMount(() => {
		let close = () => {};
		api
			.watchForReviews((arriving) => goto(resolve('/r/[id]', { id: arriving })))
			.then((stop) => (close = stop));
		// A tab being hidden may be a tab being closed, and the last keystroke is
		// still sitting in the debounce.
		const flush = () => void keep();
		addEventListener('pagehide', flush);
		addEventListener('visibilitychange', flush);
		return () => {
			close();
			removeEventListener('pagehide', flush);
			removeEventListener('visibilitychange', flush);
		};
	});

	$effect(() => {
		void load(id);
	});

	async function load(current: string) {
		if (!current) return;
		loading = true;
		problem = '';
		try {
			const review = await api.fetchReview(current);
			path = review.path;
			doc = restore(parseDocument(review.content), review.draft);
			overall = review.draft?.overall ?? '';
			outcome = review.state === 'pending' ? null : { status: review.state };
		} catch (error) {
			problem = describe(error);
		} finally {
			loading = false;
		}
	}

	/** Comments the reviewer left before the tab was closed, re-attached by position. */
	function restore(parsed: Document, draft: api.Draft | null): Document {
		if (!draft?.comments) return parsed;
		return {
			...parsed,
			blocks: parsed.blocks.map((block, index) => ({
				...block,
				comments: (draft.comments[index] ?? []).map(api.newComment)
			}))
		};
	}

	const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

	let pendingKeep: ReturnType<typeof setTimeout>;

	function keep() {
		clearTimeout(pendingKeep);
		if (!id || outcome) return Promise.resolve(null);
		return api
			.keepDraft(id, serialise(doc), {
				comments: doc.blocks.map((block) => block.comments.map((comment) => comment.body)),
				overall
			})
			.catch(() => null);
	}

	function touched() {
		clearTimeout(pendingKeep);
		pendingKeep = setTimeout(keep, 500);
	}

	function edit(index: number, markdown: string) {
		doc = replaceBlock(doc, index, markdown);
		touched();
	}

	function insert(index: number, markdown: string) {
		doc = insertAfter(doc, index, markdown);
		touched();
	}

	function drop(index: number) {
		doc = removeBlock(doc, index);
		touched();
	}

	function setComments(index: number, comments: Comment[]) {
		const blocks = [...doc.blocks];
		blocks[index] = { ...blocks[index], comments };
		doc = { ...doc, blocks };
		touched();
	}

	async function submit() {
		clearTimeout(pendingKeep);
		const ranges = lineRanges(doc);
		const comments = doc.blocks.flatMap((block, index) =>
			block.comments.map((comment) => ({
				lines: ranges[index],
				quote: api.quoteOf(block.source),
				body: comment.body
			}))
		);
		try {
			const result = await api.submitReview(id, {
				content: serialise(doc),
				comments,
				overall: overall.trim()
			});
			outcome = { status: result.status, conflictCopy: result.conflict_copy };
		} catch (error) {
			problem = describe(error);
		}
	}

	async function endReview() {
		clearTimeout(pendingKeep);
		try {
			await api.cancelReview(id);
			outcome = { status: 'cancelled' };
		} catch (error) {
			problem = describe(error);
		}
	}

	async function stopApp() {
		clearTimeout(pendingKeep);
		try {
			await api.shutdownApp();
		} catch {
			// The daemon exits mid-response; losing the connection is the success case.
		}
		stopped = true;
	}
</script>

<svelte:head><title>{path || 'Review'} — mdvl</title></svelte:head>

<div class="min-h-screen">
	<header
		class="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-neutral-200 bg-white/90 px-4 py-2.5 backdrop-blur"
	>
		<p class="truncate font-mono text-sm text-neutral-600">{path}</p>
		<Button onclick={stopApp} aria-label="Stop the mdvl app">
			<Power size={15} aria-hidden="true" />
			Stop app
		</Button>
	</header>

	<main class="mx-auto w-full max-w-[46rem] px-4 py-8">
		{#if stopped}
			<p class="rounded-lg bg-neutral-100 p-4 text-sm">mdvl has stopped. You can close this tab.</p>
		{:else if loading}
			<p class="text-sm text-neutral-500">Loading…</p>
		{:else if problem}
			<p class="rounded-lg bg-red-50 p-4 text-sm text-red-800">{problem}</p>
		{:else if outcome}
			<div class="rounded-lg border border-neutral-200 bg-white p-5 text-sm">
				{#if outcome.status === 'submitted'}
					<p class="font-medium">Sent to the agent.</p>
					<p class="mt-1 text-neutral-600">
						Your edits are saved. You can go back to the agent now.
					</p>
				{:else if outcome.status === 'cancelled'}
					<p class="font-medium">Review ended.</p>
					<p class="mt-1 text-neutral-600">Nothing was written to the file.</p>
				{:else}
					<p class="font-medium text-amber-900">The file changed while you were reviewing.</p>
					<p class="mt-1 text-neutral-600">
						Nothing was overwritten. Your version was kept at
						<code class="rounded bg-neutral-100 px-1 py-0.5 font-mono">{outcome.conflictCopy}</code>
						— the agent has been told where to find it.
					</p>
				{/if}
			</div>
		{:else}
			<InsertionPoint oninsert={(markdown) => insert(-1, markdown)} />
			{#each doc.blocks as block, index (block.id)}
				<BlockView
					{block}
					onchange={(markdown) => edit(index, markdown)}
					onremove={() => drop(index)}
					oncomments={(comments) => setComments(index, comments)}
				/>
				<InsertionPoint oninsert={(markdown) => insert(index, markdown)} />
			{/each}

			<div class="mt-10 border-t border-neutral-200 pt-6">
				<label for="overall" class="text-sm font-medium text-neutral-700">
					Anything about the document as a whole?
				</label>
				<textarea
					id="overall"
					bind:value={overall}
					oninput={touched}
					rows="3"
					placeholder="Optional — e.g. too long, wrong audience, missing a section"
					class="mt-2 w-full resize-y rounded-md bg-white p-3 text-sm ring-1 ring-neutral-300 outline-none focus:ring-neutral-900"
				></textarea>
			</div>
		{/if}
	</main>

	{#if !outcome && !loading && !problem && !stopped}
		<footer class="sticky bottom-0 border-t border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur">
			<div class="mx-auto flex w-full max-w-[46rem] items-center gap-3">
				<Button variant="primary" onclick={submit}>Submit</Button>
				{#if confirmingEnd}
					<span class="text-sm text-neutral-600">End without sending anything?</span>
					<Button variant="danger" onclick={endReview}>End review</Button>
					<Button onclick={() => (confirmingEnd = false)}>Keep reviewing</Button>
				{:else}
					<Button onclick={() => (confirmingEnd = true)}>End review</Button>
					<span class="ml-auto text-xs text-neutral-500">
						{commentCount}
						{commentCount === 1 ? 'comment' : 'comments'}
					</span>
				{/if}
			</div>
		</footer>
	{/if}
</div>
