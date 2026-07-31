<script lang="ts">
	import { newComment } from '$lib/api';
	import type { Block, Comment } from '$lib/blocks';
	import { renderMarkdown } from '$lib/render';
	import Button from './Button.svelte';
	import Mermaid from './Mermaid.svelte';

	let {
		block,
		onchange,
		onremove,
		oncomments
	}: {
		block: Block;
		onchange: (markdown: string) => void;
		onremove: () => void;
		oncomments: (comments: Comment[]) => void;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let commenting = $state(false);
	let commentDraft = $state('');
	let confirmingRemoval = $state(false);

	const isDiagram = $derived(block.language === 'mermaid');
	const html = $derived(isDiagram ? '' : renderMarkdown(block.source));

	/** The text inside a fence, without its ``` lines. */
	const diagram = $derived.by(() => {
		const lines = block.source.split('\n');
		const closed = /^\s*(```|~~~)/.test(lines[lines.length - 1] ?? '');
		return lines.slice(1, closed ? -1 : undefined).join('\n');
	});

	function startEditing() {
		draft = block.source;
		editing = true;
	}

	function saveEdit() {
		editing = false;
		if (draft !== block.source) onchange(draft);
	}

	function keysInEditor(event: KeyboardEvent) {
		if (event.key === 'Escape') editing = false;
		if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) saveEdit();
	}

	function addComment() {
		const body = commentDraft.trim();
		if (body) oncomments([...block.comments, newComment(body)]);
		commentDraft = '';
		commenting = false;
	}

	function dropComment(id: string) {
		oncomments(block.comments.filter((comment) => comment.id !== id));
	}

	function remove() {
		if (block.comments.length > 0 && !confirmingRemoval) {
			confirmingRemoval = true;
			return;
		}
		onremove();
	}
</script>

<div class="group relative" data-testid="block">
	<div class="absolute -top-2 right-0 z-10 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100">
		{#if !editing}
			<Button onclick={startEditing} aria-label="Edit this block" title="Edit">✎</Button>
			<Button onclick={() => (commenting = true)} aria-label="Comment on this block" title="Comment">
				💬
			</Button>
			<Button variant="danger" onclick={remove} aria-label="Delete this block" title="Delete">
				✕
			</Button>
		{/if}
	</div>

	{#if editing}
		<div class="rounded-lg ring-2 ring-neutral-900">
			<!-- svelte-ignore a11y_autofocus -->
			<textarea
				bind:value={draft}
				onkeydown={keysInEditor}
				autofocus
				rows={Math.max(3, draft.split('\n').length + 1)}
				aria-label="Markdown source of this block"
				class="w-full resize-y rounded-t-lg bg-white p-3 font-mono text-sm leading-relaxed outline-none"
			></textarea>
			<div class="flex items-center gap-2 rounded-b-lg border-t border-neutral-200 bg-neutral-50 px-3 py-2">
				<Button variant="primary" onclick={saveEdit}>Done</Button>
				<Button onclick={() => (editing = false)}>Cancel</Button>
				<span class="text-xs text-neutral-500">⌘↵ to finish · Esc to discard</span>
			</div>
		</div>
	{:else if isDiagram}
		<Mermaid source={diagram} />
	{:else}
		<div class="rendered">{@html html}</div>
	{/if}

	{#if confirmingRemoval}
		<div class="mt-2 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
			<span>Delete this block and its {block.comments.length} comment(s)?</span>
			<Button variant="danger" onclick={onremove}>Delete</Button>
			<Button onclick={() => (confirmingRemoval = false)}>Keep</Button>
		</div>
	{/if}

	{#if block.comments.length > 0 || commenting}
		<ul class="mt-2 space-y-1.5 border-l-2 border-amber-400 pl-3">
			{#each block.comments as comment (comment.id)}
				<li class="flex items-start gap-2 text-sm text-neutral-800">
					<span class="flex-1 whitespace-pre-wrap">{comment.body}</span>
					<button
						type="button"
						onclick={() => dropComment(comment.id)}
						aria-label="Remove this comment"
						class="rounded px-1 text-neutral-400 hover:text-red-700">✕</button
					>
				</li>
			{/each}
			{#if commenting}
				<li>
					<!-- svelte-ignore a11y_autofocus -->
					<textarea
						bind:value={commentDraft}
						autofocus
						rows="2"
						placeholder="What should the agent do here?"
						aria-label="New comment on this block"
						onkeydown={(event) => {
							if (event.key === 'Escape') commenting = false;
							if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) addComment();
						}}
						class="w-full resize-y rounded-md bg-white p-2 text-sm ring-1 ring-neutral-300 outline-none focus:ring-neutral-900"
					></textarea>
					<div class="mt-1 flex gap-2">
						<Button variant="primary" onclick={addComment}>Add comment</Button>
						<Button onclick={() => (commenting = false)}>Cancel</Button>
					</div>
				</li>
			{/if}
		</ul>
	{/if}
</div>
