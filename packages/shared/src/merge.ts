import { escapeHtml, firstName } from "./text";

/**
 * Mail merge engine: CSV parsing, column mapping, recipient validation and templates.
 * Pure and environment-neutral (dashboard, content script, Worker and tests all use it).
 */

// ---------------------------------------------------------------------------
// CSV (RFC 4180, plus the things spreadsheets actually export)
// ---------------------------------------------------------------------------

export interface CsvTable {
	headers: string[];
	rows: string[][];
	/** Problems that did not stop parsing (e.g. an unterminated quote). */
	errors: string[];
}

const DELIMITERS = [",", ";", "\t"] as const;

/** Picks the delimiter that splits the first line into the most columns (outside quotes). */
export function detectDelimiter(text: string): string {
	let best = ",";
	let bestCount = 0;
	for (const d of DELIMITERS) {
		let count = 0;
		let quoted = false;
		for (const ch of text) {
			if (ch === '"') quoted = !quoted;
			else if (!quoted && (ch === "\n" || ch === "\r")) break;
			else if (!quoted && ch === d) count++;
		}
		if (count > bestCount) {
			best = d;
			bestCount = count;
		}
	}
	return best;
}

/**
 * Parses CSV text into records. Handles quoted fields, escaped quotes (""), delimiters
 * and line breaks inside quotes, CRLF/LF/CR line endings and a UTF-8 BOM. Blank lines
 * are skipped. Lenient: a stray quote inside an unquoted field is kept as text.
 */
export function parseCsvRecords(
	input: string,
	delimiter = detectDelimiter(input),
): { records: string[][]; errors: string[] } {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
	const records: string[][] = [];
	const errors: string[] = [];
	let record: string[] = [];
	let field = "";
	let quoted = false;
	let wasQuoted = false;
	let i = 0;

	const endField = () => {
		record.push(wasQuoted ? field : field.trim());
		field = "";
		wasQuoted = false;
	};
	const endRecord = () => {
		endField();
		if (!(record.length === 1 && record[0] === "")) records.push(record);
		record = [];
	};

	while (i < text.length) {
		const ch = text[i] as string;
		if (quoted) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				quoted = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"' && field.trim() === "" && !wasQuoted) {
			quoted = true;
			wasQuoted = true;
			field = "";
			i++;
		} else if (ch === delimiter) {
			endField();
			i++;
		} else if (ch === "\r" || ch === "\n") {
			endRecord();
			i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
		} else {
			// Text after a closing quote (`"a"b`) is appended, as spreadsheets do.
			field += ch;
			i++;
		}
	}
	if (quoted) errors.push("Unterminated quoted field at end of file");
	if (field !== "" || wasQuoted || record.length > 0) endRecord();
	return { records, errors };
}

/** Parses CSV with a header row. Headers are trimmed; blank or repeated ones get unique names. */
export function parseCsv(input: string, delimiter?: string): CsvTable {
	const { records, errors } = parseCsvRecords(input, delimiter);
	const [head, ...rows] = records;
	if (!head) return { headers: [], rows: [], errors };
	const seen = new Set<string>();
	const headers = head.map((h, i) => {
		let name = h.trim() || `Column ${i + 1}`;
		let n = 2;
		while (seen.has(name.toLowerCase()))
			name = `${h.trim() || "Column"} ${n++}`;
		seen.add(name.toLowerCase());
		return name;
	});
	return { headers, rows, errors };
}

// ---------------------------------------------------------------------------
// Mapping columns to fields
// ---------------------------------------------------------------------------

