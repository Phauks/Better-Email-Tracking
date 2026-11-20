import {
	type ConnectorStatusResponse,
	escapeHtml,
	isValidId,
	type ListNudgesResponse,
	NUDGE_API,
	type NudgeHistoryItem,
	type NudgeResponse,
	type NudgeSequence,
	type NudgeState,
	newId,
	type StartConnectorResponse,
} from "@bet/shared";
import { type Context, Hono } from "hono";
import {
	exchangeCode,
	type FetchLike,
	type GoogleOAuthConfig,
	gmailProfileEmail,
	googleAuthUrl,
	revokeToken,
} from "../connectors/google-oauth";
import { DAY } from "../env";
import {
	decryptSecret,
	encryptSecret,
	signState,
	verifyState,
} from "../lib/crypto";
import { intParam } from "../lib/validate";
import type { StoredMessage } from "../store/types";
import type { AppEnv } from "../types";
import { googleConfigured, type NudgeEnv, nudgeEnv } from "./env";
import { nextAllowed } from "./schedule";
import type { NudgeStore, StoredSequence } from "./store/types";
import { parseCreateNudge, parseUpdateNudge } from "./validate";

export interface RouteDeps {
	nudgeStore(env: NudgeEnv): NudgeStore;
	fetch: FetchLike;
}

type Ctx = Context<AppEnv>;

const STATE_TTL_MS = 10 * 60_000;
const STATES: NudgeState[] = [
	"active",
	"paused",
	"replied",
	"opened",
	"done",
	"cancelled",
	"failed",
];

async function readJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return undefined;
	}
}

export function toApiSequence(
	s: StoredSequence,
	msg: StoredMessage | undefined,
	history: NudgeHistoryItem[],
): NudgeSequence {
	const out: NudgeSequence = {
		id: s.id,
		messageId: s.messageId,
		connector: s.connector,
		providerThreadId: s.providerThreadId,
		state: s.state,
		steps: s.steps,
		nextStep: s.nextStep,
		stopOnOpen: s.stopOnOpen,
		createdAt: s.createdAt,
		updatedAt: s.updatedAt,
		attempts: s.attempts,
		subject: msg?.subject ?? "",
		recipients: s.to.length ? [...s.to, ...s.cc] : (msg?.recipients ?? []),
		history,
	};
	if (s.nextAt !== undefined) out.nextAt = s.nextAt;
	if (s.sendWindow) out.sendWindow = s.sendWindow;
	if (s.lastError) out.lastError = s.lastError;
	return out;
}

function googleOAuthConfig(c: Ctx): GoogleOAuthConfig | null {
	const env = nudgeEnv(c.env);
	if (!googleConfigured(env)) return null;
	return {
		clientId: env.GOOGLE_CLIENT_ID as string,
		clientSecret: env.GOOGLE_CLIENT_SECRET as string,
		redirectUri:
			env.GOOGLE_REDIRECT_URI ||
			`${new URL(c.req.url).origin}${NUDGE_API.oauthCallback("google")}`,
	};
}

