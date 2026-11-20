<script lang="ts">
	import type { DocumentPageStats } from "@bet/shared";
	import { dwellBars, formatDuration } from "../../lib/documents";

	let { pages, pageCount }: { pages: DocumentPageStats[]; pageCount?: number } = $props();

	const bars = $derived(dwellBars(pages, pageCount));
	const W = 600;
	const H = 140;
	const PAD_BOTTOM = 18;
	const slot = $derived(bars.length ? W / bars.length : W);
	const barW = $derived(Math.max(2, Math.min(36, slot * 0.7)));
	// Label every page when they fit, otherwise every nth.
	const every = $derived(Math.max(1, Math.ceil(bars.length / 24)));
</script>

{#if bars.length === 0}
	<p class="muted small">No page reading time yet.</p>
{:else}
	<svg viewBox="0 0 {W} {H}" role="img" aria-label="Reading time per page">
		<line x1="0" x2={W} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} class="axis" />
		{#each bars as b (b.page)}
			{@const h = Math.max(b.dwellMs > 0 ? 2 : 0, b.ratio * (H - PAD_BOTTOM - 8))}
			{@const x = b.page * slot - slot / 2}
			<g>
				<title>Page {b.page}: {formatDuration(b.dwellMs)}{b.views ? `, ${b.views} view${b.views === 1 ? "" : "s"}` : ""}</title>
				<rect x={x - slot / 2} y="0" width={slot} height={H} class="hit" />
				<rect x={x - barW / 2} y={H - PAD_BOTTOM - h} width={barW} height={h} rx="2" class="bar" />
				{#if (b.page - 1) % every === 0}
					<text x={x} y={H - 4} text-anchor="middle">{b.page}</text>
				{/if}
			</g>
		{/each}
	</svg>
{/if}

<style>
	svg {
		width: 100%;
		height: auto;
		display: block;
	}
	.axis {
		stroke: var(--border);
	}
	.hit {
		fill: transparent;
	}
	.bar {
		fill: var(--accent);
	}
	g:hover .bar {
		fill: var(--green);
	}
	text {
		font-size: 10px;
		fill: var(--text-muted);
	}
</style>
