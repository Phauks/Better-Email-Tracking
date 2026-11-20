<script lang="ts">
	import type { ConnectorStatus } from "@bet/shared";
	import { onDestroy, onMount } from "svelte";
	import { describePolicy, type NudgeDefaults, previewNudge } from "../../lib/nudges";
	import { isConfigured, loadSettings } from "../../settings";
	import { pageApi } from "../api";
	import Icon from "../components/Icon.svelte";

	let { nudges = $bindable() }: { nudges: NudgeDefaults } = $props();

	let status = $state<ConnectorStatus | null>(null);
	let statusError = $state("");
	let busy = $state(false);
	let waiting = $state(false);
	let poll: ReturnType<typeof setInterval> | undefined;

	const preview = $derived(previewNudge(nudges.text, [{ email: "ana@example.com", name: "Ana Silva" }]));

	async function refresh() {
		statusError = "";
		try {
			if (!isConfigured(await loadSettings())) {
				statusError = "Save your tracker URL and token above first.";
				return;
			}
			const res = await (await pageApi()).connectorStatus();
			status = res.connectors.find((c) => c.kind === "google") ?? null;
		} catch (err) {
			statusError = (err as Error).message;
		}
	}

	function stopWaiting() {
		clearInterval(poll);
		poll = undefined;
		waiting = false;
	}

	async function connect() {
		busy = true;
		statusError = "";
		try {
			const { url } = await (await pageApi()).startConnector("google");
			await chrome.tabs.create({ url });
			// Watch for the callback to land (up to 5 minutes).
			waiting = true;
			const started = Date.now();
			clearInterval(poll);
			poll = setInterval(async () => {
				await refresh();
				if (status?.connected || Date.now() - started > 5 * 60_000) stopWaiting();
			}, 3000);
		} catch (err) {
			statusError = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		if (!confirm("Disconnect Gmail? Scheduled follow-ups will stop sending until you connect again.")) return;
		busy = true;
		try {
			await (await pageApi()).disconnectConnector("google");
			await refresh();
		} catch (err) {
			statusError = (err as Error).message;
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void refresh();
	});
	onDestroy(stopWaiting);
</script>

<section>
	<h2><Icon name="alarm" /> Follow-ups</h2>
	<p class="muted small">
		Your tracker replies in the same thread from your Gmail until someone answers, even when your computer is off.
		Turn it on per email with the alarm button in the compose toolbar.
	</p>

	<div class="connector">
		{#if status?.connected}
			<span class="ok"><Icon name="check" /> Connected as {status.email}</span>
			<button class="btn" type="button" onclick={disconnect} disabled={busy}>Disconnect</button>
		{:else if status && !status.configured}
			<span class="bad"><Icon name="warning" /> Your tracker isn't set up for Gmail yet.</span>
			<small class="muted">Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENC_KEY on the Worker (see its README), then reload this page.</small>
		{:else}
			<button class="btn primary" type="button" onclick={connect} disabled={busy || !!statusError}>
				<Icon name="plugs-connected" /> Connect Gmail
			</button>
			{#if waiting}<span class="muted">Waiting for you to finish in the Google tab…</span>{/if}
		{/if}
		<button class="btn" type="button" onclick={refresh} title="Refresh status"><Icon name="arrow-clockwise" /></button>
		{#if statusError}<span class="bad">{statusError}</span>{/if}
	</div>

	<label class="choice">
		<input type="checkbox" bind:checked={nudges.enabledByDefault} />
		<span><strong>Follow up on every tracked email</strong><small class="muted">You can still turn it off per email.</small></span>
	</label>

	<fieldset>
		<legend>Default schedule</legend>
		<div class="inline">
			<label>First after <input class="input num" type="number" min="1" max="90" bind:value={nudges.firstAfterDays} /> days</label>
			<label>then every <input class="input num" type="number" min="1" max="90" bind:value={nudges.intervalDays} /> days</label>
			<label>up to <input class="input num" type="number" min="1" max="10" bind:value={nudges.maxNudges} /> nudges</label>
		</div>
		<small class="muted">{describePolicy(nudges)}</small>
	</fieldset>

	<label>
		<span>Default nudge text</span>
		<textarea class="input" rows="5" bind:value={nudges.text}></textarea>
		<small class="muted">Placeholders: {"{{firstName|there}}"}, {"{{name}}"}, {"{{email}}"}. The part after | is used when the name is unknown or there are several recipients.</small>
	</label>
	<div class="preview"><small class="muted">Preview</small>{preview}</div>

	<label class="choice">
		<input type="checkbox" bind:checked={nudges.stopOnOpen} />
		<span><strong>Also stop once they open</strong><small class="muted">Replies always stop follow-ups.</small></span>
	</label>
	<label class="choice">
		<input type="checkbox" bind:checked={nudges.window.enabled} />
		<span><strong>Only send during working hours</strong><small class="muted">In your current time zone.</small></span>
	</label>
	{#if nudges.window.enabled}
		<div class="inline indent">
			<label>From <input class="input num" type="number" min="0" max="23" bind:value={nudges.window.startHour} />:00</label>
			<label>to <input class="input num" type="number" min="1" max="24" bind:value={nudges.window.endHour} />:00</label>
			<label class="choice"><input type="checkbox" bind:checked={nudges.window.weekdaysOnly} /> <span>Weekdays only</span></label>
		</div>
	{/if}
</section>

<style>
	h2 {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.small {
		font-size: 12px;
		margin: -4px 0 12px;
	}
	.connector {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-bottom: 16px;
	}
	.connector small {
		flex-basis: 100%;
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
	.indent {
		margin: -4px 0 12px 24px;
	}
	.num {
		width: 64px;
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
	.ok {
		color: var(--green);
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	.bad {
		color: var(--danger);
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
</style>
