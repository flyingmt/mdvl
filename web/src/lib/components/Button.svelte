<script lang="ts">
	import type { Snippet } from 'svelte';

	type Variant = 'primary' | 'quiet' | 'danger';

	let {
		variant = 'quiet',
		children,
		...rest
	}: {
		variant?: Variant;
		children: Snippet;
		[key: string]: unknown;
	} = $props();

	const looks: Record<Variant, string> = {
		primary: 'bg-neutral-900 text-white hover:bg-neutral-700',
		quiet: 'bg-white text-neutral-700 ring-1 ring-neutral-300 hover:bg-neutral-100',
		danger: 'bg-white text-red-700 ring-1 ring-red-300 hover:bg-red-50'
	};
</script>

<button
	type="button"
	class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 {looks[
		variant
	]}"
	{...rest}
>
	{@render children()}
</button>
