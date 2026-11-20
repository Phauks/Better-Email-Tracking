<script lang="ts">
	import type { NudgePolicy, Recipient } from "@bet/shared";
	import { describePolicy, previewNudge } from "../../lib/nudges";

	/**
	 * The follow-up policy editor shared by the options page (defaults) and the mail
	 * merge builder (one campaign): schedule, nudge text with a live preview, and
	 * "stop on open". Edits `value` in place.
	 */
	let {
		value = $bindable(),
		legend = "Schedule",
		textLabel = "Nudge text",
		previewRecipients,
		mergeFields = {},
		fieldHint = "",
	}: {
		value: NudgePolicy & { text: string; stopOnOpen: boolean };
		legend?: string;
		textLabel?: string;
		/** Who the preview addresses. */
		previewRecipients: Recipient[];
		/** Merge fields of that recipient (mail merge). */
		mergeFields?: Record<string, string>;
		/** Extra placeholders to mention, e.g. a campaign's columns. */
		fieldHint?: string;
	} = $props();

	const preview = $derived(previewNudge(value.text, previewRecipients, mergeFields));
</script>

<fieldset>
	<legend>{legend}</legend>
	<div class="inline">
		<label>First after <input class="input num" type="number" min="1" max="90" bind:value={value.firstAfterDays} /> days</label>
		<label>then every <input class="input num" type="number" min="1" max="90" bind:value={value.intervalDays} /> days</label>
		<label>up to <input class="input num" type="number" min="1" max="10" bind:value={value.maxNudges} /> nudges</label>
	</div>
	<small class="muted">{describePolicy(value)}</small>
</fieldset>

<label class="text">
	<span>{textLabel}</span>
	<textarea class="input" rows="5" bind:value={value.text}></textarea>
	<small class="muted">
		Placeholders: {"{{firstName|there}}"}, {"{{name}}"}, {"{{email}}"}{fieldHint ? `, ${fieldHint}` : ""}. The part after | is
		used when the value is unknown or there are several recipients.
	</small>
</label>
<div class="preview"><small class="muted">Preview</small>{preview}</div>

<label class="choice">
	<input type="checkbox" bind:checked={value.stopOnOpen} />
	<span><strong>Also stop once they open</strong><small class="muted">Replies always stop follow-ups.</small></span>
</label>

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0 0 8px;
	}
	legend {
		font-weight: 500;
		margin-bottom: 6px;
	}
	.choice {
		display: flex;
		flex-direction: row;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 12px;
	}
	.choice > span {
		display: flex;
		flex-direction: column;
		font-weight: normal;
	}
	.choice input {
		margin-top: 3px;
	}
	textarea {
		resize: vertical;
	}
	.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		align-items: center;
	}
	.inline label {
		flex-direction: row;
		align-items: center;
		gap: 4px;
		margin: 0;
		font-weight: normal;
	}
	.num {
		width: 64px;
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
	}
	.text > span {
		font-weight: 500;
	}
	.preview {
		display: flex;
		flex-direction: column;
		white-space: pre-wrap;
		padding: 8px 10px;
		margin: -4px 0 12px;
		border-radius: var(--radius);
		background: var(--bg);
		border: 1px dashed var(--border);
	}
</style>
