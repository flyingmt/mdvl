<script lang="ts">
	import { Power } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
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
	import { t } from '$lib/i18n';
	import BlockView from '$lib/components/BlockView.svelte';
	import InsertionPoint from '$lib/components/InsertionPoint.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';

	let path = $state('');
	let doc = $state<Document>({ prelude: '', blocks: [] });
	let overall = $state('');
	let loading = $state(true);
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
			.then((stop) => (close = stop))
			.catch((error) => toast.error(t.couldNotOpen, { description: describe(error) }));
		// A tab being hidden may be a tab being closed, and the last keystroke is
		// still sitting in the debounce. The request has to outlive the page.
		const flush = () => void keep(true);
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
		try {
			const review = await api.fetchReview(current);
			path = review.path;
			doc = restore(parseDocument(review.content), review.draft);
			overall = review.draft?.overall ?? '';
			outcome = review.state === 'pending' ? null : { status: review.state };
		} catch (error) {
			toast.error(t.couldNotLoad, { description: describe(error) });
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

	function keep(survivingTheTab = false) {
		clearTimeout(pendingKeep);
		if (!id || outcome) return Promise.resolve(null);
		return api
			.keepDraft(
				id,
				serialise(doc),
				{
					comments: doc.blocks.map((block) => block.comments.map((comment) => comment.body)),
					overall
				},
				survivingTheTab
			)
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
			toast.error(t.couldNotSubmit, { description: describe(error) });
		}
	}

	async function endReview() {
		clearTimeout(pendingKeep);
		confirmingEnd = false;
		try {
			await api.cancelReview(id);
			outcome = { status: 'cancelled' };
		} catch (error) {
			toast.error(t.couldNotEnd, { description: describe(error) });
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
		class="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur"
	>
		<p class="truncate font-mono text-sm text-muted-foreground">{path}</p>
		<Button variant="outline" size="sm" onclick={stopApp}>
			<Power aria-hidden="true" />
			{t.stopApp}
		</Button>
	</header>

	<main class="mx-auto w-full max-w-[46rem] px-4 py-8">
		{#if stopped}
			<p class="rounded-lg bg-muted p-4 text-sm">{t.stoppedApp}</p>
		{:else if loading}
			<p class="text-sm text-muted-foreground">{t.loading}</p>
		{:else if outcome}
			<div class="rounded-lg border border-border p-5 text-sm">
				{#if outcome.status === 'submitted'}
					<p class="font-medium">{t.sentTitle}</p>
					<p class="mt-1 text-muted-foreground">{t.sentBody}</p>
				{:else if outcome.status === 'cancelled'}
					<p class="font-medium">{t.endedTitle}</p>
					<p class="mt-1 text-muted-foreground">{t.endedBody}</p>
				{:else}
					<p class="font-medium text-amber-900">{t.conflictTitle}</p>
					<p class="mt-1 text-muted-foreground">{t.conflictKept}</p>
					<code class="mt-2 inline-block rounded bg-muted px-1.5 py-1 font-mono"
						>{outcome.conflictCopy}</code
					>
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

			<div class="mt-10 border-t border-border pt-6">
				<label for="overall" class="text-sm font-medium">{t.overallLabel}</label>
				<Textarea
					id="overall"
					bind:value={overall}
					oninput={touched}
					rows={3}
					placeholder={t.overallPlaceholder}
					class="mt-2 text-sm"
				/>
			</div>
		{/if}
	</main>

	{#if !outcome && !loading && !stopped}
		<footer class="sticky bottom-0 border-t border-border bg-background/90 px-4 py-3 backdrop-blur">
			<div class="mx-auto flex w-full max-w-[46rem] items-center gap-3">
				<Button onclick={submit}>{t.submit}</Button>
				<Button variant="outline" onclick={() => (confirmingEnd = true)}>{t.endReview}</Button>
				<span class="ml-auto text-xs text-muted-foreground">{t.commentCount(commentCount)}</span>
			</div>
		</footer>
	{/if}
</div>

<Dialog.Root bind:open={confirmingEnd}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t.endReviewTitle}</Dialog.Title>
			<Dialog.Description>{t.endReviewBody}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmingEnd = false)}>{t.keepReviewing}</Button>
			<Button variant="destructive" onclick={endReview}>{t.endReview}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
