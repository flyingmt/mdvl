<script lang="ts">
	import { t } from '$lib/i18n';
</script>

<svelte:head><title>mdvl</title></svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
	<h1 class="text-lg font-semibold">{t.nothingTitle}</h1>
	<p class="mt-2 text-sm text-muted-foreground">{t.nothingBody}</p>
	<code class="mt-2 inline-block rounded bg-muted px-1.5 py-1 font-mono text-xs"
		>mdvl review &lt;path&gt;</code
	>
</main>
