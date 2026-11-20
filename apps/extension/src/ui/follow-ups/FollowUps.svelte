<script lang="ts">
	import type { NudgeHistoryItem, NudgeSequence, NudgeState } from "@bet/shared";
	import { onMount } from "svelte";
	import { NUDGE_STATE_LABEL, nextActionLabel } from "../../lib/nudges";
	import { relativeTime, dayTime } from "../../lib/time";
	import type { IconName } from "../icons";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";
	import ListState from "../components/ListState.svelte";
	import LoadMore from "../components/LoadMore.svelte";
	import { pageFrom } from "../../lib/paging";
	import { PagedList } from "../paged.svelte";

	let { onopenmessage }: { onopenmessage: (id: string) => void } = $props();

	type Filter = "all" | NudgeState;
	let filter = $state<Filter>("all");
	let actionError = $state("");
	let expanded = $state<Record<string, boolean>>({});
	let busy = $state<Record<string, boolean>>({});

	// The state filter runs on the Worker, so every page is filtered.
	const list = new PagedList<NudgeSequence>(
		async (cursor) =>
			pageFrom(
				await (await pageApi()).listNudges({
					...(filter !== "all" ? { state: filter } : {}),
					...(cursor ? { cursor } : {}),
				}),
				"sequences",
			),
		(s) => s.id,
	);
	const load = () => list.reload();

	async function act(seq: NudgeSequence, action: "pause" | "resume" | "cancel") {
		if (action === "cancel" && !confirm("Cancel the remaining follow-ups for this email?")) return;
		busy[seq.id] = true;
		actionError = "";
		try {
			const api = await pageApi();
			const { sequence } =
				action === "cancel" ? await api.cancelNudge(seq.id) : await api.updateNudge(seq.id, { action });
			list.replace(sequence);
		} catch (err) {
			actionError = (err as Error).message;
		} finally {
			busy[seq.id] = false;
		}
	}

	onMount(() => {
		void load();
	});

	const STATE_ICON: Record<NudgeState, { icon: IconName; tone: string }> = {
		active: { icon: "alarm", tone: "accent" },
		paused: { icon: "pause", tone: "muted" },
		replied: { icon: "chat-circle-text", tone: "green" },
		opened: { icon: "eye", tone: "green" },
		done: { icon: "check", tone: "muted" },
		cancelled: { icon: "x", tone: "muted" },
		failed: { icon: "warning", tone: "danger" },
	};

	const HISTORY_LABEL: Record<NudgeHistoryItem["kind"], string> = {
		created: "Scheduled",
		sent: "Nudge sent",
		reply: "Reply received",
		opened: "Stopped: opened",
		bounced: "Bounced",
		error: "Error",
		paused: "Paused",
		resumed: "Resumed",
		cancelled: "Cancelled",
	};

	const filters: { value: Filter; label: string }[] = [
		{ value: "all", label: "All" },
		...(Object.keys(NUDGE_STATE_LABEL) as NudgeState[]).map((s) => ({ value: s, label: NUDGE_STATE_LABEL[s] })),
	];

	const fmt = dayTime;
	const sentCount = (s: NudgeSequence) => s.history.filter((h) => h.kind === "sent").length;
	const to = (s: NudgeSequence) => s.recipients.map((r) => r.name || r.email).join(", ");
</script>

<div class="bar">
	<select class="input" bind:value={filter} onchange={load} aria-label="Filter follow-ups">
		{#each filters as f (f.value)}<option value={f.value}>{f.label}</option>{/each}
	</select>
	<button class="btn" onclick={load} disabled={list.loading} title="Refresh"><Icon name="arrow-clockwise" /></button>
</div>

<ListState
	loading={list.loading}
	error={actionError || list.error}
	isEmpty={list.items.length === 0}
	empty={filter === "all"
		? "No follow-ups yet. Turn them on with the alarm button when you write a tracked email, or for a mail merge campaign."
		: "No follow-ups match."}
>
	<ul class="card list">
		{#each list.items as seq (seq.id)}
			{@const st = STATE_ICON[seq.state]}
			<li>
				<div class="row">
					<button class="expand" onclick={() => (expanded[seq.id] = !expanded[seq.id])} aria-expanded={!!expanded[seq.id]}>
						<Icon name={expanded[seq.id] ? "caret-down" : "caret-right"} size={14} />
						<span class="state {st.tone}" title={NUDGE_STATE_LABEL[seq.state]}><Icon name={st.icon} /></span>
						<span class="main">
							<span class="subject">{seq.subject || "(no subject)"}</span>
							<span class="muted small">{to(seq)}</span>
						</span>
						<span class="muted small next">{nextActionLabel(seq, fmt)}</span>
						<span class="muted small count">{sentCount(seq)} of {seq.steps.length} sent</span>
					</button>
					<span class="actions">
						{#if seq.state === "active"}
							<button class="btn icon" title="Pause" disabled={busy[seq.id]} onclick={() => act(seq, "pause")}><Icon name="pause" /></button>
						{:else if seq.state === "paused"}
							<button class="btn icon" title="Resume" disabled={busy[seq.id]} onclick={() => act(seq, "resume")}><Icon name="play" /></button>
						{/if}
						{#if seq.state === "active" || seq.state === "paused"}
							<button class="btn icon" title="Cancel follow-ups" disabled={busy[seq.id]} onclick={() => act(seq, "cancel")}><Icon name="trash" /></button>
						{/if}
					</span>
				</div>
				{#if expanded[seq.id]}
					<div class="detail">
						{#if seq.lastError}<p class="bad small">Last error: {seq.lastError}</p>{/if}
						<ol class="history">
							{#each [...seq.history].reverse() as h, i (i)}
								<li>
									<span>{HISTORY_LABEL[h.kind]}{h.step !== undefined ? ` (${h.step + 1})` : ""}</span>
									{#if h.detail}<span class="muted small">{h.detail}</span>{/if}
									<span class="muted small when" title={fmt(h.at)}>{relativeTime(h.at)}</span>
								</li>
							{/each}
						</ol>
						<button class="btn" onclick={() => onopenmessage(seq.messageId)}>
							View email activity <Icon name="arrow-square-out" size={14} />
						</button>
					</div>
				{/if}
			</li>
		{/each}
	</ul>
	<LoadMore {list} />
</ListState>

<style>
	.bar {
		display: flex;
		gap: 8px;
		justify-content: flex-end;
		margin-bottom: 12px;
	}
	select {
		width: auto;
	}
	ul,
	ol {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.row {
		display: flex;
		align-items: center;
	}
	.expand {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		padding: 10px 8px 10px 16px;
		border: 0;
		background: none;
		text-align: left;
		cursor: pointer;
	}
	.expand:hover {
		background: var(--bg-hover);
	}
	.state {
		display: inline-flex;
	}
	.accent {
		color: var(--accent);
	}
	.green {
		color: var(--green);
	}
	.danger {
		color: var(--danger);
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
	.next,
	.count {
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 4px;
		padding-right: 12px;
	}
	.btn.icon {
		padding: 4px 6px;
	}
	.detail {
		padding: 4px 16px 16px 64px;
	}
	.history {
		margin-bottom: 12px;
		border-left: 2px solid var(--border);
	}
	.history li {
		display: flex;
		gap: 8px;
		align-items: baseline;
		padding: 3px 0 3px 10px;
	}
	.when {
		margin-left: auto;
	}
	@media (max-width: 640px) {
		.count {
			display: none;
		}
	}
</style>
