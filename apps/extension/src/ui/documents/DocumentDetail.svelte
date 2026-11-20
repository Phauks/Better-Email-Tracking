<script lang="ts">
	import type { DocumentDetail, DocumentRecipientStats } from "@bet/shared";
	import { onMount } from "svelte";
	import { deviceLabel, SOURCE_LABEL } from "../../lib/feed";
	import { documentRecipientLabel, formatDuration } from "../../lib/documents";
	import { relativeTime, dateTime } from "../../lib/time";
	import Icon from "../components/Icon.svelte";
	import { pageApi } from "../api";
	import { pageFrom } from "../../lib/paging";
	import LoadMore from "../components/LoadMore.svelte";
	import { PagedList } from "../paged.svelte";
	import DwellChart from "./DwellChart.svelte";

	let { id, ondeleted }: { id: string; ondeleted: () => void } = $props();
	let detail = $state<DocumentDetail | null>(null);
	let error = $state("");
	let busy = $state(false);
	let copied = $state(false);

	// The detail carries the first page of recipients; later pages come from their route.
	const recipients = new PagedList<DocumentRecipientStats>(
		async (cursor) => {
			const api = await pageApi();
			if (cursor) return pageFrom(await api.listDocumentRecipients(id, { cursor }), "recipients");
			const d = await api.getDocument(id);
			detail = d;
			return d.recipientsNextCursor ? { items: d.recipients, nextCursor: d.recipientsNextCursor } : { items: d.recipients };
		},
		(r) => r.messageId ?? "",
	);

	onMount(async () => {
		await recipients.reload();
		if (recipients.error) error = recipients.error;
	});

	async function preview() {
		busy = true;
		try {
			const blob = await (await pageApi()).previewDocument(id);
			const url = URL.createObjectURL(blob);
			window.open(url, "_blank", "noopener");
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function copyLink() {
		if (!detail) return;
		await navigator.clipboard.writeText(detail.url);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	async function remove() {
		if (!detail || !confirm(`Delete “${detail.name}”? Its links stop working and its view history is removed.`)) return;
		busy = true;
		try {
			await (await pageApi()).deleteDocument(id);
			ondeleted();
		} catch (err) {
			error = (err as Error).message;
			busy = false;
		}
	}

	const fmt = dateTime;
	const EVENT_LABEL = { view: "Viewed", page: "Read page", download: "Downloaded" } as const;
	const EVENT_ICON = { view: "eye", page: "clock", download: "download-simple" } as const;
</script>

<div class="detail">
	{#if error}<p class="bad">{error}</p>{/if}
	{#if !detail}
		{#if !error}<p class="muted">Loading…</p>{/if}
	{:else}
		<div class="actions">
			<button class="btn" onclick={preview} disabled={busy} title="Opens your copy. Your previews are never counted.">
				<Icon name="eye" size={14} /> Preview
			</button>
			<button class="btn" onclick={copyLink}><Icon name={copied ? "check" : "arrow-square-out"} size={14} /> {copied ? "Copied" : "Copy link"}</button>
			<button class="btn danger" onclick={remove} disabled={busy}><Icon name="trash" size={14} /> Delete</button>
		</div>

		<h3>Recipients</h3>
		{#if recipients.items.length === 0}
			<p class="muted small">Not sent in a tracked email yet. Use “Attach tracked document” in Gmail’s compose toolbar.</p>
		{:else}
			<table>
				<thead><tr><th>Recipient</th><th>Views</th><th>Reading time</th><th>Downloads</th><th>Last viewed</th></tr></thead>
				<tbody>
					{#each recipients.items as r (r.messageId ?? "link")}
						<tr class:none={r.views === 0}>
							<td>
								<span class="who">{documentRecipientLabel(r)}</span>
								{#if r.subject !== undefined}<span class="muted small">{r.subject || "(no subject)"}</span>{/if}
							</td>
							<td>{r.views}</td>
							<td>{r.dwellMs ? formatDuration(r.dwellMs) : "–"}</td>
							<td>{r.downloads || "–"}</td>
							<td class="muted">{r.lastViewedAt ? relativeTime(r.lastViewedAt) : "Not viewed"}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			<LoadMore list={recipients} label="More recipients" />
		{/if}

		{#if detail.pageCount || detail.pages.length}
			<h3>Reading time per page</h3>
			<DwellChart pages={detail.pages} pageCount={detail.pageCount} />
		{/if}

		<h3>Activity</h3>
		{#if detail.events.length === 0}
			<p class="muted small">No activity yet.</p>
		{:else}
			<ol class="timeline">
				{#each detail.events.filter((e) => e.type !== "page").slice(0, 50) as e (e.id)}
					<li class:ignored={!!e.ignored} class:machine={e.source === "scanner"}>
						<Icon name={EVENT_ICON[e.type]} size={14} />
						<span>
							{EVENT_LABEL[e.type]}
							{#if e.messageId}
								{@const r = recipients.items.find((x) => x.messageId === e.messageId)}
								{#if r}<span class="muted">· {documentRecipientLabel(r)}</span>{/if}
							{/if}
							<span class="tag">{SOURCE_LABEL[e.source]}</span>
							{#if e.ignored}<span class="tag">ignored: {e.ignored === "owner" ? "you" : "send grace"}</span>{/if}
						</span>
						<span class="muted small">{fmt(e.at)}{deviceLabel(e) ? ` · ${deviceLabel(e)}` : ""}</span>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	.detail {
		padding: 4px 16px 16px 44px;
	}
	.actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 8px;
	}
	.danger {
		color: var(--danger);
	}
	h3 {
		font-size: 13px;
		margin: 16px 0 6px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		text-align: left;
		font-weight: 500;
		color: var(--text-muted);
		font-size: 12px;
	}
	th,
	td {
		padding: 6px 8px 6px 0;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}
	td .who {
		display: block;
		font-weight: 500;
	}
	tr.none td {
		color: var(--text-muted);
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.timeline li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 4px 0;
		font-size: 13px;
	}
	.timeline li.ignored,
	.timeline li.machine {
		opacity: 0.55;
	}
	.tag {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 10px;
		background: var(--bg-hover);
		color: var(--text-muted);
		margin-left: 4px;
	}
	@media (max-width: 600px) {
		.detail {
			padding-left: 16px;
		}
		th:nth-child(4),
		td:nth-child(4) {
			display: none;
		}
	}
</style>
