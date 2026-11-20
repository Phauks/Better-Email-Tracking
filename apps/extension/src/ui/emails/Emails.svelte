<script lang="ts">
	import type { MessageSummary } from "@bet/shared";
	import { onMount } from "svelte";
	import { groupMessages, messageStatus, type StatusFilter } from "../../lib/dashboard";
	import { pageFrom } from "../../lib/paging";
	import { plural, relativeTime } from "../../lib/time";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";
	import ListState from "../components/ListState.svelte";
	import LoadMore from "../components/LoadMore.svelte";
	import StatusIcon from "../components/StatusIcon.svelte";
	import { PagedList } from "../paged.svelte";
	import MessageDetail from "./MessageDetail.svelte";

	/** A message to open on load (from #message=…, e.g. a notification or a follow-up). */
	let { focusId = null }: { focusId?: string | null } = $props();

	let query = $state("");
	let filter = $state<StatusFilter>("all");
	let expanded = $state<Record<string, boolean>>({});

	// Search and the status filter run on the Worker, so every page is filtered (and
	// nudges are never listed: they show under Follow-ups).
	const list = new PagedList<MessageSummary>(
		async (cursor) =>
			pageFrom(
				await (await pageApi()).listMessages({
					q: query.trim(),
					...(filter !== "all" ? { status: filter } : {}),
					...(cursor ? { cursor } : {}),
				}),
				"messages",
			),
		(m) => m.id,
	);
	const entries = $derived(groupMessages(list.items));
	const load = () => list.reload();

	let debounce: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(debounce);
		debounce = setTimeout(load, 250);
	}

	const toggle = (key: string) => {
		expanded[key] = !expanded[key];
	};

	onMount(() => {
		if (focusId) expanded[focusId] = true;
		void load();
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

<section>
	<header>
		<h1><Icon name="envelope-simple-open" size={22} /> Tracked emails</h1>
		<div class="tools">
			<label class="search">
				<Icon name="magnifying-glass" />
				<input class="input" type="search" placeholder="Search subject or recipient" bind:value={query} oninput={onSearch} />
			</label>
			<select class="input" bind:value={filter} onchange={load} aria-label="Filter by status">
				{#each filters as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
			</select>
			<button class="btn" onclick={load} disabled={list.loading} title="Refresh"><Icon name="arrow-clockwise" /></button>
		</div>
	</header>

	{#if focusId && list.loaded && !list.items.some((m) => m.id === focusId)}
		<section class="card linked">
			<h2 class="small muted">Linked message</h2>
			<MessageDetail id={focusId} />
		</section>
	{/if}
	<ListState loading={list.loading} error={list.error} isEmpty={entries.length === 0} empty="No tracked emails match.">
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
			<LoadMore {list} />
	</ListState>
</section>

<style>
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
	.linked {
		margin-bottom: 16px;
	}
	.linked h2 {
		margin: 12px 16px 0;
	}
	.group {
		list-style: none;
		margin: 0;
		padding: 0;
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
	.counts {
		white-space: nowrap;
	}
	.when {
		width: 72px;
		text-align: right;
		white-space: nowrap;
	}
	@media (max-width: 600px) {
		.counts {
			display: none;
		}
	}
</style>
