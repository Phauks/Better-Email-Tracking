<script lang="ts">
	import { onMount } from "svelte";
	import { isConfigured, loadSettings } from "../../settings";
	import Icon from "../components/Icon.svelte";
	import NotConfigured from "../components/NotConfigured.svelte";
	import Documents from "../documents/Documents.svelte";
	import Emails from "../emails/Emails.svelte";
	import FollowUps from "../follow-ups/FollowUps.svelte";
	import type { IconName } from "../icons";
	import MailMerge from "../mail-merge/MailMerge.svelte";

	/**
	 * The dashboard shell: one tab per feature view, routed by the URL hash
	 * (#documents, #merge, #followups; anything else, including #message=<id>, is Emails).
	 * To add a view, add it to VIEWS and to the {#if} chain below.
	 */
	type View = "emails" | "documents" | "merge" | "followups";
	const VIEWS: { id: View; label: string; icon: IconName }[] = [
		{ id: "emails", label: "Emails", icon: "envelope-simple-open" },
		{ id: "documents", label: "Documents", icon: "file-text" },
		{ id: "merge", label: "Mail merge", icon: "paper-plane-tilt" },
		{ id: "followups", label: "Follow-ups", icon: "alarm" },
	];
	const viewFromHash = (): View => VIEWS.find((v) => v.id !== "emails" && location.hash === `#${v.id}`)?.id ?? "emails";
	const focusFromHash = () => /message=([0-9A-Za-z]+)/.exec(location.hash)?.[1] ?? null;

	let view = $state<View>(viewFromHash());
	let focusId = $state<string | null>(focusFromHash());
	let configured = $state<boolean | null>(null);

	function showView(v: View) {
		view = v;
		focusId = null;
		history.replaceState(null, "", v === "emails" ? location.pathname : `#${v}`);
	}

	/** Opens a message in the Emails view (used by Follow-ups). */
	function openMessage(id: string) {
		location.hash = `message=${id}`;
	}

	onMount(() => {
		const onHash = () => {
			view = viewFromHash();
			focusId = focusFromHash();
		};
		addEventListener("hashchange", onHash);
		void loadSettings().then((s) => (configured = isConfigured(s)));
		return () => removeEventListener("hashchange", onHash);
	});
</script>

<main>
	<nav class="tabs" aria-label="Dashboard sections">
		{#each VIEWS as v (v.id)}
			<button class:active={view === v.id} aria-current={view === v.id ? "page" : undefined} onclick={() => showView(v.id)}>
				<Icon name={v.icon} size={16} /> {v.label}
			</button>
		{/each}
		<button class="settings" onclick={() => chrome.runtime.openOptionsPage()} title="Settings"><Icon name="gear" size={16} /></button>
	</nav>
	{#if configured === false}
		<NotConfigured />
	{:else if configured}
		{#if view === "documents"}
			<Documents />
		{:else if view === "merge"}
			<MailMerge />
		{:else if view === "followups"}
			<FollowUps onopenmessage={openMessage} />
		{:else}
			{#key focusId}<Emails {focusId} />{/key}
		{/if}
	{/if}
</main>

<style>
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 16px;
	}
	.tabs button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border: 0;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}
	.tabs button.active {
		color: var(--accent);
		border-bottom-color: var(--accent);
	}
	.tabs .settings {
		margin-left: auto;
	}
</style>
