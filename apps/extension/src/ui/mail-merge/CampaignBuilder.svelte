<script lang="ts">
	import {
		buildRecipients,
		CAMPAIGN_LIMITS,
		type CampaignSettings,
		type ColumnMapping,
		type CsvTable,
		DEFAULT_CAMPAIGN_SETTINGS,
		fieldKey,
		type MergeRecipient,
		newId,
		parseCsv,
		previewMerge,
		suggestMapping,
		unknownFields,
	} from "@bet/shared";
	import { onMount, untrack } from "svelte";
	import {
		availableFields,
		type BuilderSeed,
		buildCreateRequest,
		estimateMinutes,
		GMAIL_LIMITS_CONSUMER_URL,
		GMAIL_LIMITS_URL,
		issueText,
	} from "../../lib/campaigns";
	import { plural } from "../../lib/time";
	import { loadSettings } from "../../settings";
	import Icon from "../components/Icon.svelte";
	import { pageApi } from "../api";
	import { dispatchToMailTabs, NO_MAIL_TAB } from "./api";

	let {
		seed,
		onDone,
		onCancel,
	}: {
		seed?: BuilderSeed;
		onDone: (id: string, notice: string) => void;
		onCancel: () => void;
	} = $props();

	// The builder is re-created (keyed) for each seed, so reading it once is intended.
	const initial = untrack(() => seed);

	type Role = "email" | "name" | "field" | "ignore";
	const STEPS = ["Recipients", "Compose", "Preview", "Send"] as const;

	let step = $state(initial ? 1 : 0);
	let csvText = $state("");
	let table = $state<CsvTable | null>(null);
	let roles = $state<Role[]>([]);
	let keys = $state<string[]>([]);
	let name = $state(initial?.name ?? "");
	let subject = $state(initial?.subject ?? "");
	let body = $state(initial?.body ?? "");
	let settings = $state<CampaignSettings>({ ...DEFAULT_CAMPAIGN_SETTINGS });
	let previewIndex = $state(0);
	let saving = $state(false);
	let error = $state("");
	let subjectEl = $state<HTMLInputElement>();
	let bodyEl = $state<HTMLTextAreaElement>();
	let lastFocus: "subject" | "body" = "body";

	onMount(() => {
		void loadSettings().then((s) => {
			settings.trackLinks = s.trackLinks;
		});
	});

	function loadTable(text: string) {
		error = "";
		const t = parseCsv(text);
		table = t;
		const m = suggestMapping(t.headers, t.rows);
		roles = t.headers.map((_, i) =>
			i === m.email ? "email" : i === m.name ? "name" : "field",
		);
		keys = t.headers.map((h, i) => m.fields[i] ?? fieldKey(h));
	}

	async function onFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		csvText = await file.text();
		loadTable(csvText);
	}

	function setRole(i: number, role: Role) {
		// Only one email and one name column.
		if (role === "email" || role === "name")
			roles = roles.map((r, j) => (j !== i && r === role ? "field" : r));
		roles[i] = role;
	}

	const mapping = $derived.by((): ColumnMapping | null => {
		const email = roles.indexOf("email");
		if (email === -1) return null;
		const nameCol = roles.indexOf("name");
		const m: ColumnMapping = {
			email,
			fields: roles.map((r, i) =>
				r === "ignore" ? null : r === "email" ? "email" : r === "name" ? "name" : fieldKey(keys[i] ?? "") || null,
			),
		};
		if (nameCol !== -1) m.name = nameCol;
		return m;
	});

	const built = $derived(
		seed
			? { recipients: seed.recipients, issues: [] }
			: table && mapping
				? buildRecipients(table, mapping)
				: { recipients: [] as MergeRecipient[], issues: [] },
	);
	const recipients = $derived(built.recipients);
	const fields = $derived(availableFields(recipients));
	const template = $derived({ subject, body });
	const preview = $derived(previewMerge(template, recipients, settings.missingPolicy));
	const unknown = $derived(unknownFields(template, recipients));
	const withMissing = $derived(preview.filter((p) => p.missing.length > 0));
	const sendable = $derived(preview.filter((p) => !p.blocked).length);
	const current = $derived(preview[Math.min(previewIndex, preview.length - 1)]);
	const tooMany = $derived(recipients.length > CAMPAIGN_LIMITS.maxRecipients);

	const canNext = $derived(
		step === 0
			? recipients.length > 0 && !tooMany
			: step === 1
				? subject.trim() !== "" && body.trim() !== ""
				: step === 2
					? sendable > 0
					: true,
	);

	function insertField(key: string) {
		const tag = `{{${key}}}`;
		const el = lastFocus === "subject" ? subjectEl : bodyEl;
		if (!el) return;
		const start = el.selectionStart ?? el.value.length;
		const end = el.selectionEnd ?? start;
		const next = el.value.slice(0, start) + tag + el.value.slice(end);
		if (lastFocus === "subject") subject = next;
		else body = next;
		queueMicrotask(() => {
			el.focus();
			el.setSelectionRange(start + tag.length, start + tag.length);
		});
	}

	function setDelay(which: "minDelaySec" | "maxDelaySec", value: number) {
		settings[which] = Math.max(CAMPAIGN_LIMITS.minDelaySec, Math.min(CAMPAIGN_LIMITS.maxDelaySec, Math.round(value || 0)));
		if (settings.maxDelaySec < settings.minDelaySec) settings.maxDelaySec = settings.minDelaySec;
	}

	async function save(start: boolean) {
		saving = true;
		error = "";
		try {
			const req = buildCreateRequest({
				id: newId(),
				name,
				provider: "gmail",
				subject,
				body,
				recipients,
				settings: { ...settings },
				start,
			});
			const api = await pageApi();
			await api.createCampaign(req);
			let notice = start ? "Campaign started." : "Draft saved.";
			if (start) {
				const tabs = await dispatchToMailTabs();
				notice = tabs > 0 ? "Campaign started. Sending from your open Gmail tab." : NO_MAIL_TAB;
			}
			onDone(req.id, notice);
		} catch (err) {
			error = (err as Error).message;
		} finally {
			saving = false;
		}
	}
