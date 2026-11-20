/**
 * Web Crypto helpers for secrets at rest and signed OAuth state. Keys are derived
 * from one server secret (TOKEN_ENC_KEY) with HKDF, using a different label per use.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
	const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
	const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function deriveKey(
	secret: string,
	label: string,
	algorithm: Parameters<SubtleCrypto["deriveKey"]>[2],
	usages: Parameters<SubtleCrypto["deriveKey"]>[4],
): Promise<CryptoKey> {
	if (!secret) throw new Error("TOKEN_ENC_KEY is not set");
	const base = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		"HKDF",
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			salt: encoder.encode("better-email-tracking"),
			info: encoder.encode(label),
		},
		base,
		algorithm,
		false,
		usages,
	);
}

const encKey = (secret: string) =>
	deriveKey(secret, "token-enc/v1", { name: "AES-GCM", length: 256 }, [
		"encrypt",
		"decrypt",
	]);

const stateKey = (secret: string) =>
	deriveKey(
		secret,
		"oauth-state/v1",
		{ name: "HMAC", hash: "SHA-256", length: 256 },
		["sign", "verify"],
	);

/** AES-256-GCM with a random 96-bit IV. Output: "v1.<iv>.<ciphertext>" (base64url). */
export async function encryptSecret(
	plaintext: string,
	secret: string,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await encKey(secret),
		encoder.encode(plaintext),
	);
	return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(new Uint8Array(ct))}`;
}

export async function decryptSecret(
	sealed: string,
	secret: string,
): Promise<string> {
	const [version, iv, ct] = sealed.split(".");
	if (version !== "v1" || !iv || !ct) throw new Error("bad sealed value");
	const pt = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: base64UrlDecode(iv) },
		await encKey(secret),
		base64UrlDecode(ct),
	);
	return decoder.decode(pt);
}

export interface StatePayload {
	/** Connector kind the flow is for. */
	k: string;
	/** Expiry, epoch ms. */
	exp: number;
	/** Random nonce. */
	n: string;
}

/** Signed, short-lived OAuth state: "<payload>.<hmac>" (base64url). */
export async function signState(
	payload: StatePayload,
	secret: string,
): Promise<string> {
	const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
	const sig = await crypto.subtle.sign(
		"HMAC",
		await stateKey(secret),
		encoder.encode(body),
	);
	return `${body}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Returns the payload if the signature is valid and it has not expired. */
export async function verifyState(
	state: string,
	secret: string,
	now: number,
): Promise<StatePayload | null> {
	const [body, sig] = state.split(".");
	if (!body || !sig) return null;
	let ok = false;
	try {
		ok = await crypto.subtle.verify(
			"HMAC",
			await stateKey(secret),
			base64UrlDecode(sig),
			encoder.encode(body),
		);
	} catch {
		return null;
	}
	if (!ok) return null;
	try {
		const payload = JSON.parse(
			decoder.decode(base64UrlDecode(body)),
		) as StatePayload;
		if (typeof payload.exp !== "number" || payload.exp < now) return null;
		if (typeof payload.k !== "string") return null;
		return payload;
	} catch {
		return null;
	}
}
