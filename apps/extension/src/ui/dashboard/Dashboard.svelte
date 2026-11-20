<script lang="ts">
	import type { MessageSummary } from "@bet/shared";
	import { onMount } from "svelte";
	import { filterEntries, groupMessages, messageStatus, type StatusFilter } from "../../lib/dashboard";
	import { plural, relativeTime } from "../../lib/time";
	import { isConfigured, loadSettings } from "../../settings";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";
	import StatusIcon from "../components/StatusIcon.svelte";
	import Documents from "../documents/Documents.svelte";
	import MessageDetail from "./MessageDetail.svelte";

	let query = $state("");
	let filter = $state<StatusFilter>("all");
	let messages = $state<MessageSummary[]>([]);
	let loading = $state(false);
	let error = $state("");
	let configured = $state(true);
	let expanded = $state<Record<string, boolean>>({});
	let focusId = $state<string | null>(null);
	let view = $state<"emails" | "documents">(location.hash === "#documents" ? "documents" : "emails");
	const showView = (v: typeof view) => {
		view = v;
		history.replaceState(null, "", v === "documents" ? "#documents" : location.pathname);
	};

	const entries = $derived(filterEntries(groupMessages(messages), filter));

	async function load() {
		loading = true;
		error = "";
		try {
			const api = await pageApi();
			messages = (await api.listMessages({ q: query.trim(), limit: 200 })).messages;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			loading = false;
		}
	}

	let debounce: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(debounce);
		debounce = setTimeout(load, 250);
	}

	const toggle = (key: string) => {
		expanded[key] = !expanded[key];
	};

	onMount(() => {
		const m = /message=([0-9A-Za-z]+)/.exec(location.hash);
		if (m?.[1]) {
			focusId = m[1];
			expanded[m[1]] = true;
		}
		void loadSettings().then((s) => {
			configured = isConfigured(s);
			if (configured) void load();
		});
	});

	const filters: { value: StatusFilter; label: string }[] = [
		{ value: "all", label: "All" },
		{ value: "unopened", label: "Not opened" },
		{ value: "machine_only", label: "Privacy proxy only" },
		{ value: "opened", label: "Opened" },
		{ value: "clicked", label: "Clicked" },
	];

	const counts = (m: MessageSummary) => {
		const parts: string[] = [];
		if (m.opens) parts.push(plural(m.opens, "open"));
		if (m.machineOpens) parts.push(`${m.machineOpens} machine`);
		if (m.clicks) parts.push(plural(m.clicks, "click"));
		return parts.join(" · ") || "No activity";
	};
	const to = (m: MessageSummary) => m.recipients.map((r) => r.name || r.email).join(", ");
</script>

{#snippet messageRow(m: MessageSummary, nested: boolean)}
	<li class:nested>
		<button class="row" onclick={() => toggle(m.id)} aria-expanded={!!expanded[m.id]}>
			<Icon name={expanded[m.id] ? "caret-down" : "caret-right"} size={14} />
			<StatusIcon status={messageStatus(m)} />
			<span class="main">
				{#if nested}
					<span class="subject">{to(m)}</span>
				{:else}
					<span class="subject">{m.subject || "(no subject)"}</span>
					<span class="muted small">{to(m)}</span>
				{/if}
			</span>
			<span class="muted small counts">{counts(m)}</span>
			<span class="muted small when">{relativeTime(m.sentAt ?? m.createdAt)}</span>
		</button>
		{#if expanded[m.id]}<MessageDetail id={m.id} />{/if}
	</li>
{/snippet}

<main>
	<nav class="tabs" aria-label="Dashboard sections">
		<button class:active={view === "emails"} onclick={() => showView("emails")}><Icon name="envelope-simple-open" size={16} /> Emails</button>
		<button class:active={view === "documents"} onclick={() => showView("documents")}><Icon name="file-text" size={16} /> Documents</button>
	</nav>
	{#if view === "documents"}
	<Documents />
	{:else}
	<header>
		<h1><Icon name="envelope-simple-open" size={22} /> Tracked emails</h1>
		<div class="tools">
			<label class="search">
				<Icon name="magnifying-glass" />
				<input class="input" type="search" placeholder="Search subject or recipient" bind:value={query} oninput={onSearch} />
			</label>
			<select class="input" bind:value={filter} aria-label="Filter by status">
				{#each filters as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
			</select>
			<button class="btn" onclick={load} disabled={loading} title="Refresh"><Icon name="arrow-clockwise" /></button>
			<button class="btn" onclick={() => chrome.runtime.openOptionsPage()} title="Settings"><Icon name="gear" /></button>
		</div>
	</header>

	{#if !configured}
		<p class="empty">Connect your tracking server in <a href="options.html">settings</a> first.</p>
	{:else if error}
		<p class="empty bad">{error}</p>
	{:else if loading && messages.length === 0}
		<p class="empty muted">Loading…</p>
	{:else}
		{#if focusId && !messages.some((m) => m.id === focusId)}
			<section class="card">
				<h2 class="small muted">Linked message</h2>
				<MessageDetail id={focusId} />
			</section>
		{/if}
		{#if entries.length === 0}
			<p class="empty muted">No tracked emails match.</p>
		{:else}
			<ul class="card list">
				{#each entries as entry (entry.key)}
					{#if entry.kind === "single"}
						{@render messageRow(entry.message, false)}
					{:else}
						<li>
							<button class="row" onclick={() => toggle(entry.key)} aria-expanded={expanded[entry.key] !== false}>
								<Icon name={expanded[entry.key] !== false ? "caret-down" : "caret-right"} size={14} />
								<StatusIcon status={entry.status} />
								<span class="main">
									<span class="subject">{entry.subject || "(no subject)"}</span>
									<span class="muted small">
										<Icon name="users" size={12} /> Sent individually to {plural(entry.messages.length, "recipient")}
									</span>
								</span>
								<span class="muted small counts">
									{entry.messages.filter((m) => m.opens > 0 || m.clicks > 0).length} of {entry.messages.length} opened
								</span>
								<span class="muted small when">{relativeTime(entry.at)}</span>
							</button>
							{#if expanded[entry.key] !== false}
								<ul class="group">
									{#each entry.messages as m (m.id)}{@render messageRow(m, true)}{/each}
								</ul>
							{/if}
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
	{/if}
	{/if}
</main>

<style>
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
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 16px;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 20px;
		margin: 0;
	}
	.tools {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.search {
		position: relative;
		display: flex;
		align-items: center;
	}
	.search :global(.icon) {
		position: absolute;
		left: 9px;
		color: var(--text-muted);
	}
	.search input {
		padding-left: 30px;
		width: 260px;
		max-width: 100%;
	}
	select {
		width: auto;
	}
	.card {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		margin: 0 0 16px;
	}
	section.card h2 {
		margin: 12px 16px 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list > li + li {
		border-top: 1px solid var(--border);
	}
	.group {
		background: var(--bg-soft);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 10px 16px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.row:hover {
		background: var(--bg-hover);
	}
	li.nested .row {
		padding-left: 40px;
	}
	.main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.small {
		font-size: 12px;
	}
	.counts {
		white-space: nowrap;
	}
	.when {
		width: 72px;
		text-align: right;
		white-space: nowrap;
	}
	.empty {
		padding: 32px 0;
		text-align: center;
	}
	.bad {
		color: var(--danger);
	}
	@media (max-width: 600px) {
		.counts {
			display: none;
		}
	}
</style>
