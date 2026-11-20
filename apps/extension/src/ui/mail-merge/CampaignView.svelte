<script lang="ts">
	import type { CampaignAction, CampaignDetail } from "@bet/shared";
	import { onDestroy, onMount } from "svelte";
	import { campaignActions, isActive, RECIPIENT_STATE_STYLE } from "../../lib/campaigns";
	import { plural, relativeTime } from "../../lib/time";
	import Icon from "../components/Icon.svelte";
	import StatusIcon from "../components/StatusIcon.svelte";
	import { pageApi } from "../api";
	import { dispatchToMailTabs, NO_MAIL_TAB, SENDING_FROM_TAB } from "./api";

	let {
		id,
		onChanged,
		onFollowUp,
	}: {
		id: string;
		onChanged: () => void;
		onFollowUp: (c: CampaignDetail) => void;
	} = $props();

	let detail = $state<CampaignDetail | null>(null);
	let error = $state("");
	let notice = $state("");
	let busy = $state(false);
	let timer: ReturnType<typeof setInterval> | undefined;

	async function load() {
		try {
			detail = await (await pageApi()).getCampaign(id);
			error = "";
		} catch (err) {
			error = (err as Error).message;
		}
	}

	onMount(() => {
		void load();
		timer = setInterval(() => {
			if (detail && isActive(detail)) void load();
		}, 5000);
	});
	onDestroy(() => clearInterval(timer));

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

	async function act(action: CampaignAction) {
		if (action === "cancel" && !confirm("Cancel this campaign? Recipients not sent yet will be skipped.")) return;
		busy = true;
		notice = "";
		try {
			detail = await (await pageApi()).updateCampaign(id, { action });
			if (detail.status === "sending") {
				const tabs = await dispatchToMailTabs();
				notice = tabs > 0 ? SENDING_FROM_TAB : NO_MAIL_TAB;
			}
			onChanged();
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!confirm("Delete this campaign? Tracking data for emails already sent is kept.")) return;
		await (await pageApi()).deleteCampaign(id);
		onChanged();
	}

	const nonOpenerCount = $derived(
		detail?.recipients.filter((r) => r.state === "sent" && (r.status === "unopened" || r.status === "machine_only")).length ?? 0,
	);
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
			{#if nonOpenerCount > 0}
				<button class="btn" onclick={() => detail && onFollowUp(detail)} title="New draft campaign to sent recipients who haven't opened (or only a privacy proxy did)">
					<Icon name="arrow-u-up-left" /> Follow up with {plural(nonOpenerCount, "non-opener")}
				</button>
			{/if}
			<span class="spacer"></span>
			{#if detail.status !== "sending"}
				<button class="btn" onclick={remove} title="Delete campaign"><Icon name="trash" /></button>
			{/if}
		</div>
		<table>
			<thead><tr><th></th><th>Recipient</th><th>Status</th><th>Sent</th></tr></thead>
			<tbody>
				{#each detail.recipients as r (r.email)}
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
						<td class="muted small when">{r.sentAt ? relativeTime(r.sentAt) : ""}</td>
					</tr>
				{/each}
			</tbody>
		</table>
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
