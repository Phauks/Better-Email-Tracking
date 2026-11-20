<script lang="ts">
	import { onMount } from "svelte";
	import { INDIVIDUAL_TOOLTIP } from "../../lib/copy";
	import {
		type DefaultMode,
		loadSettings,
		normalizeDomains,
		normalizeSettings,
		normalizeWorkerUrl,
		type Settings,
		saveSettings,
		workerOriginPattern,
	} from "../../settings";
	import { ApiClient } from "../../api/client";
	import Icon from "../components/Icon.svelte";
	import FollowUpSettings from "../follow-ups/FollowUpSettings.svelte";

	let s = $state<Settings>(normalizeSettings({}));
	let domainsText = $state("");
	let saved = $state("");
	let saveError = $state("");
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; lines: string[] } | null>(null);

	onMount(() => {
		void loadSettings().then((loaded) => {
			s = loaded;
			domainsText = loaded.neverTrackDomains.join("\n");
		});
	});

	function requestHostPermission(url: string): Promise<boolean> {
		const pattern = workerOriginPattern(url);
		if (!pattern) return Promise.resolve(false);
		// Must be called synchronously inside the click handler (user gesture).
		return chrome.permissions.request({ origins: [pattern] });
	}

	function save(e: SubmitEvent) {
		e.preventDefault();
		saved = "";
		saveError = "";
		const workerUrl = normalizeWorkerUrl(s.workerUrl);
		if (workerUrl && !/^https:\/\//.test(workerUrl)) {
			saveError = "The tracker URL must start with https://";
			return;
		}
		const permission = workerUrl ? requestHostPermission(workerUrl) : Promise.resolve(true);
		void (async () => {
			let granted = false;
			try {
				granted = await permission;
			} catch (err) {
				saveError = `Permission request failed: ${(err as Error).message}`;
			}
			s = await saveSettings({
				...$state.snapshot(s),
				workerUrl,
				neverTrackDomains: normalizeDomains(domainsText.split(/[\s,]+/)),
			});
			domainsText = s.neverTrackDomains.join("\n");
			saved = granted || !workerUrl ? "Saved." : "Saved, but access to the tracker URL wasn't granted.";
		})();
	}

	async function testConnection() {
		testing = true;
		testResult = null;
		const lines: string[] = [];
		let ok = true;
		const api = new ApiClient(normalizeWorkerUrl(s.workerUrl), s.apiToken.trim());
		try {
			await api.health();
			lines.push("Server reachable.");
		} catch (err) {
			ok = false;
			lines.push(`Server: ${(err as Error).message}`);
		}
		if (ok) {
			try {
				const res = await api.listMessages({ limit: 1 });
				lines.push(`Token accepted (${res.messages.length ? "has tracked messages" : "no messages yet"}).`);
			} catch (err) {
				ok = false;
				lines.push(`Token: ${(err as Error).message}`);
			}
		}
		testResult = { ok, lines };
		testing = false;
	}

	const modes: { value: DefaultMode; label: string; hint: string }[] = [
		{ value: "shared", label: "Track", hint: "One email, one tracker for everyone." },
		{ value: "individual", label: "Track each recipient", hint: INDIVIDUAL_TOOLTIP },
		{ value: "off", label: "Off", hint: "Turn tracking on per email from the compose toolbar." },
	];
</script>

<main>
	<h1><Icon name="envelope-simple-open" size={22} /> Email tracking settings</h1>

	<form onsubmit={save}>
		<section>
			<h2>Tracking server</h2>
			<label>
				<span>Tracker URL</span>
				<input class="input" type="url" placeholder="https://track.example.com" bind:value={s.workerUrl} required />
				<small class="muted">Your Cloudflare Worker. It serves the pixel and link redirects too.</small>
			</label>
			<label>
				<span>API token</span>
				<input class="input" type="password" autocomplete="off" bind:value={s.apiToken} required />
			</label>
			<div class="row">
				<button class="btn" type="button" onclick={testConnection} disabled={testing || !s.workerUrl}>
					<Icon name="plugs-connected" /> {testing ? "Testing…" : "Test connection"}
				</button>
				{#if testResult}
					<span class={testResult.ok ? "ok" : "bad"}>
						<Icon name={testResult.ok ? "check" : "warning"} />
						{testResult.lines.join(" ")}
					</span>
				{/if}
			</div>
		</section>

		<section>
			<h2>New emails</h2>
			<fieldset>
				<legend>Default tracking</legend>
				{#each modes as m (m.value)}
					<label class="choice">
						<input type="radio" name="mode" value={m.value} bind:group={s.defaultMode} />
						<span>
							<strong>{m.label}</strong>
							<small class="muted">{m.hint}</small>
						</span>
					</label>
				{/each}
			</fieldset>
			<label class="choice">
				<input type="checkbox" bind:checked={s.trackLinks} />
				<span><strong>Track link clicks</strong><small class="muted">Unsubscribe links are never rewritten.</small></span>
			</label>
			<label>
				<span>Never track these domains</span>
				<textarea class="input" rows="3" placeholder="lawfirm.com&#10;example.org" bind:value={domainsText}></textarea>
				<small class="muted">One per line. Subdomains are included. Mail to any of these is sent untracked.</small>
			</label>
		</section>

		<FollowUpSettings bind:nudges={s.nudges} />

		<section>
			<h2>Notifications</h2>
			<label class="choice">
				<input type="checkbox" bind:checked={s.notify} />
				<span><strong>Desktop notifications</strong><small class="muted">For opens and clicks on your tracked emails.</small></span>
			</label>
			<label class="choice">
				<input type="checkbox" bind:checked={s.notifyMachineOpens} disabled={!s.notify} />
				<span>
					<strong>Include machine opens</strong>
					<small class="muted">Apple Mail Privacy Protection and scanners load images automatically, so these may not be real reads.</small>
				</span>
			</label>
		</section>

		<div class="row">
			<button class="btn primary" type="submit">Save</button>
			{#if saved}<span class="ok">{saved}</span>{/if}
			{#if saveError}<span class="bad">{saveError}</span>{/if}
		</div>
	</form>
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}
	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 20px;
	}
	h2 {
		font-size: 15px;
		margin: 0 0 12px;
	}
	section {
		padding: 16px;
		margin-bottom: 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-soft);
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
	}
	label > span:first-child {
		font-weight: 500;
	}
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
		flex-direction: row;
		align-items: flex-start;
		gap: 8px;
	}
	.choice > span {
		display: flex;
		flex-direction: column;
		font-weight: normal;
	}
	.choice input {
		margin-top: 3px;
	}
	small {
		font-size: 12px;
	}
	textarea {
		resize: vertical;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
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
