const ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Unguessable 22-char base62 id (~131 bits). Works in browsers, Workers and Node 20+. */
export function newId(length = 22): string {
	const bytes = new Uint8Array(length);
	crypto.getRandomValues(bytes);
	let out = "";
	for (const b of bytes) out += ALPHABET[b % 62];
	return out;
}

const ID_RE = /^[0-9A-Za-z]{16,32}$/;

export function isValidId(value: string): boolean {
	return ID_RE.test(value);
}