</script>

<section class="card builder">
	<ol class="steps">
		{#each STEPS as label, i (label)}
			<li class:active={i === step} class:done={i < step}>
				<button type="button" disabled={i > step || (seed && i === 0)} onclick={() => (step = i)}>
					<span class="num">{i + 1}</span>{label}
				</button>
			</li>
		{/each}
	</ol>

	{#if step === 0}
		<div class="pane">
			<p class="muted">Paste CSV (with a header row) or upload a file exported from a spreadsheet.</p>
			<label class="btn upload">
				<Icon name="upload-simple" /> Upload CSV
				<input type="file" accept=".csv,.tsv,.txt,text/csv" onchange={onFile} hidden />
			</label>
			<textarea
				class="input mono"
				rows="7"
				placeholder={"email,first_name,company\nada@example.com,Ada,Analytical Engines"}
				bind:value={csvText}
				oninput={() => loadTable(csvText)}
			></textarea>
			{#if table && table.headers.length > 0}
				<h3>Columns</h3>
				<table class="map">
					<thead><tr><th>Column</th><th>Example</th><th>Use as</th><th>Field name</th></tr></thead>
					<tbody>
						{#each table.headers as header, i (header)}
							<tr>
								<td>{header}</td>
								<td class="muted ellipsis">{table.rows[0]?.[i] ?? ""}</td>
								<td>
									<select class="input" value={roles[i]} onchange={(e) => setRole(i, e.currentTarget.value as Role)}>
										<option value="email">Email address</option>
										<option value="name">Name</option>
										<option value="field">Field</option>
										<option value="ignore">Ignore</option>
									</select>
								</td>
								<td>
									{#if roles[i] === "field"}
										<input class="input mono" bind:value={keys[i]} aria-label="Field name for {header}" />
									{:else if roles[i] !== "ignore"}
										<code>{roles[i]}</code>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				{#if !mapping}<p class="bad"><Icon name="warning-circle" /> Choose the column that holds email addresses.</p>{/if}
				<p>
					<strong>{plural(recipients.length, "recipient")}</strong>
					{#if built.issues.length}<span class="muted">· {plural(built.issues.length, "row")} left out</span>{/if}
				</p>
				{#if tooMany}<p class="bad">At most {CAMPAIGN_LIMITS.maxRecipients} recipients per campaign.</p>{/if}
				{#if built.issues.length}
					<details>
						<summary class="muted">Rows left out</summary>
						<ul class="issues">{#each built.issues as issue (issue.row)}<li>{issueText(issue)}</li>{/each}</ul>
					</details>
				{/if}
				{#each table.errors as e (e)}<p class="warn"><Icon name="warning" /> {e}</p>{/each}
			{/if}
		</div>
	{:else if step === 1}
		<div class="pane">
			{#if seed}
				<p class="note"><Icon name="arrow-u-up-left" /> Following up with {plural(recipients.length, "recipient")} who {recipients.length === 1 ? "hasn't" : "haven't"} opened yet.</p>
			{/if}
			<label>Campaign name <input class="input" bind:value={name} placeholder="Spring outreach" /></label>
			<label>
				Subject
				<input class="input" bind:this={subjectEl} bind:value={subject} onfocus={() => (lastFocus = "subject")} placeholder={"Quick question, {{first_name}}"} />
			</label>
			<label>
				Body <span class="muted small">(plain text; simple HTML like &lt;b&gt; or &lt;a href&gt; is allowed)</span>
				<textarea class="input" rows="12" bind:this={bodyEl} bind:value={body} onfocus={() => (lastFocus = "body")} placeholder={"Hi {{first_name|there}},\n\n…"}></textarea>
			</label>
			<div class="fields">
				<span class="muted small">Insert field:</span>
				{#each fields as f (f)}
					<button type="button" class="chip" onclick={() => insertField(f)}>{f}</button>
				{/each}
			</div>
			<p class="muted small">Use <code>{"{{field|fallback}}"}</code> for a default when a value is empty.</p>
			{#if unknown.length}
				<p class="warn"><Icon name="warning" /> No recipient has {unknown.map((f) => `{{${f}}}`).join(", ")}. Check the spelling.</p>
			{/if}
		</div>
	{:else if step === 2}
		<div class="pane">
			<div class="row">
				<label class="inline">
					When a field is empty
					<select class="input" bind:value={settings.missingPolicy}>
						<option value="block">Skip that recipient</option>
						<option value="warn">Send with the field blank</option>
					</select>
				</label>
				<span class="muted">{sendable} of {preview.length} will be sent</span>
			</div>
			{#if withMissing.length}
				<p class="warn">
					<Icon name="warning" />
					{plural(withMissing.length, "recipient")} {withMissing.length === 1 ? "is" : "are"} missing fields
					{settings.missingPolicy === "block" ? "and will be skipped" : "and will get blanks"}:
					{withMissing.slice(0, 5).map((p) => `${p.recipient.email} (${p.missing.join(", ")})`).join("; ")}{withMissing.length > 5 ? "…" : ""}
				</p>
			{/if}
			{#if current}
				<div class="pager">
					<button type="button" class="btn" disabled={previewIndex === 0} onclick={() => previewIndex--}><Icon name="caret-right" size={12} /></button>
					<select class="input" bind:value={previewIndex} aria-label="Preview recipient">
						{#each preview as p, i (p.recipient.email)}<option value={i}>{i + 1}. {p.recipient.email}{p.blocked ? " (skipped)" : p.missing.length ? " (missing fields)" : ""}</option>{/each}
					</select>
					<button type="button" class="btn" disabled={previewIndex >= preview.length - 1} onclick={() => previewIndex++}><Icon name="caret-right" size={12} /></button>
				</div>
				<div class="mail">
					<div class="hdr"><span class="muted">To</span> {current.recipient.name ? `${current.recipient.name} <${current.recipient.email}>` : current.recipient.email}</div>
					<div class="hdr"><span class="muted">Subject</span> {current.subject || "(no subject)"}</div>
					{#if current.missing.length}<div class="hdr warn">Missing: {current.missing.join(", ")}</div>{/if}
					<iframe title="Message preview" sandbox="" srcdoc={`<meta charset="utf-8"><style>body{font:14px/1.5 Arial,sans-serif;margin:12px;color:#202124}</style>${current.html}`}></iframe>
				</div>
			{/if}
		</div>
	{:else}
		<div class="pane">
			<div class="grid">
				<label>Wait between emails, at least (seconds)
					<input class="input" type="number" min={CAMPAIGN_LIMITS.minDelaySec} max={CAMPAIGN_LIMITS.maxDelaySec} value={settings.minDelaySec} onchange={(e) => setDelay("minDelaySec", e.currentTarget.valueAsNumber)} />
				</label>
				<label>At most (seconds)
					<input class="input" type="number" min={settings.minDelaySec} max={CAMPAIGN_LIMITS.maxDelaySec} value={settings.maxDelaySec} onchange={(e) => setDelay("maxDelaySec", e.currentTarget.valueAsNumber)} />
				</label>
				<label>Send at most this many per run
					<input class="input" type="number" min="1" max={CAMPAIGN_LIMITS.maxPerRunCap} bind:value={settings.perRunCap} />
				</label>
			</div>
			<label class="check"><input type="checkbox" bind:checked={settings.trackLinks} /> Track link clicks</label>
			<p class="muted small">
				Each email is sent from your Gmail tab, one at a time, with a random pause in between.
				After {settings.perRunCap} emails the campaign pauses until you resume it.
				This run takes about {estimateMinutes(sendable, settings)} min. Keep a Gmail tab open while it sends.
			</p>
			<p class="note small">
				<Icon name="warning-circle" /> Gmail limits how many emails and recipients you can send per day, and the limits
				differ by account type. Check Google's limits for
				<a href={GMAIL_LIMITS_CONSUMER_URL} target="_blank" rel="noreferrer">personal Gmail</a> and
				<a href={GMAIL_LIMITS_URL} target="_blank" rel="noreferrer">Google Workspace</a> before a large send.
			</p>
		</div>
	{/if}

	{#if error}<p class="bad pad">{error}</p>{/if}

	<footer>
		<button type="button" class="btn" onclick={onCancel}>Cancel</button>
		<span class="spacer"></span>
		{#if step > (seed ? 1 : 0)}<button type="button" class="btn" onclick={() => step--}>Back</button>{/if}
		{#if step < 3}
			<button type="button" class="btn primary" disabled={!canNext} onclick={() => step++}>Next</button>
		{:else}
			<button type="button" class="btn" disabled={saving} onclick={() => save(false)}>Save draft</button>
			<button type="button" class="btn primary" disabled={saving || sendable === 0} onclick={() => save(true)}>
				<Icon name="paper-plane-tilt" /> Send to {plural(sendable, "recipient")}
			</button>
		{/if}
	</footer>
</section>

<style>
	.builder {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		margin-bottom: 16px;
	}
	.steps {
		display: flex;
		list-style: none;
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--border);
	}
	.steps li {
		flex: 1;
	}
	.steps button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 12px 16px;
		border: 0;
		background: none;
		color: var(--text-muted);
		cursor: pointer;
	}
	.steps button:disabled {
		cursor: default;
	}
	.steps li.active button {
		color: var(--text);
		font-weight: 600;
		box-shadow: inset 0 -2px var(--accent);
	}
	.num {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--bg-soft);
		font-size: 12px;
	}
	.steps li.active .num,
	.steps li.done .num {
		background: var(--accent);
		color: var(--bg);
	}
	.pane {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label.inline,
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	label.inline select {
		width: auto;
	}
	.upload {
		flex-direction: row;
		align-self: flex-start;
	}
	textarea {
		resize: vertical;
		font: inherit;
		color: inherit;
	}
	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
	}
	h3 {
		margin: 4px 0 0;
		font-size: 14px;
	}
	.map {
		width: 100%;
		border-collapse: collapse;
	}
	.map th,
	.map td {
		padding: 6px 8px;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}
	.map th {
		font-weight: 500;
		color: var(--text-muted);
		font-size: 12px;
	}
	.ellipsis {
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.issues {
		margin: 6px 0 0;
		padding-left: 18px;
		font-size: 12px;
	}
	.fields {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.chip {
		padding: 2px 10px;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--bg-soft);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 12px;
		cursor: pointer;
	}
	.chip:hover {
		background: var(--accent-soft);
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.pager {
		display: flex;
		gap: 8px;
	}
	.pager .btn:first-child :global(svg) {
		transform: rotate(180deg);
	}
	.mail {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}
	.hdr {
		padding: 6px 12px;
		border-bottom: 1px solid var(--border);
		background: var(--bg-soft);
	}
	.hdr .muted {
		display: inline-block;
		width: 64px;
	}
	iframe {
		display: block;
		width: 100%;
		height: 320px;
		border: 0;
		background: #fff;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin: 0;
		padding: 8px 12px;
		border-radius: var(--radius);
		background: var(--accent-soft);
	}
	.warn {
		color: #b06000;
		margin: 0;
	}
	.bad {
		color: var(--danger);
		margin: 0;
	}
	.pad {
		padding: 0 16px;
	}
	.small {
		font-size: 12px;
	}
	footer {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--border);
	}
	.spacer {
		flex: 1;
	}
	@media (max-width: 600px) {
		.steps button {
			padding: 10px 8px;
			font-size: 12px;
		}
	}
</style>
