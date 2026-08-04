<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import * as api from '$lib/api';
	import { parseDocument, referenceDefinitionSource, type Document } from '$lib/blocks';
	import { t } from '$lib/i18n';
	import BlockView from '$lib/components/BlockView.svelte';

	let path = $state('');
	let doc = $state<Document>({ prelude: '', blocks: [] });
	let loading = $state(true);
	const definitionSource = $derived(referenceDefinitionSource(doc));

	// A view is a snapshot: the file is read once, here, and never again. Seeing
	// newer bytes means re-running `mdvl view`. This tab is also not a viewer —
	// nothing here subscribes to /api/events, so a later review still opens its
	// own tab.
	onMount(async () => {
		const wanted = page.url.searchParams.get('p') ?? '';
		try {
			const content = await api.fetchViewContent(wanted);
			path = wanted;
			doc = parseDocument(content);
		} catch (error) {
			toast.error(t.couldNotLoadView, {
				description: error instanceof Error ? error.message : String(error)
			});
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head><title>{path || 'View'} — mdvl</title></svelte:head>

<div class="min-h-screen">
	<header
		class="sticky top-0 z-20 flex items-center gap-4 border-b border-border bg-background/90 px-4 py-2.5 backdrop-blur"
	>
		<p class="truncate font-mono text-sm text-muted-foreground">{path}</p>
	</header>

	<main class="mx-auto w-full max-w-[46rem] px-4 py-8">
		{#if loading}
			<p class="text-sm text-muted-foreground">{t.loading}</p>
		{:else}
			{#each doc.blocks as block (block.id)}
				<BlockView {block} {definitionSource} documentPath={path} readonly />
			{/each}
		{/if}
	</main>
</div>
