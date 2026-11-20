const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", encoder.encode(value)),
	);
}

function hex(bytes: Uint8Array): string {
	let out = "";
	for (const b of bytes) out += b.toString(16).padStart(2, "0");
	return out;
}

/** Salted, truncated (128-bit) IP hash. Raw IPs are never stored. */
export async function hashIp(ip: string, salt: string): Promise<string> {
	return hex(await sha256(`${ip}${salt}`)).slice(0, 32);
}

/** Constant-time string comparison (hashing first equalises lengths). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
	const [x, y] = await Promise.all([sha256(a), sha256(b)]);
	let diff = a.length === b.length ? 0 : 1;
	for (let i = 0; i < x.length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}
