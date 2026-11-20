<script lang="ts">
	import type { MessageDetail } from "@bet/shared";
	import { onMount } from "svelte";
	import { deviceLabel, isMachineEvent, shortUrl, SOURCE_LABEL, sourceIcon } from "../../lib/feed";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";

	let { id }: { id: string } = $props();
	let detail = $state<MessageDetail | null>(null);
	let error = $state("");

	onMount(() => {
		void pageApi()
			.then((api) => api.getMessage(id))
			.then((d) => {
				detail = d;
			})
			.catch((err: Error) => {
				error = err.message;
			});
	});

	const fmt = (at: number) =>
		new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
</script>

<div class="detail">
	{#if error}
		<p class="bad">{error}</p>
	{:else if !detail}
		<p class="muted">Loading events…</p>
	{:else}
		<p class="muted small">
			{detail.sentAt ? `Sent ${fmt(detail.sentAt)}` : `Created ${fmt(detail.createdAt)}, not confirmed sent`}
			· to {detail.recipients.map((r) => r.email).join(", ")}
		</p>
		{#if detail.events.length === 0}
			<p class="muted">No events yet.</p>
		{:else}
			<ol class="timeline">
				{#each [...detail.events].sort((a, b) => b.at - a.at) as e (e.id)}
					<li class:machine={isMachineEvent(e)} class:ignored={!!e.ignored}>
						<span class="dot">
							<Icon name={e.type === "click" ? "cursor-click" : sourceIcon(e.source)} size={14} />
						</span>
						<span class="what">
							{#if e.type === "click"}
								Clicked
								{#if e.linkIndex !== undefined && detail.links[e.linkIndex]}
									<a href={detail.links[e.linkIndex]} target="_blank" rel="noreferrer">
										{shortUrl(detail.links[e.linkIndex] ?? "")}
									</a>
								{:else}
									a link
								{/if}
							{:else}
								Opened
							{/if}
							<span class="tag">{SOURCE_LABEL[e.source]}</span>
							{#if e.ignored}<span class="tag">ignored: {e.ignored === "owner" ? "you" : "send grace"}</span>{/if}
						</span>
						<span class="when muted">
							{fmt(e.at)}
							{#if deviceLabel(e)}
								· <Icon name={/iOS|Android/.test(e.device ?? "") ? "device-mobile" : "desktop"} size={12} />
								{deviceLabel(e)}
							{/if}
						</span>
					</li>
				{/each}
			</ol>
		{/if}
	{/if}
</div>

<style>
	.detail {
		padding: 8px 16px 16px 44px;
	}
	.small {
		font-size: 12px;
		margin: 0 0 8px;
	}
	.timeline {
		list-style: none;
		margin: 0;
		padding: 0;
		border-left: 2px solid var(--border);
	}
	li {
		display: grid;
		grid-template-columns: 24px 1fr;
		gap: 0 8px;
		padding: 6px 0;
		margin-left: -13px;
	}
	.dot {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--green-soft);
		color: var(--green);
		display: grid;
		place-items: center;
		grid-row: span 2;
	}
	li.machine .dot {
		background: var(--bg-hover);
		color: var(--machine);
	}
	li.ignored {
		opacity: 0.55;
	}
	.when {
		font-size: 12px;
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.tag {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 10px;
		background: var(--bg-hover);
		color: var(--text-muted);
		margin-left: 4px;
	}
	.bad {
		color: var(--danger);
	}
</style>
