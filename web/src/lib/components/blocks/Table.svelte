<script lang="ts">
	import { renderMarkdown } from '$lib/render';

	let {
		source,
		definitionSource,
		documentPath
	}: { source: string; definitionSource: string; documentPath: string } = $props();

	const html = $derived(renderMarkdown(source, definitionSource, documentPath));
</script>

<!--
	A wide table is the one thing that would otherwise push the whole document
	sideways, so it scrolls inside its own box.
-->
<div class="block-table overflow-x-auto">
	<!-- Sanitised in render.ts: the file is written by an agent and is not trusted. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="rendered w-max min-w-full">{@html html}</div>
</div>
