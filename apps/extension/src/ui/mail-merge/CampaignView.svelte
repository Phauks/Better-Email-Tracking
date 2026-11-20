<script lang="ts">
	import type {
		CampaignAction,
		CampaignDetail,
		CampaignFollowUpAction,
		CampaignRecipient,
		CampaignRecipientState,
		RecipientQuery,
	} from "@bet/shared";
	import { onDestroy, onMount } from "svelte";
	import {
		type BuilderSeed,
		campaignActions,
		followUpActions,
		followUpSeed,
		followUpStatsLine,
		isActive,
		nonOpenerCount,
		RECIPIENT_STATE_STYLE,
	} from "../../lib/campaigns";
	import { recipientFollowUpLabel } from "../../lib/nudges";
	import { fetchAll, type PageResult, pageFrom } from "../../lib/paging";
	import { dateTime, plural, relativeTime } from "../../lib/time";
	import Icon from "../components/Icon.svelte";
	import LoadMore from "../components/LoadMore.svelte";
	import StatusIcon from "../components/StatusIcon.svelte";
	import { pageApi } from "../api";
	import { PagedList } from "../paged.svelte";
	import { dispatchToMailTabs, NO_MAIL_TAB, SENDING_FROM_TAB } from "./api";

	let {
		id,
		onChanged,
		onDeleted,
		onFollowUp,
	}: {
		id: string;
		onChanged: () => void;
		onDeleted: () => void;
		onFollowUp: (seed: BuilderSeed) => void;
	} = $props();

	let detail = $state<CampaignDetail | null>(null);
	let error = $state("");
	let notice = $state("");
	let busy = $state(false);
	let query = $state("");
	let filter = $state<"all" | "sent" | "pending" | "failed" | "skipped">("all");
	let timer: ReturnType<typeof setInterval> | undefined;

	const FILTER_STATES: Record<typeof filter, CampaignRecipientState[] | undefined> = {
		all: undefined,
		sent: ["sent"],
		pending: ["queued", "sending"],
		failed: ["failed"],
		skipped: ["skipped"],
	};
	const FILTERS: { value: typeof filter; label: string }[] = [
		{ value: "all", label: "All recipients" },
		{ value: "sent", label: "Sent" },
		{ value: "pending", label: "Not sent yet" },
		{ value: "failed", label: "Failed" },
		{ value: "skipped", label: "Skipped" },
	];

	function recipientQuery(cursor?: string): RecipientQuery {
		const q: RecipientQuery = {};
		const states = FILTER_STATES[filter];
		if (states) q.state = states;
		if (query.trim()) q.q = query.trim();
		if (cursor) q.cursor = cursor;
		return q;
	}

	// The detail carries the first page of recipients (filtered); later pages come from
	// the recipients route. Filters and search run on the Worker.
	const recipients = new PagedList<CampaignRecipient>(
		async (cursor): Promise<PageResult<CampaignRecipient>> => {
			const api = await pageApi();
			if (cursor) return pageFrom(await api.listCampaignRecipients(id, recipientQuery(cursor)), "recipients");
			const d = await api.getCampaign(id, recipientQuery());
			detail = d;
			return d.recipientsNextCursor ? { items: d.recipients, nextCursor: d.recipientsNextCursor } : { items: d.recipients };
		},
		(r) => r.email,
	);

	async function load() {
		await recipients.reload();
		error = recipients.error;
	}

	let debounce: ReturnType<typeof setTimeout> | undefined;
	function onSearch() {
		clearTimeout(debounce);
		debounce = setTimeout(load, 250);
	}

	onMount(() => {
		void load();
		timer = setInterval(() => {
			if (detail && isActive(detail)) void recipients.refresh();
		}, 5000);
	});
	onDestroy(() => {
		clearInterval(timer);
		clearTimeout(debounce);
	});

	const LABELS: Record<CampaignAction, string> = {
		start: "Start sending",
		pause: "Pause",
		resume: "Resume",
		cancel: "Cancel",
		retry: "Retry failed",
	};
	const ICON = {
		start: "play",
		pause: "pause",
		resume: "play",
		cancel: "prohibit",
		retry: "arrow-clockwise",
	} as const;
	const FOLLOW_UP_LABELS: Record<CampaignFollowUpAction, string> = {
		pause: "Pause follow-ups",
		resume: "Resume follow-ups",
		cancel: "Cancel follow-ups",
	};
	const FOLLOW_UP_DONE: Record<CampaignFollowUpAction, string> = {
		pause: "Paused",
		resume: "Resumed",
		cancel: "Cancelled",
	};

	async function act(action: CampaignAction) {
		if (action === "cancel" && !confirm("Cancel this campaign? Recipients not sent yet will be skipped.")) return;
		busy = true;
		notice = "";
		try {
			const updated = await (await pageApi()).updateCampaign(id, { action });
			if (updated.status === "sending") {
				const tabs = await dispatchToMailTabs();
				notice = tabs > 0 ? SENDING_FROM_TAB : NO_MAIL_TAB;
			}
			await load();
			onChanged();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function actOnFollowUps(action: CampaignFollowUpAction) {
		if (action === "cancel" && !confirm("Cancel every follow-up of this campaign? No more nudges will be sent for it.")) return;
		busy = true;
		notice = "";
		try {
			const res = await (await pageApi()).campaignFollowUps(id, action);
			notice = `${FOLLOW_UP_DONE[action]} ${plural(res.changed, "follow-up")}.`;
			await load();
			onChanged();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function followUpNonOpeners() {
		if (!detail) return;
		busy = true;
		try {
			// Every sent recipient, across pages, so the new draft reaches all non-openers.
			const api = await pageApi();
			const sent = await fetchAll(async (cursor) =>
				pageFrom(await api.listCampaignRecipients(id, { state: ["sent"], limit: 500, ...(cursor ? { cursor } : {}) }), "recipients"),
			);
			onFollowUp(followUpSeed(detail, sent));
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!confirm("Delete this campaign? Tracking data for emails already sent is kept. Follow-ups already scheduled keep running (see Follow-ups).")) return;
		try {
			await (await pageApi()).deleteCampaign(id);
			onDeleted();
		} catch (err) {
			error = (err as Error).message;
		}
	}

	const nonOpeners = $derived(detail ? nonOpenerCount(detail.stats) : 0);
</script>

<div class="detail">
	{#if error}<p class="bad">{error}</p>{/if}
	{#if !detail}
		{#if !error}<p class="muted">Loading…</p>{/if}
	{:else}
		{#if detail.pauseReason && detail.status === "paused"}<p class="note"><Icon name="pause" /> {detail.pauseReason}</p>{/if}
		{#if notice}<p class="note"><Icon name="paper-plane-tilt" /> {notice}</p>{/if}
		<div class="actions">
			{#each campaignActions(detail) as a (a)}
				<button class="btn" class:primary={a === "start" || a === "resume"} disabled={busy} onclick={() => act(a)}>
					<Icon name={ICON[a]} /> {LABELS[a]}
				</button>
			{/each}
			{#if nonOpeners > 0}
				<button class="btn" disabled={busy} onclick={followUpNonOpeners} title="New draft campaign to sent recipients who haven't opened (or only a privacy proxy did)">
					<Icon name="arrow-u-up-left" /> Follow up with {plural(nonOpeners, "non-opener")}
				</button>
			{/if}
			<span class="spacer"></span>
			{#if detail.status !== "sending"}
				<button class="btn" onclick={remove} title="Delete campaign"><Icon name="trash" /></button>
			{/if}
		</div>

		{#if detail.followUp}
			<div class="follow-ups">
				<Icon name="alarm" />
				<span class="main small">
					<strong>Follow up until reply</strong>
					{#if detail.followUp.state === "paused"}<span class="tag">Paused</span>{:else if detail.followUp.state === "cancelled"}<span class="tag">Cancelled</span>{/if}
					<span class="muted">
						{plural(detail.followUp.steps.length, "nudge")}{detail.followUp.stopOnOpen ? ", stops on open" : ""}
						{#if detail.followUpStats}· {followUpStatsLine(detail.followUpStats)}{/if}
					</span>
				</span>
				{#each followUpActions(detail.followUp) as a (a)}
					<button class="btn" disabled={busy} onclick={() => actOnFollowUps(a)}>
						<Icon name={a === "resume" ? "play" : a === "pause" ? "pause" : "prohibit"} /> {FOLLOW_UP_LABELS[a]}
					</button>
				{/each}
			</div>
		{/if}

		<div class="filters">
			<label class="search">
				<Icon name="magnifying-glass" />
				<input class="input" type="search" placeholder="Search email or name" bind:value={query} oninput={onSearch} />
			</label>
			<select class="input" bind:value={filter} onchange={load} aria-label="Filter recipients">
				{#each FILTERS as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
			</select>
		</div>

		<table>
			<thead>
				<tr><th></th><th>Recipient</th><th>Status</th>{#if detail.followUp}<th>Follow-up</th>{/if}<th>Sent</th></tr>
			</thead>
			<tbody>
				{#each recipients.items as r (r.email)}
					<tr>
						<td class="icon">
							{#if r.state === "sent" && r.status}
								<StatusIcon status={r.status} />
							{:else if r.state === "sent"}
								<Icon name="check" label="Sent (untracked)" />
							{:else}
								<span class="tone-{RECIPIENT_STATE_STYLE[r.state].tone}">
									<Icon name={RECIPIENT_STATE_STYLE[r.state].icon} label={RECIPIENT_STATE_STYLE[r.state].label} />
								</span>
							{/if}
						</td>
						<td>
							<div>{r.name || r.email}</div>
							{#if r.name}<div class="muted small">{r.email}</div>{/if}
						</td>
						<td class="small">
							{#if r.state === "sent"}
								{#if r.status === "clicked"}Clicked{:else if r.status === "opened"}Opened{:else if r.status === "machine_only"}Privacy proxy only{:else if r.status}Not opened{:else}Sent{/if}
								{#if r.opens}<span class="muted">· {plural(r.opens, "open")}</span>{/if}
								{#if r.clicks}<span class="muted">· {plural(r.clicks, "click")}</span>{/if}
							{:else}
								{RECIPIENT_STATE_STYLE[r.state].label}
							{/if}
							{#if r.error}<div class="muted">{r.error}</div>{/if}
						</td>
						{#if detail.followUp}
							<td class="small muted">{r.followUp ? recipientFollowUpLabel(r.followUp, dateTime) : r.state === "sent" ? "None" : ""}</td>
						{/if}
						<td class="muted small when">{r.sentAt ? relativeTime(r.sentAt) : ""}</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="muted small">{recipients.loading ? "Loading…" : "No recipients match."}</td></tr>
				{/each}
			</tbody>
		</table>
		<LoadMore list={recipients} label="More recipients" />
	{/if}
</div>

<style>
	.detail {
		padding: 4px 16px 16px 40px;
		background: var(--bg-soft);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin: 8px 0 12px;
	}
	.spacer {
		flex: 1;
	}
	.follow-ups {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0 0 12px;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.follow-ups .main {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		flex: 1;
		min-width: 200px;
	}
	.tag {
		padding: 0 6px;
		border-radius: 999px;
		background: var(--bg-hover);
	}
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 8px;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 180px;
	}
	.search input {
		flex: 1;
	}
	.filters select {
		width: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: top;
	}
	th {
		font-weight: 500;
		font-size: 12px;
		color: var(--text-muted);
	}
	td.icon {
		width: 24px;
	}
	.when {
		white-space: nowrap;
		text-align: right;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 8px 0 0;
		padding: 8px 12px;
		border-radius: var(--radius);
		background: var(--accent-soft);
	}
	.bad,
	.tone-danger {
		color: var(--danger);
	}
	.tone-accent {
		color: var(--accent);
	}
	.tone-muted {
		color: var(--gray);
	}
	@media (max-width: 600px) {
		.detail {
			padding-left: 16px;
		}
	}
</style>
