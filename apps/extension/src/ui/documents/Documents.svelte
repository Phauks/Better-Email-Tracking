<script lang="ts">
	import { DEFAULT_MAX_DOCUMENT_BYTES, type DocumentSummary, formatBytes } from "@bet/shared";
	import { onMount } from "svelte";
	import { documentIcon, formatDuration } from "../../lib/documents";
	import { plural, relativeTime } from "../../lib/time";
	import Icon from "../components/Icon.svelte";
	import { documentsApi } from "./api";
	import DocumentDetail from "./DocumentDetail.svelte";

	let documents = $state<DocumentSummary[]>([]);
	let loading = $state(false);
	let uploading = $state("");
	let error = $state("");
	let expanded = $state<string | null>(null);
	let fileInput = $state<HTMLInputElement>();

	async function load() {
		loading = true;
		error = "";
		try {
			documents = (await (await documentsApi()).listDocuments()).documents;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			loading = false;
		}
	}

	async function onFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		if (file.size > DEFAULT_MAX_DOCUMENT_BYTES) {
			error = `${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(DEFAULT_MAX_DOCUMENT_BYTES)}.`;
			return;
		}
		uploading = file.name;
		error = "";
		try {
			const doc = await (await documentsApi()).uploadDocument(file.name, file.type, file);
			await load();
			expanded = doc.id;
		} catch (err) {
			error = (err as Error).message;
		} finally {
			uploading = "";
		}
	}

	const stats = (d: DocumentSummary) => {
		const s = d.stats;
		if (!s.views && !s.downloads) return "Not viewed yet";
		const parts = [plural(s.views, "view")];
		if (s.uniqueViewers > 1) parts.push(`${s.uniqueViewers} people`);
		if (s.totalDwellMs) parts.push(formatDuration(s.totalDwellMs));
		if (s.downloads) parts.push(plural(s.downloads, "download"));
		return parts.join(" · ");
	};

	onMount(load);
</script>

<section>
	<div class="bar">
		<p class="muted small">
			Upload a file here or with “Attach tracked document” in Gmail. Each recipient gets their own link, so you see who opened it and how long they spent on each page.
		</p>
		<div class="tools">
			<input bind:this={fileInput} type="file" hidden onchange={onFile} />
			<button class="btn primary" onclick={() => fileInput?.click()} disabled={!!uploading}>
				<Icon name="upload-simple" size={14} />
				{uploading ? `Uploading ${uploading}…` : "Upload"}
			</button>
			<button class="btn" onclick={load} disabled={loading} title="Refresh"><Icon name="arrow-clockwise" /></button>
		</div>
	</div>

	{#if error}<p class="bad">{error}</p>{/if}

	{#if loading && documents.length === 0}
		<p class="empty muted">Loading…</p>
	{:else if documents.length === 0}
		<p class="empty muted">No tracked documents yet.</p>
	{:else}
		<ul class="card list">
			{#each documents as d (d.id)}
				<li>
					<button class="row" onclick={() => (expanded = expanded === d.id ? null : d.id)} aria-expanded={expanded === d.id}>
						<Icon name={expanded === d.id ? "caret-down" : "caret-right"} size={14} />
						<span class="kind" class:seen={d.stats.views > 0}><Icon name={documentIcon(d.mime, d.name)} size={18} /></span>
						<span class="main">
							<span class="name">{d.name}</span>
							<span class="muted small">
								{formatBytes(d.size)}{d.pageCount ? ` · ${plural(d.pageCount, "page")}` : ""} · uploaded {relativeTime(d.createdAt)}
							</span>
						</span>
						<span class="muted small counts">{stats(d)}</span>
						<span class="muted small when">{d.stats.lastViewedAt ? relativeTime(d.stats.lastViewedAt) : ""}</span>
					</button>
					{#if expanded === d.id}
						<DocumentDetail
							id={d.id}
							ondeleted={() => {
								expanded = null;
								documents = documents.filter((x) => x.id !== d.id);
							}}
						/>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.bar p {
		flex: 1;
		min-width: 240px;
		margin: 0;
	}
	.tools {
		display: flex;
		gap: 8px;
	}
	.card {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list > li + li {
		border-top: 1px solid var(--border);
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
	.kind {
		color: var(--gray);
		display: inline-flex;
	}
	.kind.seen {
		color: var(--green);
	}
	.main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.name {
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
