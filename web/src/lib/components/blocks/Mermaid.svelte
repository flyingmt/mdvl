<script lang="ts" module>
	let counter = 0;
</script>

<script lang="ts">
	import { fenceBody } from '$lib/blocks';
	import { t } from '$lib/i18n';

	let {
		source,
		// eslint-disable-next-line no-useless-assignment -- the parent reads this through bind:zoomable
		zoomable = $bindable(),
		onzoom
	}: {
		source: string;
		/** True only while a drawn diagram is on screen — never while loading or failed. */
		zoomable?: boolean;
		/** The drawn diagram is itself an entry into the zoom modal. */
		onzoom?: () => void;
	} = $props();

	let svg = $state('');
	let failure = $state('');

	const diagram = $derived(fenceBody(source));

	$effect(() => {
		const drawing = diagram;
		const name = `mermaid-${(counter += 1)}`;
		let abandoned = false;

		(async () => {
			try {
				const mermaid = (await import('mermaid')).default;
				mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' });
				const drawn = await mermaid.render(name, drawing);
				if (abandoned) return;
				svg = drawn.svg;
				failure = '';
				zoomable = true;
			} catch (error) {
				if (abandoned) return;
				svg = '';
				zoomable = false;
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
		<p class="text-sm font-medium text-amber-900">{t.diagramFailed}</p>
		<p class="mt-1 font-mono text-xs whitespace-pre-wrap text-amber-800">{failure}</p>
		<pre
			class="mt-2 overflow-x-auto rounded bg-white/70 p-2 font-mono text-xs text-neutral-700">{diagram}</pre>
	</div>
{:else if svg}
	<!-- mermaid draws this from the fence's text under securityLevel: strict; the -->
	<!-- markup is its own, not the file's. The ⤢ button is the keyboard entry. -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<!-- eslint-disable-next-line svelte/no-static-element-interactions, svelte/click-events-have-key-events -->
	<div
		class="overflow-x-auto text-center {onzoom ? 'cursor-zoom-in' : ''}"
		data-testid="diagram"
		onclick={() => onzoom?.()}
	>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html svg}
	</div>
{:else}
	<div class="h-24 animate-pulse rounded-lg bg-muted"></div>
{/if}
