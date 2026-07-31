<script lang="ts">
	import { Plus } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { editorKeys, takeFocus } from '$lib/keys';
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';

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
	<div class="my-2 rounded-lg ring-2 ring-ring">
		<Textarea
			bind:value={draft}
			onkeydown={editorKeys(add, () => (open = false))}
			{@attach takeFocus}
			rows={3}
			placeholder={t.newBlockPlaceholder}
			aria-label={t.newBlockLabel}
			class="rounded-b-none border-0 font-mono text-sm focus-visible:ring-0"
		/>
		<div class="flex gap-2 rounded-b-lg border-t border-border bg-muted px-3 py-2">
			<Button size="sm" onclick={add}>{t.insert}</Button>
			<Button variant="outline" size="sm" onclick={() => (open = false)}>{t.cancel}</Button>
		</div>
	</div>
{:else}
	<div class="group/insert relative h-5">
		<button
			type="button"
			onclick={() => (open = true)}
			aria-label={t.insertHere}
			data-testid="insertion-point"
			class="absolute inset-x-0 top-1/2 flex -translate-y-1/2 items-center gap-2 opacity-0 transition-opacity group-hover/insert:opacity-100 focus:opacity-100"
		>
			<span class="h-px flex-1 bg-border"></span>
			<span class="rounded-full border border-border bg-background p-0.5 text-muted-foreground">
				<Plus size={12} aria-hidden="true" />
			</span>
			<span class="h-px flex-1 bg-border"></span>
		</button>
	</div>
{/if}
