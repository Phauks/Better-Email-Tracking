<script lang="ts">
	import { onMount } from "svelte";
	import type { ActivityItem } from "../../lib/activity";
	import { describeEvent, isMachineEvent, SOURCE_LABEL } from "../../lib/feed";
	import { relativeTime } from "../../lib/time";
	import { callBackground } from "../../messaging";
	import { isConfigured, loadSettings } from "../../settings";
	import Icon from "../components/Icon.svelte";

	let items = $state<ActivityItem[]>([]);
	let configured = $state(true);
	let loading = $state(true);
	let refreshing = $state(false);
	let error = $state("");

	async function load() {
		const res = await chrome.storage.local.get("activity");
		items = (res.activity as ActivityItem[] | undefined) ?? [];
	}

	async function refresh() {
		refreshing = true;
		error = "";
		try {
			await callBackground({ type: "bet:pollNow" });
			await load();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			refreshing = false;
		}
	}

	onMount(() => {
		void (async () => {
			configured = isConfigured(await loadSettings());
			await load();
			loading = false;
			// Keep this render's unseen highlights; clear the badge for next time.
			void callBackground({ type: "bet:markSeen" }).catch(() => {});
		})();
	});

	const open = (path: string) => {
		void chrome.tabs.create({ url: chrome.runtime.getURL(path) });
		window.close();
	};
</script>

<main>
	<header>
		<span class="brand"><Icon name="envelope-simple-open" size={18} /> Activity</span>
		<span class="actions">
			<button class="icon-btn" title="Refresh" onclick={refresh} disabled={refreshing || !configured}>
				<Icon name="arrow-clockwise" />
			</button>
			<button class="icon-btn" title="Settings" onclick={() => chrome.runtime.openOptionsPage()}>
				<Icon name="gear" />
			</button>
		</span>
	</header>

	{#if !configured}
		<div class="empty">
			<p>Connect your tracking server to get started.</p>
			<button class="btn primary" onclick={() => chrome.runtime.openOptionsPage()}>Open settings</button>
		</div>
	{:else if loading}
		<p class="empty muted">Loading…</p>
	{:else if items.length === 0}
		<p class="empty muted">No opens or clicks yet. Send a tracked email from Gmail.</p>
	{:else}
		<ul>
			{#each items.slice(0, 30) as item (item.id)}
				{@const d = describeEvent(item)}
				<li class:unseen={!item.seen} class:machine={isMachineEvent(item)}>
					<button class="row" onclick={() => open(`dashboard.html#message=${item.messageId}`)}>
						<span class="kind">
							<Icon name={item.type === "click" ? "cursor-click" : item.type === "doc_view" ? "file-text" : isMachineEvent(item) ? "robot" : "eye"} />
						</span>
						<span class="text">
							<span class="title">{d.title}</span>
							<span class="detail">{d.detail}</span>
							<span class="meta">{relativeTime(item.at)} · {SOURCE_LABEL[item.source]}</span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if error}<p class="error">{error}</p>{/if}

	<footer>
		<button class="btn" onclick={() => open("dashboard.html")}>
			Open dashboard <Icon name="arrow-square-out" size={14} />
		</button>
	</footer>
</main>

<style>
	main {
		width: 360px;
		max-height: 560px;
		display: flex;
		flex-direction: column;
	}
	header,
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 12px;
	}
	header {
		border-bottom: 1px solid var(--border);
	}
	footer {
		border-top: 1px solid var(--border);
		justify-content: center;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	.icon-btn {
		border: 0;
		background: none;
		padding: 6px;
		border-radius: 6px;
		cursor: pointer;
		display: inline-flex;
	}
	.icon-btn:hover {
		background: var(--bg-hover);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		overflow-y: auto;
	}
	.row {
		display: flex;
		gap: 10px;
		width: 100%;
		padding: 8px 12px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	li.unseen .row {
		background: var(--accent-soft);
	}
	li.unseen .title {
		font-weight: 600;
	}
	.kind {
		padding-top: 2px;
		color: var(--green);
	}
	li.machine .kind {
		color: var(--machine);
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.detail,
	.meta {
		font-size: 12px;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.empty {
		padding: 24px 16px;
		text-align: center;
	}
	.error {
		margin: 8px 12px;
		color: var(--danger);
		font-size: 12px;
	}
</style>
