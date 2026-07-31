<script lang="ts" module>
	let counter = 0;
</script>

<script lang="ts">
	let { source }: { source: string } = $props();

	let svg = $state('');
	let failure = $state('');

	$effect(() => {
		const diagram = source;
		const name = `mermaid-${(counter += 1)}`;
		let abandoned = false;

		(async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
				const drawn = await mermaid.render(name, diagram);
				if (abandoned) return;
				svg = drawn.svg;
				failure = '';
			} catch (error) {
				if (abandoned) return;
				svg = '';
				failure = error instanceof Error ? error.message : String(error);
				// A failed render can leave its scratch element behind.
				document.getElementById(`d${name}`)?.remove();
			}
		})();

		return () => {
			abandoned = true;
		};
	});
</script>

{#if failure}
	<div class="rounded-lg border border-amber-300 bg-amber-50 p-3">
		<p class="text-sm font-medium text-amber-900">This diagram could not be drawn.</p>
		<p class="mt-1 font-mono text-xs whitespace-pre-wrap text-amber-800">{failure}</p>
		<pre
			class="mt-2 overflow-x-auto rounded bg-white/70 p-2 font-mono text-xs text-neutral-700">{source}</pre>
	</div>
{:else if svg}
	<!-- mermaid draws this from the fence's text under securityLevel: strict; the -->
	<!-- markup is its own, not the file's. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	<div class="overflow-x-auto text-center" data-testid="diagram">{@html svg}</div>
{:else}
	<div class="h-24 animate-pulse rounded-lg bg-neutral-100"></div>
{/if}
