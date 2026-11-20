<script lang="ts">
	import type { ConnectorKind } from "@bet/shared";
	import { onMount } from "svelte";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";

	/**
	 * Warns, where follow-ups are being set up, that they can't be sent because no
	 * mailbox is connected. Silent while checking and when connected.
	 */
	let { kind = "google", label = "Gmail" }: { kind?: ConnectorKind; label?: string } = $props();

	let state = $state<"checking" | "connected" | "disconnected" | "error">("checking");

	onMount(async () => {
		try {
			const res = await (await pageApi()).connectorStatus();
			state = res.connectors.find((c) => c.kind === kind)?.connected ? "connected" : "disconnected";
		} catch {
			state = "error";
		}
	});
</script>

{#if state === "disconnected"}
	<p class="warn small">
		<Icon name="warning" />
		<span>
			{label} not connected: follow-ups won't be sent until you connect it.
			<button type="button" class="link" onclick={() => chrome.runtime.openOptionsPage()}>Open settings</button>
		</span>
	</p>
{:else if state === "error"}
	<p class="warn small"><Icon name="warning" /> Couldn't check the {label} connection.</p>
{/if}

<style>
	.warn {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius);
		background: var(--danger-soft);
		color: var(--danger);
	}
	.link {
		border: 0;
		padding: 0;
		background: none;
		color: inherit;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
