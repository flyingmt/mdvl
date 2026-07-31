<script lang="ts">
	import Button from './Button.svelte';

	let { oninsert }: { oninsert: (markdown: string) => void } = $props();

	let open = $state(false);
	let draft = $state('');

	function add() {
		const text = draft.trim();
		if (text) oninsert(text);
		draft = '';
		open = false;
	}
</script>

{#if open}
	<div class="my-2 rounded-lg ring-2 ring-neutral-900">
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			bind:value={draft}
			autofocus
			rows="3"
			placeholder="New block…"
			aria-label="Markdown for the new block"
			onkeydown={(event) => {
				if (event.key === 'Escape') open = false;
				if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) add();
			}}
			class="w-full resize-y rounded-t-lg bg-white p-3 font-mono text-sm outline-none"
		></textarea>
		<div class="flex gap-2 rounded-b-lg border-t border-neutral-200 bg-neutral-50 px-3 py-2">
			<Button variant="primary" onclick={add}>Insert</Button>
			<Button onclick={() => (open = false)}>Cancel</Button>
		</div>
	</div>
{:else}
	<div class="group/insert relative h-5">
		<button
			type="button"
			onclick={() => (open = true)}
			aria-label="Insert a block here"
			data-testid="insertion-point"
			class="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-2 opacity-0 transition-opacity group-hover/insert:opacity-100 focus:opacity-100"
		>
			<span class="h-px flex-1 bg-neutral-300"></span>
			<span class="rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-xs text-neutral-500"
				>+</span
			>
			<span class="h-px flex-1 bg-neutral-300"></span>
		</button>
	</div>
{/if}
