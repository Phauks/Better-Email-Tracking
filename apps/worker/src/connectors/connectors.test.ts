import type {
	ConnectorStatusResponse,
	StartConnectorResponse,
} from "@bet/shared";
import { describe, expect, it } from "vitest";
import {
	base64UrlDecode,
	decryptSecret,
	encryptSecret,
	signState,
	verifyState,
} from "../lib/crypto";
import type { NudgeEnv } from "../nudges/env";
import { createNudgesModule } from "../nudges/module";
import { MemoryNudgeStore } from "../nudges/store/memory";
import { apiModule } from "../routes/api";
import { setup, T0 } from "../test-utils";
import { addressOf, GmailConnector, inspectGmailThread } from "./gmail";
import { GOOGLE_TOKEN_URL } from "./google-oauth";
import {
	buildReplyMime,
	encodeHeaderText,
	formatAddress,
	toGmailRaw,
} from "./mime";
import { resolveConnector } from "./registry";

const KEY = "test-encryption-key-0123456789";
const decode = (b64: string) =>
	new TextDecoder().decode(
		Uint8Array.from(atob(b64.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)),
	);

describe("MIME builder", () => {
	const reply = {
		from: "me@example.com",
		to: [{ email: "ann@example.com", name: "Ann Lee" }],
		cc: [{ email: "zoë@example.com", name: "Zoë Ünicode" }],
		subject: "Re: Café plans ☕",
		html: "<p>Hi Ann,<br>just checking in. Ça va?</p>",
		inReplyTo: "<last@mail.example.com>",
		references: ["<orig@mail.example.com>"],
		markerId: "nudge0000000000000001",
	};

	it("writes threading headers, encoded subject and base64 parts with CRLF", () => {
		const mime = buildReplyMime(reply, "BOUNDARY");
		const [head, ...rest] = mime.split("\r\n\r\n");
		expect(mime).not.toMatch(/[^\r]\n/);
		const headers = head?.split("\r\n") ?? [];
		expect(headers).toContain("From: me@example.com");
		expect(headers).toContain('To: "Ann Lee" <ann@example.com>');
		expect(headers.find((h) => h.startsWith("Cc: "))).toMatch(
			/^Cc: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <zoë@example.com>$/,
		);
		expect(headers).toContain("In-Reply-To: <last@mail.example.com>");
		expect(head).toContain(
			"References: <orig@mail.example.com>\r\n <last@mail.example.com>",
		);
		expect(headers).toContain("X-BET-Nudge-Id: nudge0000000000000001");
		expect(headers).toContain("MIME-Version: 1.0");
		expect(headers).toContain(
			'Content-Type: multipart/alternative; boundary="BOUNDARY"',
		);
		const subject = headers.find((h) => h.startsWith("Subject: "));
		expect(subject).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=$/);
		const words = /=\?UTF-8\?B\?([^?]+)\?=/.exec(subject ?? "");
		expect(decode(words?.[1] ?? "")).toBe("Re: Café plans ☕");

		const body = rest.join("\r\n\r\n");
		expect(body).toContain('Content-Type: text/plain; charset="UTF-8"');
		expect(body).toContain('Content-Type: text/html; charset="UTF-8"');
		expect(body).toContain("Content-Transfer-Encoding: base64");
		expect(mime.trimEnd().endsWith("--BOUNDARY--")).toBe(true);
		const htmlPart = mime.split("--BOUNDARY")[2] ?? "";
		const htmlB64 = htmlPart.split("\r\n\r\n")[1]?.trim() ?? "";
		expect(htmlB64.split("\r\n").every((l) => l.length <= 76)).toBe(true);
		expect(decode(htmlB64)).toBe(reply.html);
		const textB64 =
			(mime.split("--BOUNDARY")[1] ?? "").split("\r\n\r\n")[1]?.trim() ?? "";
		expect(decode(textB64)).toBe("Hi Ann,\njust checking in. Ça va?");
	});

	it("folds long non-ASCII subjects into short encoded words", () => {
		const long = `Re: ${"Grüße aus München ".repeat(8)}`;
		const encoded = encodeHeaderText(long);
		const words = encoded.split("\r\n ");
		expect(words.length).toBeGreaterThan(1);
		for (const w of words) expect(w.length).toBeLessThanOrEqual(75);
		const joined = words
			.map((w) => decode(/=\?UTF-8\?B\?([^?]+)\?=/.exec(w)?.[1] ?? ""))
			.join("");
		expect(joined).toBe(long.trim());
		expect(encodeHeaderText("Re: plain")).toBe("Re: plain");
	});

	it("strips header injection and quotes names", () => {
		const mime = buildReplyMime({
			...reply,
			subject: "Hi\r\nBcc: evil@x.com",
			to: [{ email: "a@x.com\r\nBcc: evil@x.com", name: 'Ann "The" Lee' }],
			cc: [],
		});
		expect(mime).not.toMatch(/\r\nBcc:/);
		expect(formatAddress({ email: "a@x.com", name: 'Ann "The" Lee' })).toBe(
			'"Ann \\"The\\" Lee" <a@x.com>',
		);
		expect(formatAddress({ email: "a@x.com" })).toBe("a@x.com");
	});

	it("encodes the Gmail raw field as base64url", () => {
		const raw = toGmailRaw(buildReplyMime(reply));
		expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(new TextDecoder().decode(base64UrlDecode(raw))).toContain(
			"X-BET-Nudge-Id",
		);
	});
});

