/**
 * Page count of an uploaded PDF, read by the Worker so a viewer can't set it. Reads
 * the page tree root's /Count (the largest /Count of any /Type /Pages node), looking
 * in plain objects first and then in compressed object streams (PDF 1.5+). Returns
 * undefined when it can't tell (encrypted, broken, unusual); the viewer's report is
 * then used as a fallback.
 */

const MAX_OBJECT_STREAMS = 64;
const MAX_INFLATED_BYTES = 8 * 1024 * 1024;

/** The "<< ... >>" dictionary enclosing `pos`, or null. */
function enclosingDict(text: string, pos: number): string | null {
	let depth = 0;
	let open = -1;
	for (let i = pos; i > Math.max(0, pos - 65_536); i--) {
		const two = text.slice(i - 1, i + 1);
		if (two === ">>") {
			depth++;
			i--;
		} else if (two === "<<") {
			if (depth === 0) {
				open = i - 1;
				break;
			}
			depth--;
			i--;
		}
	}
	if (open < 0) return null;
	depth = 0;
	for (let i = open; i < text.length - 1 && i < open + 65_536; i++) {
		const two = text.slice(i, i + 2);
		if (two === "<<") {
			depth++;
			i++;
		} else if (two === ">>") {
			depth--;
			i++;
			if (depth === 0) return text.slice(open + 2, i - 1);
		}
	}
	return null;
}

/** Drops nested dictionaries so only top-level keys remain. */
function topLevel(dict: string): string {
	let out = dict;
	for (let i = 0; i < 32; i++) {
		const next = out.replace(/<<(?:(?!<<|>>)[\s\S])*>>/g, " ");
		if (next === out) break;
		out = next;
	}
	return out;
}

/** Largest /Count of a /Type /Pages dictionary in this text (the page tree root's). */
function maxPagesCount(text: string): number | undefined {
	let best: number | undefined;
	for (const m of text.matchAll(/\/Type\s*\/Pages\b/g)) {
		const dict = enclosingDict(text, m.index ?? 0);
		if (!dict) continue;
		const count = /\/Count\s+(\d+)/.exec(topLevel(dict))?.[1];
		if (count === undefined) continue;
		const n = Number(count);
		if (Number.isSafeInteger(n) && (best === undefined || n > best)) best = n;
	}
	return best;
}

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
	try {
		const stream = new Blob([data as Uint8Array<ArrayBuffer>])
			.stream()
			.pipeThrough(new DecompressionStream("deflate"));
		const reader = stream.getReader();
		const parts: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_INFLATED_BYTES) {
				await reader.cancel();
				return null;
			}
			parts.push(value);
		}
		const out = new Uint8Array(size);
		let at = 0;
		for (const p of parts) {
			out.set(p, at);
			at += p.byteLength;
		}
		return out;
	} catch {
		return null;
	}
}

const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

export async function pdfPageCount(
	data: ArrayBuffer,
): Promise<number | undefined> {
	const bytes = new Uint8Array(data);
	const text = latin1(bytes);
	if (!text.startsWith("%PDF-")) return undefined;
	if (/\/Encrypt\b/.test(text)) return undefined;
	const plain = maxPagesCount(text);
	if (plain !== undefined && plain > 0) return plain;

	// Object streams: "<< /Type /ObjStm ... /Filter /FlateDecode ... >> stream\r?\n ... endstream"
	let best: number | undefined;
	let seen = 0;
	const objStm =
		/<<((?:(?!<<|>>)[\s\S])*\/Type\s*\/ObjStm(?:(?!<<|>>)[\s\S])*)>>\s*stream\r?\n/g;
	for (const m of text.matchAll(objStm)) {
		if (++seen > MAX_OBJECT_STREAMS) break;
		const dict = m[1] ?? "";
		if (!/\/Filter\s*\/FlateDecode\b/.test(dict)) continue;
		const start = (m.index ?? 0) + m[0].length;
		const declared = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1];
		const end =
			declared !== undefined
				? start + Number(declared)
				: text.indexOf("endstream", start);
		if (end <= start || end > bytes.length) continue;
		const inflated = await inflate(bytes.subarray(start, end));
		if (!inflated) continue;
		const n = maxPagesCount(latin1(inflated));
		if (n !== undefined && (best === undefined || n > best)) best = n;
	}
	return best !== undefined && best > 0 ? best : undefined;
}
