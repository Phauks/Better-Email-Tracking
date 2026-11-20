<script lang="ts">
	import type { ConnectorStatus, Recipient } from "@bet/shared";
	import { onMount } from "svelte";
	import {
		describePolicy,
		type FollowUpChoice,
		type NudgeDefaults,
		normalizePolicy,
		previewNudge,
	} from "../../lib/nudges";

	let {
		initial,
		defaults,
		recipients,
		trackingOff,
		loadConnector,
		onchange,
		onopenoptions,
		onclose,
	}: {
		initial: FollowUpChoice;
		defaults: NudgeDefaults;
		recipients: Recipient[];
		trackingOff: boolean;
		loadConnector: () => Promise<ConnectorStatus | null>;
		onchange: (choice: FollowUpChoice) => void;
		onopenoptions: () => void;
		onclose: () => void;
	} = $props();

	// The popover is mounted fresh each time it opens, so props are read once.
	const start = (() => {
		const c = initial.kind === "custom" ? initial : null;
		return {
			kind: initial.kind,
			firstAfterDays: c?.policy.firstAfterDays ?? defaults.firstAfterDays,
			intervalDays: c?.policy.intervalDays ?? defaults.intervalDays,
			maxNudges: c?.policy.maxNudges ?? defaults.maxNudges,
			text: c?.text ?? defaults.text,
			stopOnOpen: c?.stopOnOpen ?? defaults.stopOnOpen,
		};
	})();
	let kind = $state<FollowUpChoice["kind"]>(start.kind);
	let firstAfterDays = $state(start.firstAfterDays);
	let intervalDays = $state(start.intervalDays);
	let maxNudges = $state(start.maxNudges);
	let text = $state(start.text);
	let stopOnOpen = $state(start.stopOnOpen);
	let connector = $state<ConnectorStatus | null | "loading" | "error">("loading");

	const choice = $derived<FollowUpChoice>(
		kind === "custom"
			? { kind, policy: normalizePolicy({ firstAfterDays, intervalDays, maxNudges }, defaults), text, stopOnOpen }
			: { kind },
	);
	const preview = $derived(previewNudge(kind === "custom" ? text : defaults.text, recipients.slice(0, 1)));

	$effect(() => {
		onchange(choice);
	});

	onMount(() => {
		loadConnector().then(
			(c) => {
				connector = c;
			},
			() => {
				connector = "error";
			},
		);
	});
</script>

<div class="bet-fu" role="dialog" aria-label="Follow up if no reply">
	<div class="bet-fu-head">
		<strong>Follow up if no reply</strong>
		<button type="button" class="bet-fu-x" aria-label="Close" onclick={onclose}>×</button>
	</div>

	<label class="bet-fu-opt">
		<input type="radio" bind:group={kind} value="off" />
		<span>Off</span>
	</label>
	<label class="bet-fu-opt">
		<input type="radio" bind:group={kind} value="default" />
		<span>
			Default
			<small>{describePolicy(defaults)}</small>
		</span>
	</label>
	<label class="bet-fu-opt">
		<input type="radio" bind:group={kind} value="custom" />
		<span>Custom</span>
	</label>

	{#if kind === "custom"}
		<div class="bet-fu-grid">
			<label>First after <input type="number" min="1" max="90" bind:value={firstAfterDays} /> days</label>
			<label>Then every <input type="number" min="1" max="90" bind:value={intervalDays} /> days</label>
			<label>Up to <input type="number" min="1" max="10" bind:value={maxNudges} /> nudges</label>
		</div>
		<label class="bet-fu-text">
			<span>Nudge text</span>
			<textarea rows="5" bind:value={text}></textarea>
			<small>Use {"{{firstName|there}}"}, {"{{name}}"} or {"{{email}}"}.</small>
		</label>
		<label class="bet-fu-opt">
			<input type="checkbox" bind:checked={stopOnOpen} />
			<span>Also stop once they open it</span>
		</label>
	{/if}

	{#if kind !== "off"}
		<div class="bet-fu-preview" aria-label="Preview">{preview}</div>
		<p class="bet-fu-note">Sent as a reply in the same thread, from your Gmail, until someone answers.</p>
		{#if trackingOff}
			<p class="bet-fu-warn">Tracking is off for this email, so no follow-up will be scheduled.</p>
		{/if}
		{#if connector === "loading"}
			<p class="bet-fu-note">Checking your Gmail connection…</p>
		{:else if connector === "error"}
			<p class="bet-fu-warn">Couldn't reach your tracker to check the Gmail connection.</p>
		{:else if !connector?.connected}
			<p class="bet-fu-warn">
				Connect Gmail first so follow-ups can be sent while your computer is off.
				<button type="button" class="bet-fu-link" onclick={onopenoptions}>Open settings</button>
			</p>
		{/if}
	{/if}
</div>

<style>
	.bet-fu {
		box-sizing: border-box;
		width: 300px;
		padding: 12px;
		font: 13px/1.4 "Google Sans", Roboto, system-ui, sans-serif;
		color: #1f1f1f;
		background: #fff;
	}
	.bet-fu * {
		box-sizing: border-box;
	}
	.bet-fu-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.bet-fu-x {
		border: 0;
		background: none;
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		color: #5f6368;
	}
	.bet-fu-opt {
		display: flex;
		gap: 8px;
		align-items: flex-start;
		padding: 3px 0;
		cursor: pointer;
	}
	.bet-fu-opt input {
		margin: 2px 0 0;
	}
	.bet-fu-opt small,
	.bet-fu-text small {
		display: block;
		color: #5f6368;
		font-size: 12px;
	}
	.bet-fu-grid {
		display: grid;
		gap: 4px;
		margin: 6px 0 6px 24px;
	}
	.bet-fu-grid input {
		width: 52px;
		padding: 2px 4px;
		margin: 0 4px;
		border: 1px solid #c4c7c5;
		border-radius: 4px;
		font: inherit;
	}
	.bet-fu-text {
		display: block;
		margin: 6px 0;
	}
	.bet-fu-text textarea {
		width: 100%;
		margin-top: 2px;
		padding: 6px;
		border: 1px solid #c4c7c5;
		border-radius: 6px;
		font: inherit;
		resize: vertical;
	}
	.bet-fu-preview {
		margin: 8px 0 4px;
		padding: 8px;
		max-height: 96px;
		overflow: auto;
		white-space: pre-wrap;
		background: #f6f8fc;
		border-radius: 6px;
		color: #444746;
	}
	.bet-fu-note {
		margin: 4px 0 0;
		color: #5f6368;
		font-size: 12px;
	}
	.bet-fu-warn {
		margin: 6px 0 0;
		padding: 6px 8px;
		border-radius: 6px;
		background: #fef7e0;
		color: #7a4f01;
		font-size: 12px;
	}
	.bet-fu-link {
		border: 0;
		padding: 0;
		background: none;
		color: #0b57d0;
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
</style>
