<script lang="ts">
	import { fenceBody } from '$lib/blocks';

	let { source, language }: { source: string; language: string | null } = $props();

	// A code sample is the one Block whose text must survive exactly, so it never
	// goes near the markdown pipeline.
	const code = $derived(fenceBody(source));
</script>

<div class="block-code relative">
	{#if language}
		<span
			class="absolute top-2 right-3 font-mono text-[0.6875rem] tracking-wide text-muted-foreground select-none"
		>
			{language}
		</span>
	{/if}
	<pre
		class="overflow-x-auto rounded-lg bg-muted p-3.5 font-mono text-[0.8125rem] leading-relaxed"><code
			>{code}</code
		></pre>
</div>