describe("Gmail thread inspection", () => {
	const h = (name: string, value: string) => ({ name, value });
	const thread = {
		id: "t1",
		messages: [
			{
				id: "1",
				labelIds: ["SENT"],
				internalDate: "1000",
				payload: {
					headers: [
						h("From", "Me <alias@me.com>"),
						h("Message-ID", "<orig@x>"),
					],
				},
			},
			{
				id: "2",
				labelIds: ["INBOX"],
				internalDate: "2000",
				payload: {
					headers: [
						h("From", "Ann <ann@x.com>"),
						h("Auto-Submitted", "auto-replied"),
						h("Message-ID", "<ooo@x>"),
					],
				},
			},
			{
				id: "3",
				labelIds: ["DRAFT"],
				internalDate: "2500",
				payload: { headers: [h("From", "me@me.com")] },
			},
			{
				id: "4",
				labelIds: ["SENT"],
				internalDate: "3000",
				payload: {
					headers: [
						h("From", "me@me.com"),
						h("Message-ID", "<n1@x>"),
						h("References", "<orig@x> <ooo@x>"),
						h("X-BET-Nudge-Id", "nudgeA"),
					],
				},
			},
		],
	};

	it("ignores own, draft and automatic messages and finds markers", () => {
		const r = inspectGmailThread(thread, 500, "me@me.com");
		expect(r.reply).toBeNull();
		expect(r.bounced).toBe(false);
		expect(r.sentMarkers).toEqual(["nudgeA"]);
		expect(r.threading).toEqual({
			inReplyTo: "<n1@x>",
			references: ["<orig@x>", "<ooo@x>"],
		});
	});

	it("detects a reply after `since` and bounces", () => {
		const withReply = {
			...thread,
			messages: [
				...thread.messages,
				{
					id: "5",
					labelIds: ["INBOX"],
					internalDate: "4000",
					payload: { headers: [h("From", "Bob <BOB@x.com>")] },
				},
				{
					id: "6",
					internalDate: "4500",
					payload: {
						headers: [h("From", "Mail Delivery <mailer-daemon@g.com>")],
					},
				},
			],
		};
		const r = inspectGmailThread(withReply, 500, "me@me.com");
		expect(r.reply).toEqual({ at: 4000, from: "bob@x.com" });
		expect(r.bounced).toBe(true);
		expect(inspectGmailThread(withReply, 5000, "me@me.com").reply).toBeNull();
		expect(addressOf("plain@x.com")).toBe("plain@x.com");
	});
});

describe("crypto", () => {
	it("round-trips sealed tokens and rejects the wrong key", async () => {
		const sealed = await encryptSecret("1//refresh-token", KEY);
		expect(sealed).toMatch(/^v1\./);
		expect(sealed).not.toContain("refresh");
		expect(await encryptSecret("1//refresh-token", KEY)).not.toBe(sealed);
		expect(await decryptSecret(sealed, KEY)).toBe("1//refresh-token");
		await expect(decryptSecret(sealed, "other-key")).rejects.toThrow();
		await expect(encryptSecret("x", "")).rejects.toThrow(/TOKEN_ENC_KEY/);
	});

	it("signs and verifies OAuth state", async () => {
		const state = await signState(
			{ k: "google", exp: T0 + 1000, n: "n1" },
			KEY,
		);
		expect(await verifyState(state, KEY, T0)).toMatchObject({ k: "google" });
		expect(await verifyState(state, KEY, T0 + 2000)).toBeNull(); // expired
		expect(await verifyState(state, "wrong", T0)).toBeNull();
		const [body, sig] = state.split(".");
		const forged = `${btoa(JSON.stringify({ k: "google", exp: T0 + 9e9, n: "x" }))}.${sig}`;
		expect(await verifyState(forged, KEY, T0)).toBeNull();
		expect(await verifyState(`${body}.`, KEY, T0)).toBeNull();
		expect(await verifyState("garbage", KEY, T0)).toBeNull();
	});
});

