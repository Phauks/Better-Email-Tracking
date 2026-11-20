<script lang="ts">
	import type { Snippet } from "svelte";

	/**
	 * Loading / error / empty states around a list, the same in every dashboard view.
	 * An error shows above the list (it may come from an action on one row); the list
	 * itself renders only when there is something in it.
	 */
	let {
		loading = false,
		error = "",
		isEmpty,
		empty = "Nothing here yet.",
		children,
	}: {
		loading?: boolean;
		error?: string;
		isEmpty: boolean;
		/** Text, or a snippet for a richer empty state (e.g. with a call to action). */
		empty?: string | Snippet;
		children: Snippet;
	} = $props();
</script>

{#if error}<p class="bad" role="alert">{error}</p>{/if}
{#if !isEmpty}
	{@render children()}
{:else if loading}
	<p class="empty muted">Loading…</p>
{:else if !error}
	{#if typeof empty === "string"}
		<p class="empty muted">{empty}</p>
	{:else}
		{@render empty()}
	{/if}
{/if}
