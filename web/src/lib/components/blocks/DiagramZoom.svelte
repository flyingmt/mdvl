<script lang="ts">
	import { Expand, ZoomIn, ZoomOut } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import Mermaid from './Mermaid.svelte';

	let {
		source,
		open = $bindable(false),
		onclose
	}: {
		source: string;
		open?: boolean;
		/** Runs after every close, however it happened — focus returns to the ⤢. */
		onclose?: () => void;
	} = $props();

	const MIN = 0.25;
	const MAX = 4;
	const STEP_IN = 1.25;
	const STEP_OUT = 0.8;
	const PAN = 80;
	const TWEEN_MS = 150;

	let contentEl = $state<HTMLElement | null>(null);
	let viewport = $state<HTMLDivElement>();
	let canvas = $state<HTMLDivElement>();
	let x = $state(0);
	let y = $state(0);
	let s = $state(1);
	let dragging = $state(false);
	let tweenFrame = 0;

	// Fit is measured, not assumed: the canvas's layout size is the diagram's
	// natural size (offsetWidth ignores every transform above it, including the
	// dialog's own entrance animation). Mermaid emits width="100%" capped by
	// max-width, which collapses to the 300px replaced-element default in the
	// unconstrained canvas — pin the modal's copy to its viewBox size first.
	function fit(tween: boolean) {
		if (!viewport || !canvas) return;
		const svg = canvas.querySelector('svg') as SVGSVGElement | null;
		if (!svg) return;
		const vb = svg.viewBox.baseVal;
		if (vb.width > 0 && vb.height > 0) {
			svg.style.width = `${vb.width}px`;
			svg.style.height = `${vb.height}px`;
		}
		const sw = canvas.offsetWidth;
		const sh = canvas.offsetHeight;
		if (!sw || !sh) return;
		const vw = viewport.clientWidth;
		const vh = viewport.clientHeight;
		const ns = Math.min(vw / sw, vh / sh);
		jumpTo((vw - sw * ns) / 2, (vh - sh * ns) / 2, ns, tween);
	}

	// The modal renders its own mermaid SVG from the same fence; once it lands,
	// measure it and open at fit. A fresh canvas (reopen) starts from scratch.
	$effect(() => {
		const cv = canvas;
		if (!cv) return;
		x = 0;
		y = 0;
		s = 1;
		const tryFit = () => {
			if (cv.querySelector('svg')) {
				fit(false);
				obs.disconnect();
			}
		};
		const obs = new MutationObserver(tryFit);
		obs.observe(cv, { childList: true, subtree: true });
		tryFit();
		return () => {
			obs.disconnect();
			cancelAnimationFrame(tweenFrame);
		};
	});

	function reducedMotion() {
		return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	// Discrete jumps tween over ~150ms so the eye keeps its place; wheel and
	// drag stay 1:1 with the input and never pass through here with tween=true.
	function jumpTo(nx: number, ny: number, ns: number, tween: boolean) {
		cancelAnimationFrame(tweenFrame);
		if (!tween || reducedMotion()) {
			x = nx;
			y = ny;
			s = ns;
			return;
		}
		const fx = x;
		const fy = y;
		const fs = s;
		const start = performance.now();
		const step = (now: number) => {
			const k = Math.min(1, (now - start) / TWEEN_MS);
			const e = 1 - (1 - k) ** 3;
			x = fx + (nx - fx) * e;
			y = fy + (ny - fy) * e;
			s = fs + (ns - fs) * e;
			if (k < 1) tweenFrame = requestAnimationFrame(step);
		};
		tweenFrame = requestAnimationFrame(step);
	}

	// Zoom-to-cursor keeps the point under (cx, cy) fixed: p′ = c − (c − p)·(s′/s).
	function zoomAt(cx: number, cy: number, factor: number, tween: boolean) {
		const ns = Math.min(MAX, Math.max(MIN, s * factor));
		jumpTo(cx - (cx - x) * (ns / s), cy - (cy - y) * (ns / s), ns, tween);
	}

	// Buttons and keys zoom about the centre because there is no cursor to anchor to.
	function zoomFromCenter(factor: number) {
		if (!viewport) return;
		zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor, true);
	}

	$effect(() => {
		const vp = viewport;
		if (!vp) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const rect = vp.getBoundingClientRect();
			zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.002), false);
		};
		vp.addEventListener('wheel', onWheel, { passive: false });
		return () => vp.removeEventListener('wheel', onWheel);
	});

	let dragFrom: { px: number; py: number; x: number; y: number } | null = null;

	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragFrom = { px: e.clientX, py: e.clientY, x, y };
		dragging = true;
	}

	function move(e: PointerEvent) {
		if (!dragFrom) return;
		cancelAnimationFrame(tweenFrame);
		x = dragFrom.x + (e.clientX - dragFrom.px);
		y = dragFrom.y + (e.clientY - dragFrom.py);
	}

	function up() {
		dragFrom = null;
		dragging = false;
	}

	function dblclick(e: MouseEvent) {
		if (!viewport) return;
		const rect = viewport.getBoundingClientRect();
		zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.shiftKey ? STEP_OUT : STEP_IN, true);
	}

	// Map-style: ArrowRight moves the view east, so the diagram shifts left.
	function keys(e: KeyboardEvent) {
		const pan = e.shiftKey ? PAN * 4 : PAN;
		switch (e.key) {
			case 'ArrowRight':
				jumpTo(x - pan, y, s, true);
				break;
			case 'ArrowLeft':
				jumpTo(x + pan, y, s, true);
				break;
			case 'ArrowDown':
				jumpTo(x, y - pan, s, true);
				break;
			case 'ArrowUp':
				jumpTo(x, y + pan, s, true);
				break;
			case '+':
			case '=':
				zoomFromCenter(STEP_IN);
				break;
			case '-':
			case '_':
				zoomFromCenter(STEP_OUT);
				break;
			case '0':
				fit(true);
				break;
			default:
				return;
		}
		e.preventDefault();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		bind:ref={contentEl}
		aria-label={t.diagramZoomTitle}
		tabindex={-1}
		class="flex h-[calc(100vh-4rem)] max-w-[calc(100vw-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100vw-4rem)]"
		onOpenAutoFocus={(e) => {
			e.preventDefault();
			contentEl?.focus();
		}}
		onCloseAutoFocus={(e) => {
			e.preventDefault();
			onclose?.();
		}}
		onkeydown={keys}
	>
		<div class="flex items-center border-b border-border px-4 py-2">
			<span class="text-sm font-medium">{t.diagramZoomTitle}</span>
		</div>
		<div class="relative min-h-0 flex-1">
			<!-- The pan surface; every gesture here has a button or key equivalent. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<!-- eslint-disable-next-line svelte/no-static-element-interactions -->
			<div
				bind:this={viewport}
				class="absolute inset-0 touch-none overflow-hidden select-none {dragging
					? 'cursor-grabbing'
					: 'cursor-grab'}"
				onpointerdown={down}
				onpointermove={move}
				onpointerup={up}
				onpointercancel={up}
				ondblclick={dblclick}
			>
				<div
					bind:this={canvas}
					class="w-max origin-top-left"
					style="transform: translate({x}px, {y}px) scale({s});"
				>
					<Mermaid {source} />
				</div>
			</div>
			<div class="absolute top-3 right-3 flex gap-1">
				<Button
					variant="outline"
					size="icon-sm"
					onclick={() => zoomFromCenter(STEP_IN)}
					aria-label={t.zoomIn}
				>
					<ZoomIn aria-hidden="true" />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onclick={() => zoomFromCenter(STEP_OUT)}
					aria-label={t.zoomOut}
				>
					<ZoomOut aria-hidden="true" />
				</Button>
				<Button
					variant="outline"
					size="icon-sm"
					onclick={() => fit(true)}
					aria-label={t.fitToScreen}
				>
					<Expand aria-hidden="true" />
				</Button>
			</div>
			<p class="pointer-events-none absolute bottom-3 left-3 text-xs text-muted-foreground">
				{t.diagramZoomHint}
			</p>
		</div>
	</Dialog.Content>
</Dialog.Root>
