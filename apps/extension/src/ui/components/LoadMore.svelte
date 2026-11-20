<script lang="ts">
	import Icon from "./Icon.svelte";

	/** "Load more" under a paginated list; hidden on the last page. */
	let {
		list,
		label = "Load more",
	}: {
		list: { hasMore: boolean; loading: boolean; more: () => Promise<void> };
		label?: string;
	} = $props();
</script>

{#if list.hasMore}
	<div class="load-more">
		<button class="btn" type="button" onclick={() => list.more()} disabled={list.loading}>
			<Icon name="caret-down" size={14} />
			{list.loading ? "Loading…" : label}
		</button>
	</div>
{/if}

<style>
	.load-more {
		display: flex;
		justify-content: center;
		padding: 12px;
	}
</style>
