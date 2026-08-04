<script lang="ts">
	import { renderMarkdown } from '$lib/render';

	let {
		source,
		definitionSource,
		documentPath
	}: { source: string; definitionSource: string; documentPath: string } = $props();

	const html = $derived(renderMarkdown(source, definitionSource, documentPath));
</script>

<!-- Sanitised in render.ts: the file is written by an agent and is not trusted. -->
<!-- eslint-disable-next-line svelte/no-at-html-tags -->
<div class="rendered block-heading">{@html html}</div>
