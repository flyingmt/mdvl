<script lang="ts">
	import { fenceBody } from '$lib/blocks';

	let { source, language }: { source: string; language: string | null } = $props();

	// A code sample is the one Block whose text must survive exactly, so it never
	// goes near the markdown pipeline.
	const code = $derived(fenceBody(source));
</script>

<!-- The look lives in app.css beside the other Block kinds; unlayered rules
	there beat Tailwind's `@layer utilities`, so utilities here would only be a
	second place to change the same thing. -->
<div class="block-code">
	{#if language}
		<span class="lang-badge">{language}</span>
	{/if}
	<pre><code>{code}</code></pre>
</div>
