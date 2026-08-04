<script lang="ts">
	import { Maximize2, MessageSquarePlus, Pencil, Trash2, X } from '@lucide/svelte';
	import { newComment } from '$lib/api';
	import type { Block, Comment } from '$lib/blocks';
	import { t } from '$lib/i18n';
	import { editorKeys, takeFocus } from '$lib/editors';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Textarea } from '$lib/components/ui/textarea';
	import Blockquote from './blocks/Blockquote.svelte';
	import CodeFence from './blocks/CodeFence.svelte';
	import DiagramZoom from './blocks/DiagramZoom.svelte';
	import Heading from './blocks/Heading.svelte';
	import List from './blocks/List.svelte';
	import Mermaid from './blocks/Mermaid.svelte';
	import Paragraph from './blocks/Paragraph.svelte';
	import Table from './blocks/Table.svelte';

	let {
		block,
		definitionSource,
		documentPath,
		readonly = false,
		onchange,
		onremove,
		oncomments
	}: {
		block: Block;
		definitionSource: string;
		/** Where the document sits, so an address relative to it can be followed. */
		documentPath: string;
		/** A view shows the Block exactly as drawn — no control that could change it. */
		readonly?: boolean;
		onchange?: (markdown: string) => void;
		onremove?: () => void;
		oncomments?: (comments: Comment[]) => void;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let commenting = $state(false);
	let commentDraft = $state('');
	let confirmingRemoval = $state(false);
	let diagramZoomable = $state(false);
	let zooming = $state(false);
	let zoomEntry = $state<HTMLButtonElement | null>(null);

	function startEditing() {
		draft = block.source;
		editing = true;
	}

	function applyEdit() {
		editing = false;
		if (draft === block.source) return;
		// Emptying the editor is a deletion, and deletions ask first when the
		// Block carries comments.
		if (draft.trim() === '') {
			remove();
			return;
		}
		onchange?.(draft);
	}

	function addComment() {
		const body = commentDraft.trim();
		if (body) oncomments?.([...block.comments, newComment(body)]);
		commentDraft = '';
		commenting = false;
	}

	function dropComment(id: string) {
		oncomments?.(block.comments.filter((comment) => comment.id !== id));
	}

	function remove() {
		if (block.comments.length > 0) {
			confirmingRemoval = true;
			return;
		}
		onremove?.();
	}
</script>

<div class="block-view group relative" data-testid="block">
	{#if !readonly}
		<div
			class="absolute -top-3 right-0 z-10 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-within:opacity-100"
		>
			{#if !editing}
				{#if block.kind === 'mermaid' && diagramZoomable}
					<Button
						variant="outline"
						size="icon-sm"
						bind:ref={zoomEntry}
						onclick={() => (zooming = true)}
						aria-label={t.zoomIntoDiagram}
					>
						<Maximize2 aria-hidden="true" />
					</Button>
				{/if}
				<Button variant="outline" size="icon-sm" onclick={startEditing} aria-label={t.editBlock}>
					<Pencil aria-hidden="true" />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onclick={() => (commenting = true)}
					aria-label={t.commentOnBlock}
				>
					<MessageSquarePlus aria-hidden="true" />
				</Button>
				<Button variant="destructive" size="icon-sm" onclick={remove} aria-label={t.deleteBlock}>
					<Trash2 aria-hidden="true" />
				</Button>
			{/if}
		</div>
	{/if}
	{#if readonly && block.kind === 'mermaid' && diagramZoomable}
		<div class="absolute -top-3 right-0 z-10">
			<Button
				variant="outline"
				size="icon-sm"
				bind:ref={zoomEntry}
				onclick={() => (zooming = true)}
				aria-label={t.zoomIntoDiagram}
			>
				<Maximize2 aria-hidden="true" />
			</Button>
		</div>
	{/if}

	{#if editing}
		<div class="rounded-lg ring-2 ring-ring">
			<Textarea
				bind:value={draft}
				onkeydown={editorKeys(applyEdit, () => (editing = false))}
				{@attach takeFocus}
				rows={Math.max(3, draft.split('\n').length + 1)}
				aria-label={t.blockSource}
				class="rounded-b-none border-0 font-mono text-sm leading-relaxed focus-visible:ring-0"
			/>
			<div class="flex items-center gap-2 rounded-b-lg border-t border-border bg-muted px-3 py-2">
				<Button size="sm" onclick={applyEdit}>{t.done}</Button>
				<Button variant="outline" size="sm" onclick={() => (editing = false)}>{t.cancel}</Button>
				<span class="text-xs text-muted-foreground">{t.editorHint}</span>
			</div>
		</div>
	{:else if block.kind === 'heading'}
		<Heading source={block.source} {definitionSource} {documentPath} />
	{:else if block.kind === 'list'}
		<List source={block.source} {definitionSource} {documentPath} />
	{:else if block.kind === 'blockquote'}
		<Blockquote source={block.source} {definitionSource} {documentPath} />
	{:else if block.kind === 'table'}
		<Table source={block.source} {definitionSource} {documentPath} />
	{:else if block.kind === 'mermaid'}
		<Mermaid
			source={block.source}
			bind:zoomable={diagramZoomable}
			onzoom={() => (zooming = true)}
		/>
	{:else if block.kind === 'code'}
		<CodeFence source={block.source} language={block.language} />
	{:else}
		<Paragraph source={block.source} {definitionSource} {documentPath} />
	{/if}

	{#if block.comments.length > 0 || commenting}
		<ul class="mt-2 space-y-1.5 border-l-2 border-amber-400 pl-3">
			{#each block.comments as comment (comment.id)}
				<li class="flex items-start gap-2 text-sm">
					<span class="flex-1 whitespace-pre-wrap">{comment.body}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						onclick={() => dropComment(comment.id)}
						aria-label={t.removeComment}
					>
						<X aria-hidden="true" />
					</Button>
				</li>
			{/each}
			{#if commenting}
				<li>
					<Textarea
						bind:value={commentDraft}
						onkeydown={editorKeys(addComment, () => (commenting = false))}
						{@attach takeFocus}
						rows={2}
						placeholder={t.newCommentPlaceholder}
						aria-label={t.newCommentLabel}
						class="text-sm"
					/>
					<div class="mt-1 flex gap-2">
						<Button size="sm" onclick={addComment}>{t.addComment}</Button>
						<Button variant="outline" size="sm" onclick={() => (commenting = false)}>
							{t.cancel}
						</Button>
					</div>
				</li>
			{/if}
		</ul>
	{/if}
</div>

{#if block.kind === 'mermaid'}
	<DiagramZoom source={block.source} bind:open={zooming} onclose={() => zoomEntry?.focus()} />
{/if}

<Dialog.Root bind:open={confirmingRemoval}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t.deleteWithComments(block.comments.length)}</Dialog.Title>
		</Dialog.Header>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (confirmingRemoval = false)}>{t.keepBlock}</Button>
			<Button variant="destructive" onclick={() => onremove?.()}>{t.deleteAnyway}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
