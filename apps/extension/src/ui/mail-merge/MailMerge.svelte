<script lang="ts">
	import type { CampaignSummary } from "@bet/shared";
	import { onDestroy, onMount } from "svelte";
	import {
		type BuilderSeed,
		CAMPAIGN_STATUS_ICON,
		CAMPAIGN_STATUS_LABEL,
		isActive,
		progress,
		statsLine,
	} from "../../lib/campaigns";
	import { relativeTime } from "../../lib/time";
	import Icon from "../components/Icon.svelte";
	import ListState from "../components/ListState.svelte";
	import LoadMore from "../components/LoadMore.svelte";
	import { pageFrom } from "../../lib/paging";
	import { pageApi } from "../api";
	import { PagedList } from "../paged.svelte";
	import CampaignBuilder from "./CampaignBuilder.svelte";
	import CampaignView from "./CampaignView.svelte";

	const list = new PagedList<CampaignSummary>(
		async (cursor) => pageFrom(await (await pageApi()).listCampaigns(cursor ? { cursor } : {}), "campaigns"),
		(c) => c.id,
	);
	let notice = $state("");
	let building = $state(false);
	let seed = $state<BuilderSeed | undefined>(undefined);
	let expanded = $state<Record<string, boolean>>({});
	let timer: ReturnType<typeof setInterval> | undefined;

	const load = () => list.reload();

	onMount(() => {
		void load();
		// Live progress while anything is sending (keeps pages already loaded).
		timer = setInterval(() => {
			if (list.items.some(isActive)) void list.refresh();
		}, 5000);
	});
	onDestroy(() => clearInterval(timer));

	function newCampaign(from?: BuilderSeed) {
		seed = from;
		notice = "";
		building = true;
		scrollTo({ top: 0 });
	}

	function done(id: string, message: string) {
		building = false;
		seed = undefined;
		notice = message;
		expanded = { [id]: true };
		void list.refresh();
	}
</script>

<section>
	<header>
		<h1><Icon name="paper-plane-tilt" size={22} /> Mail merge</h1>
		<div class="tools">
			<button class="btn" onclick={load} disabled={list.loading} title="Refresh"><Icon name="arrow-clockwise" /></button>
			{#if !building}
				<button class="btn primary" onclick={() => newCampaign()}><Icon name="plus" /> New campaign</button>
			{/if}
		</div>
	</header>

	{#if building}
			{#key seed}
				<CampaignBuilder {seed} onDone={done} onCancel={() => ((building = false), (seed = undefined))} />
			{/key}
		{/if}
		{#if notice}<p class="note"><Icon name="paper-plane-tilt" /> {notice}</p>{/if}
	<ListState loading={list.loading && !list.loaded} error={list.error} isEmpty={list.items.length === 0}>
		{#snippet empty()}
			{#if !building}
				<div class="empty">
					<p class="muted">Send a personalised email to a list from a CSV, with per-recipient open and click tracking.</p>
					<button class="btn primary" onclick={() => newCampaign()}><Icon name="plus" /> New campaign</button>
				</div>
			{/if}
		{/snippet}
			<ul class="card list">
				{#each list.items as c (c.id)}
					{@const p = progress(c.stats)}
					<li>
						<button class="row" onclick={() => (expanded[c.id] = !expanded[c.id])} aria-expanded={!!expanded[c.id]}>
							<Icon name={expanded[c.id] ? "caret-down" : "caret-right"} size={14} />
							<span class="status status-{c.status}" title={CAMPAIGN_STATUS_LABEL[c.status]}>
								<Icon name={CAMPAIGN_STATUS_ICON[c.status]} label={CAMPAIGN_STATUS_LABEL[c.status]} />
							</span>
							<span class="main">
								<span class="subject">{c.name}</span>
								<span class="muted small">{CAMPAIGN_STATUS_LABEL[c.status]} · {statsLine(c.stats)}</span>
								{#if c.status === "sending" || c.status === "paused"}
									<span class="bar" title="{p.handled} of {p.total}"><span style:width="{p.pct}%"></span></span>
								{/if}
							</span>
							<span class="muted small counts">{p.handled}/{p.total}</span>
							<span class="muted small when">{relativeTime(c.lastSentAt ?? c.createdAt)}</span>
						</button>
						{#if expanded[c.id]}
							<CampaignView id={c.id} onChanged={() => list.refresh()} onDeleted={() => list.remove(c.id)} onFollowUp={newCampaign} />
						{/if}
					</li>
				{/each}
			</ul>
			<LoadMore {list} label="More campaigns" />
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
	.main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		gap: 2px;
	}
	.subject {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.status {
		color: var(--gray);
	}
	.status-sending {
		color: var(--accent);
	}
	.status-done {
		color: var(--green);
	}
	.bar {
		display: block;
		height: 4px;
		max-width: 240px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
	}
	.counts,
	.when {
		white-space: nowrap;
	}
	.when {
		width: 72px;
		text-align: right;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		border-radius: var(--radius);
		background: var(--accent-soft);
	}
	@media (max-width: 600px) {
		.counts {
			display: none;
		}
	}
</style>