function resultPage(c: Ctx, ok: boolean, text: string, status = 200) {
	const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${ok ? "Connected" : "Not connected"}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 16px;color:#1f2328}h1{font-size:20px}.bad{color:#c5221f}</style>
<h1 class="${ok ? "" : "bad"}">${ok ? "Gmail connected" : "Couldn't connect Gmail"}</h1><p>${escapeHtml(text)}</p><p>You can close this tab.</p>`;
	return c.html(html, status as 200, {
		"Cache-Control": "no-store",
		"Referrer-Policy": "no-referrer",
	});
}

/** /api/nudges, /api/connectors (behind bearer auth) and the public OAuth callback. */
export function createNudgeRoutes(deps: RouteDeps) {
	const api = new Hono<AppEnv>();
	const oauth = new Hono<AppEnv>();
	const nudgesOf = (c: Ctx) => deps.nudgeStore(nudgeEnv(c.env));

	async function present(
		c: Ctx,
		seqs: StoredSequence[],
	): Promise<NudgeSequence[]> {
		const [messages, history] = await Promise.all([
			c.var.store.getMessagesByIds([...new Set(seqs.map((s) => s.messageId))]),
			nudgesOf(c).getHistory(seqs.map((s) => s.id)),
		]);
		const byId = new Map(messages.map((m) => [m.id, m]));
		return seqs.map((s) =>
			toApiSequence(s, byId.get(s.messageId), history.get(s.id) ?? []),
		);
	}

	api.post("/nudges", async (c) => {
		const parsed = parseCreateNudge(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const input = parsed.value;
		const { store } = c.var;
		const nudges = nudgesOf(c);
		const msg = await store.getMessage(input.messageId);
		if (!msg) return c.json({ error: "message not found" }, 404);
		const threadId = msg.providerThreadId ?? input.providerThreadId;
		if (!threadId)
			return c.json(
				{ error: "The email has no thread id yet", code: "no_thread" },
				409,
			);
		if (!(await nudges.getConnector("google")))
			return c.json(
				{
					error: "Connect Gmail in the extension options to send follow-ups",
					code: "no_connector",
				},
				409,
			);
		const now = c.var.now();
		const open = await nudges.openSequencesForMessage(msg.id);
		if (open.length > 0) {
			if (!input.replace) {
				const [existing] = await present(c, open.slice(0, 1));
				return c.json({ sequence: existing } as NudgeResponse);
			}
			for (const s of open) {
				await nudges.updateSequence(
					s.id,
					{ state: "cancelled", nextAt: null, updatedAt: now },
					{ states: ["active", "paused"] },
				);
				await nudges.addHistory(s.id, {
					at: now,
					kind: "cancelled",
					detail: "replaced",
				});
			}
		}
		const sentAt = msg.sentAt ?? input.sentAt ?? now;
		const first = input.steps[0]?.afterDays ?? 0;
		const seq: StoredSequence = {
			id: newId(),
			messageId: msg.id,
			connector: "google",
			providerThreadId: threadId,
			to: input.to ?? [],
			cc: input.cc ?? [],
			state: "active",
			steps: input.steps,
			nextStep: 0,
			nextAt: nextAllowed(sentAt + first * DAY, input.sendWindow),
			stopOnOpen: input.stopOnOpen,
			trackerBase: new URL(c.req.url).origin,
			createdAt: now,
			updatedAt: now,
			attempts: 0,
		};
		if (input.sendWindow) seq.sendWindow = input.sendWindow;
		await nudges.insertSequence(seq);
		await nudges.addHistory(seq.id, { at: now, kind: "created" });
		const [sequence] = await present(c, [seq]);
		return c.json({ sequence } as NudgeResponse, 201);
	});

	api.get("/nudges", async (c) => {
		const state = c.req.query("state") as NudgeState | undefined;
		const messageId = c.req.query("messageId");
		const seqs = await nudgesOf(c).listSequences({
			limit: intParam(c.req.query("limit"), 100, 1, 500),
			...(state && STATES.includes(state) ? { state } : {}),
			...(messageId && isValidId(messageId) ? { messageId } : {}),
		});
		const body: ListNudgesResponse = { sequences: await present(c, seqs) };
		return c.json(body);
	});

	api.get("/nudges/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const seq = await nudgesOf(c).getSequence(id);
		if (!seq) return c.json({ error: "not found" }, 404);
		const [sequence] = await present(c, [seq]);
		return c.json({ sequence } as NudgeResponse);
	});

	api.patch("/nudges/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const parsed = parseUpdateNudge(await readJson(c.req.raw));
		if (!parsed.ok) return c.json({ error: parsed.error }, 400);
		const nudges = nudgesOf(c);
		const seq = await nudges.getSequence(id);
		if (!seq) return c.json({ error: "not found" }, 404);
		const now = c.var.now();
		const { action, steps, stopOnOpen, sendWindow } = parsed.value;
		if (steps && steps.length < seq.nextStep)
			return c.json(
				{ error: "can't remove nudges that were already sent" },
				400,
			);
		const patch: Parameters<NudgeStore["updateSequence"]>[1] = {
			updatedAt: now,
		};
		if (action === "pause") patch.state = "paused";
		if (action === "resume") {
			patch.state = "active";
			patch.attempts = 0;
			patch.nextAt = Math.max(seq.nextAt ?? now, now);
		}
		if (steps) patch.steps = steps;
		if (stopOnOpen !== undefined) patch.stopOnOpen = stopOnOpen;
		if (sendWindow !== undefined) patch.sendWindow = sendWindow;
		const allowed: NudgeState[] =
			action === "pause"
				? ["active"]
				: action === "resume"
					? ["paused"]
					: ["active", "paused"];
		const ok = await nudges.updateSequence(id, patch, { states: allowed });
		if (!ok)
			return c.json({ error: `can't change a ${seq.state} follow-up` }, 409);
		if (action)
			await nudges.addHistory(id, {
				at: now,
				kind: action === "pause" ? "paused" : "resumed",
			});
		const [sequence] = await present(c, [
			(await nudges.getSequence(id)) as StoredSequence,
		]);
		return c.json({ sequence } as NudgeResponse);
	});

	api.delete("/nudges/:id", async (c) => {
		const id = c.req.param("id");
		if (!isValidId(id)) return c.json({ error: "invalid id" }, 400);
		const nudges = nudgesOf(c);
		const seq = await nudges.getSequence(id);
		if (!seq) return c.json({ error: "not found" }, 404);
		const now = c.var.now();
		const ok = await nudges.updateSequence(
			id,
			{ state: "cancelled", nextAt: null, updatedAt: now },
			{ states: ["active", "paused"] },
		);
		if (ok) await nudges.addHistory(id, { at: now, kind: "cancelled" });
		const [sequence] = await present(c, [
			(await nudges.getSequence(id)) as StoredSequence,
		]);
		return c.json({ sequence } as NudgeResponse);
	});

	api.get("/connectors/status", async (c) => {
		const env = nudgeEnv(c.env);
		const record = await nudgesOf(c).getConnector("google");
		const body: ConnectorStatusResponse = {
			connectors: [
				{
					kind: "google",
					configured: googleConfigured(env),
					connected: record !== null,
					...(record
						? { email: record.email, connectedAt: record.connectedAt }
						: {}),
				},
			],
		};
		return c.json(body);
	});

	api.post("/connectors/google/start", async (c) => {
		const cfg = googleOAuthConfig(c);
		if (!cfg)
			return c.json(
				{
					error:
						"Gmail connection isn't set up on the server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and TOKEN_ENC_KEY.",
				},
				503,
			);
		const state = await signState(
			{ k: "google", exp: c.var.now() + STATE_TTL_MS, n: newId() },
			nudgeEnv(c.env).TOKEN_ENC_KEY as string,
		);
		const body: StartConnectorResponse = { url: googleAuthUrl(cfg, state) };
		return c.json(body);
	});

	api.delete("/connectors/google", async (c) => {
		const nudges = nudgesOf(c);
		const record = await nudges.getConnector("google");
		if (!record) return c.json({ ok: true, revoked: false });
		let revoked = false;
		const key = nudgeEnv(c.env).TOKEN_ENC_KEY;
		if (key) {
			try {
				const token = await decryptSecret(record.refreshTokenEnc, key);
				revoked = await revokeToken(token, deps.fetch);
			} catch (err) {
				console.warn("revoke failed", err);
			}
		}
		await nudges.deleteConnector("google");
		return c.json({ ok: true, revoked });
	});

	oauth.get("/google/callback", async (c) => {
		const cfg = googleOAuthConfig(c);
		if (!cfg) return resultPage(c, false, "The server isn't configured.", 503);
		const error = c.req.query("error");
		if (error) return resultPage(c, false, `Google said: ${error}.`, 400);
		const code = c.req.query("code");
		const state = c.req.query("state");
		const key = nudgeEnv(c.env).TOKEN_ENC_KEY as string;
		const now = c.var.now();
		const payload = state ? await verifyState(state, key, now) : null;
		if (!code || !payload || payload.k !== "google")
			return resultPage(
				c,
				false,
				"This link expired or wasn't started from your extension. Start again from the extension options.",
				400,
			);
		try {
			const tokens = await exchangeCode(cfg, code, deps.fetch, now);
			if (!tokens.refreshToken)
				return resultPage(
					c,
					false,
					"Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and try again.",
					400,
				);
			const email = await gmailProfileEmail(deps.fetch, tokens.accessToken);
			await nudgesOf(c).saveConnector({
				kind: "google",
				email,
				refreshTokenEnc: await encryptSecret(tokens.refreshToken, key),
				scopes: tokens.scope,
				connectedAt: now,
			});
			return resultPage(c, true, `Follow-ups will be sent from ${email}.`);
		} catch (err) {
			console.error("oauth callback", err);
			return resultPage(
				c,
				false,
				`Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
				502,
			);
		}
	});

	return { api, oauth };
}