/** Records requests and answers like Google's token, revoke and Gmail endpoints. */
function mockGoogle() {
	const calls: { url: string; method: string; body: string }[] = [];
	const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const body = typeof init?.body === "string" ? init.body : "";
		calls.push({ url, method: init?.method ?? "GET", body });
		const json = (v: unknown, status = 200) =>
			new Response(JSON.stringify(v), {
				status,
				headers: { "Content-Type": "application/json" },
			});
		if (url === GOOGLE_TOKEN_URL) {
			const form = new URLSearchParams(body);
			if (form.get("grant_type") === "authorization_code") {
				if (form.get("code") !== "good-code")
					return json({ error: "invalid_grant" }, 400);
				return json({
					access_token: "at-1",
					refresh_token: "rt-secret",
					expires_in: 3599,
					scope: "gmail.send gmail.metadata",
				});
			}
			return json({ access_token: "at-refreshed", expires_in: 3599 });
		}
		if (url.startsWith("https://oauth2.googleapis.com/revoke"))
			return new Response("", { status: 200 });
		if (url.endsWith("/users/me/profile"))
			return json({ emailAddress: "me@gmail.com" });
		if (url.includes("/users/me/threads/"))
			return json({ id: "t1", messages: [] });
		if (url.endsWith("/users/me/messages/send"))
			return json({ id: "m-new", threadId: "t1" });
		return json({ error: "unexpected" }, 404);
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe("Google OAuth connector", () => {
	const env = {
		GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com",
		GOOGLE_CLIENT_SECRET: "csecret",
		TOKEN_ENC_KEY: KEY,
	};

	function oauthSetup(withSecrets = true) {
		const nudges = new MemoryNudgeStore();
		const google = mockGoogle();
		const module = createNudgesModule({
			nudgeStore: () => nudges,
			fetch: google.fetchImpl,
		});
		const s = setup((withSecrets ? env : {}) as Partial<NudgeEnv>, [
			apiModule,
			module,
		]);
		return { s, nudges, google };
	}

	it("starts the consent flow with offline access and the narrow scopes", async () => {
		const { s } = oauthSetup();
		const res = await s.request("/api/connectors/google/start", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const url = new URL(((await res.json()) as StartConnectorResponse).url);
		expect(url.origin + url.pathname).toBe(
			"https://accounts.google.com/o/oauth2/v2/auth",
		);
		const p = url.searchParams;
		expect(p.get("client_id")).toBe(env.GOOGLE_CLIENT_ID);
		expect(p.get("redirect_uri")).toBe(
			"https://t.example.com/oauth/google/callback",
		);
		expect(p.get("scope")?.split(" ").sort()).toEqual([
			"https://www.googleapis.com/auth/gmail.metadata",
			"https://www.googleapis.com/auth/gmail.send",
		]);
		expect(p.get("access_type")).toBe("offline");
		expect(p.get("prompt")).toBe("consent");
		expect(p.get("response_type")).toBe("code");
		expect(await verifyState(p.get("state") ?? "", KEY, T0)).toMatchObject({
			k: "google",
		});
		// Bearer auth applies.
		expect(
			(
				await s.request("/api/connectors/google/start", {
					method: "POST",
					auth: false,
				})
			).status,
		).toBe(401);
	});

	it("is unavailable without server secrets", async () => {
		const { s } = oauthSetup(false);
		expect(
			(await s.request("/api/connectors/google/start", { method: "POST" }))
				.status,
		).toBe(503);
		const status = (await (
			await s.request("/api/connectors/status")
		).json()) as ConnectorStatusResponse;
		expect(status.connectors[0]).toMatchObject({
			kind: "google",
			configured: false,
			connected: false,
		});
	});

	it("exchanges the code, stores the refresh token encrypted, and disconnects", async () => {
		const { s, nudges, google } = oauthSetup();
		const start = (await (
			await s.request("/api/connectors/google/start", { method: "POST" })
		).json()) as StartConnectorResponse;
		const state = new URL(start.url).searchParams.get("state") ?? "";

		// Bad state and bad code are refused.
		const forged = await s.request(
			"/oauth/google/callback?code=good-code&state=forged.sig",
		);
		expect(forged.status).toBe(400);
		const denied = await s.request(
			"/oauth/google/callback?error=access_denied",
		);
		expect(denied.status).toBe(400);
		expect(await denied.text()).toContain("access_denied");

		const res = await s.request(
			`/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("me@gmail.com");
		const tokenCall = google.calls.find((c) => c.url === GOOGLE_TOKEN_URL);
		const form = new URLSearchParams(tokenCall?.body);
		expect(form.get("redirect_uri")).toBe(
			"https://t.example.com/oauth/google/callback",
		);
		expect(form.get("client_secret")).toBe("csecret");

		const record = await nudges.getConnector("google");
		expect(record?.email).toBe("me@gmail.com");
		expect(record?.refreshTokenEnc).not.toContain("rt-secret");
		expect(await decryptSecret(record?.refreshTokenEnc ?? "", KEY)).toBe(
			"rt-secret",
		);

		const status = (await (
			await s.request("/api/connectors/status")
		).json()) as ConnectorStatusResponse;
		expect(status.connectors[0]).toMatchObject({
			configured: true,
			connected: true,
			email: "me@gmail.com",
			connectedAt: T0,
		});

		// The state expires.
		s.clock.now = T0 + 11 * 60_000;
		expect(
			(
				await s.request(
					`/oauth/google/callback?code=good-code&state=${encodeURIComponent(state)}`,
				)
			).status,
		).toBe(400);

		const del = await s.request("/api/connectors/google", { method: "DELETE" });
		expect(await del.json()).toEqual({ ok: true, revoked: true });
		const revoke = google.calls.find((c) => c.url.includes("/revoke"));
		expect(new URLSearchParams(revoke?.body).get("token")).toBe("rt-secret");
		expect(await nudges.getConnector("google")).toBeNull();
	});

	it("refreshes the access token on demand and calls Gmail", async () => {
		const google = mockGoogle();
		let now = T0;
		const connector = await resolveConnector({
			env: { ...env } as never,
			record: {
				kind: "google",
				email: "me@gmail.com",
				refreshTokenEnc: await encryptSecret("rt-secret", KEY),
				scopes: "",
				connectedAt: T0,
			},
			fetch: google.fetchImpl,
			now: () => now,
		});
		expect(connector).toBeInstanceOf(GmailConnector);
		await connector.findReplies({ threadId: "t1" }, T0, "me@gmail.com");
		await connector.sendReply(
			{ threadId: "t1" },
			{
				from: "me@gmail.com",
				to: [{ email: "a@x.com" }],
				subject: "Re: Hi",
				html: "<p>Hi</p>",
				references: [],
				markerId: "m1",
			},
		);
		const refreshes = google.calls.filter((c) => c.url === GOOGLE_TOKEN_URL);
		expect(refreshes).toHaveLength(1);
		expect(new URLSearchParams(refreshes[0]?.body).get("refresh_token")).toBe(
			"rt-secret",
		);
		const threadCall = google.calls.find((c) => c.url.includes("/threads/"));
		const tu = new URL(threadCall?.url ?? "");
		expect(tu.pathname).toBe("/gmail/v1/users/me/threads/t1");
		expect(tu.searchParams.get("format")).toBe("metadata");
		expect(tu.searchParams.getAll("metadataHeaders")).toContain("Message-ID");
		const send = google.calls.find((c) => c.url.endsWith("/messages/send"));
		const sendBody = JSON.parse(send?.body ?? "{}") as {
			raw: string;
			threadId: string;
		};
		expect(sendBody.threadId).toBe("t1");
		expect(new TextDecoder().decode(base64UrlDecode(sendBody.raw))).toContain(
			"Subject: Re: Hi",
		);
		// After expiry the token is refreshed again.
		now = T0 + 3_600_000;
		await connector.findReplies({ threadId: "t1" }, T0, "me@gmail.com");
		expect(google.calls.filter((c) => c.url === GOOGLE_TOKEN_URL)).toHaveLength(
			2,
		);
	});
});