/** Template field key for a header: "First Name" -> "first_name". */
export function fieldKey(header: string): string {
	return header
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

export interface ColumnMapping {
	/** Index of the column holding email addresses. */
	email: number;
	/** Optional display-name column. */
	name?: number;
	/** Template field name per column index; null or missing = not used. */
	fields: (string | null)[];
}

const EMAIL_HEADERS = ["email", "e_mail", "email_address", "mail", "address"];
const NAME_HEADERS = [
	"name",
	"full_name",
	"display_name",
	"contact",
	"contact_name",
];

/** Best-guess mapping: email/name columns by header, every column as a field named by its key. */
export function suggestMapping(
	headers: string[],
	rows: string[][] = [],
): ColumnMapping {
	const keys = headers.map(fieldKey);
	let email = keys.findIndex((k) => EMAIL_HEADERS.includes(k));
	if (email === -1) email = keys.findIndex((k) => k.includes("email"));
	if (email === -1) {
		// No telling header: take the column whose first values look like addresses.
		email = headers.findIndex((_, i) =>
			rows.slice(0, 5).some((r) => isValidEmail(r[i] ?? "")),
		);
	}
	const name = keys.findIndex((k) => NAME_HEADERS.includes(k));
	const used = new Set<string>();
	const fields = keys.map((k, i) => {
		let key =
			i === email ? "email" : i === name ? "name" : k || `column_${i + 1}`;
		let n = 2;
		while (used.has(key)) key = `${k}_${n++}`;
		used.add(key);
		return key;
	});
	const mapping: ColumnMapping = { email: Math.max(0, email), fields };
	if (name !== -1 && name !== email) mapping.name = name;
	return mapping;
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

const EMAIL_RE =
	/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Pragmatic address check: one @, a dotted domain, no spaces. Not full RFC 5322. */
export function isValidEmail(value: string): boolean {
	const v = value.trim();
	if (v.length > 254 || v.includes("..")) return false;
	const at = v.lastIndexOf("@");
	if (at < 1 || at > 64) return false;
	return EMAIL_RE.test(v);
}

/** Accepts "a@b.com" or "Name <a@b.com>"; returns null for anything else. */
export function parseAddress(
	value: string,
): { email: string; name?: string } | null {
	const v = value.trim();
	const angle = /^(.*?)\s*<([^<>]+)>$/.exec(v);
	const email = (angle ? (angle[2] as string) : v).trim();
	if (!isValidEmail(email)) return null;
	const name = angle?.[1]?.trim().replace(/^"(.*)"$/, "$1");
	return name ? { email, name } : { email };
}

export interface MergeRecipient {
	email: string;
	name?: string;
	/** Template values by field key. Always includes email (and name when known). */
	fields: Record<string, string>;
}

export type RowIssueKind = "invalid_email" | "duplicate" | "empty";

export interface RowIssue {
	/** 1-based data row number (the header row is not counted). */
	row: number;
	kind: RowIssueKind;
	value: string;
}

export interface BuildResult {
	recipients: MergeRecipient[];
	issues: RowIssue[];
}

/**
 * Turns parsed rows into recipients: validates addresses, drops case-insensitive
 * duplicates (the first row wins) and fills `fields` from the mapping. A `first_name`
 * field is derived from the name when no column provides one.
 */
export function buildRecipients(
	table: Pick<CsvTable, "rows">,
	mapping: ColumnMapping,
): BuildResult {
	const recipients: MergeRecipient[] = [];
	const issues: RowIssue[] = [];
	const seen = new Set<string>();
	table.rows.forEach((row, i) => {
		const rowNo = i + 1;
		if (row.every((v) => v.trim() === "")) {
			issues.push({ row: rowNo, kind: "empty", value: "" });
			return;
		}
		const raw = row[mapping.email] ?? "";
		const addr = parseAddress(raw);
		if (!addr) {
			issues.push({ row: rowNo, kind: "invalid_email", value: raw });
			return;
		}
		const key = addr.email.toLowerCase();
		if (seen.has(key)) {
			issues.push({ row: rowNo, kind: "duplicate", value: addr.email });
			return;
		}
		seen.add(key);
		const fields: Record<string, string> = {};
		mapping.fields.forEach((f, col) => {
			if (f) fields[f] = (row[col] ?? "").trim();
		});
		const name =
			(mapping.name !== undefined ? row[mapping.name]?.trim() : "") ||
			addr.name ||
			"";
		fields.email = addr.email;
		if (name) fields.name = name;
		if (!fields.first_name && name) fields.first_name = firstName(name);
		const r: MergeRecipient = { email: addr.email, fields };
		if (name) r.name = name;
		recipients.push(r);
	});
	return { recipients, issues };
}

// ---------------------------------------------------------------------------
// Templates: {{field}} and {{field|fallback}}
// ---------------------------------------------------------------------------

export type TemplatePart =
	| { kind: "text"; value: string }
	| { kind: "field"; name: string; fallback?: string };

const TAG_RE = /\{\{\s*([^{}|]*?)\s*(?:\|([^{}]*))?\}\}/g;

/** Splits a template into text and field parts. Field names are normalized with fieldKey. */
export function parseTemplate(template: string): TemplatePart[] {
	const parts: TemplatePart[] = [];
	let last = 0;
	for (const m of template.matchAll(TAG_RE)) {
		const name = fieldKey(m[1] ?? "");
		if (!name) continue; // "{{}}" or "{{ | x }}" stay literal
		if (m.index > last)
			parts.push({ kind: "text", value: template.slice(last, m.index) });
		const part: TemplatePart = { kind: "field", name };
		if (m[2] !== undefined) part.fallback = m[2].trim();
		parts.push(part);
		last = m.index + m[0].length;
	}
	if (last < template.length)
		parts.push({ kind: "text", value: template.slice(last) });
	return parts;
}

/** Field names a template uses, in first-use order. */
export function templateFields(template: string): string[] {
	const out: string[] = [];
	for (const p of parseTemplate(template))
		if (p.kind === "field" && !out.includes(p.name)) out.push(p.name);
	return out;
}

export interface RenderResult {
	output: string;
	/** Fields that were empty or absent and had no fallback (rendered as ""). */
	missing: string[];
}

export interface RenderOptions {
	/** Escape values for HTML (the template text itself is trusted markup). */
	html?: boolean;
	/**
	 * With `html`: whether fallbacks are escaped too (default). Pass false when the
	 * template was already converted to HTML, so its fallbacks are markup already
	 * (follow-up nudges: plain text -> textToHtml -> render).
	 */
	escapeFallbacks?: boolean;
}

/**
 * Fills a template. With `html`, values and fallbacks are HTML-escaped (the template
 * text itself is trusted markup written by the sender).
 */
export function renderTemplate(
	template: string,
	fields: Record<string, string>,
	opts: RenderOptions = {},
): RenderResult {
	const missing: string[] = [];
	let output = "";
	for (const p of parseTemplate(template)) {
		if (p.kind === "text") {
			output += p.value;
			continue;
		}
		const value = fields[p.name]?.trim() ?? "";
		if (value) {
			output += opts.html ? escapeHtml(value) : value;
			continue;
		}
		if (p.fallback === undefined) {
			if (!missing.includes(p.name)) missing.push(p.name);
			continue;
		}
		output +=
			opts.html && opts.escapeFallbacks !== false
				? escapeHtml(p.fallback)
				: p.fallback;
	}
	return { output, missing };
}

const BLOCK_TAG = /<(p|div|br|table|ul|ol|li|h[1-6]|blockquote|pre)\b/i;

/**
 * The composer is a plain textarea that allows simple HTML. Unless the body already uses
 * block markup, line breaks become <br> so plain text keeps its shape.
 */
export function bodyToHtml(body: string): string {
	if (BLOCK_TAG.test(body)) return body;
	return body.replace(/\r\n?/g, "\n").replace(/\n/g, "<br>\n");
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/** "block": a recipient with a missing field is not sent. "warn": sent with blanks. */
export type MissingPolicy = "block" | "warn";

export interface MergeTemplate {
	subject: string;
	body: string;
}

export interface RenderedMessage {
	subject: string;
	html: string;
	missing: string[];
	/** True when the policy is "block" and fields are missing. */
	blocked: boolean;
}

/** Renders the subject (plain) and body (HTML) for one recipient. */
export function renderMessage(
	template: MergeTemplate,
	fields: Record<string, string>,
	policy: MissingPolicy = "warn",
): RenderedMessage {
	const subject = renderTemplate(template.subject, fields);
	const body = renderTemplate(template.body, fields, { html: true });
	const missing = [...new Set([...subject.missing, ...body.missing])];
	return {
		subject: subject.output.replace(/[\r\n]+/g, " ").trim(),
		html: bodyToHtml(body.output),
		missing,
		blocked: policy === "block" && missing.length > 0,
	};
}

export interface PreviewRow extends RenderedMessage {
	recipient: MergeRecipient;
}

export function previewMerge(
	template: MergeTemplate,
	recipients: MergeRecipient[],
	policy: MissingPolicy = "warn",
): PreviewRow[] {
	return recipients.map((recipient) => ({
		recipient,
		...renderMessage(template, recipient.fields, policy),
	}));
}

/** Fields a template uses that no recipient provides at all (likely a typo). */
export function unknownFields(
	template: MergeTemplate,
	recipients: MergeRecipient[],
): string[] {
	const known = new Set<string>();
	for (const r of recipients)
		for (const k of Object.keys(r.fields)) known.add(k);
	return [
		...new Set([
			...templateFields(template.subject),
			...templateFields(template.body),
		]),
	].filter((f) => !known.has(f));
}
