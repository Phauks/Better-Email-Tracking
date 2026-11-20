import type {
	NudgeHistoryItem,
	NudgeHistoryKind,
	NudgeState,
	NudgeStep,
	Recipient,
	SendWindow,
} from "@bet/shared";
import { NUDGE_FINAL_STATES } from "@bet/shared";
import type { ConnectorRecord } from "../../../connectors/types";
import { chunks, parseJson, placeholders } from "../../../lib/d1";
import {
	GROUP_ACTIONS,
	type GroupAction,
	type GroupSequenceStats,
	type NudgeStore,
	type PendingSend,
	type SequenceGuard,
	type SequencePatch,
	type SequenceQuery,
	type StoredSequence,
} from "./types";

interface SequenceRow {
	id: string;
	message_id: string;
	connector: string;
	provider_thread_id: string;
	addressees: string;
	state: string;
	steps: string;
	next_step: number;
	next_at: number | null;
	stop_on_open: number;
	send_window: string | null;
	tracker_base: string;
	created_at: number;
	updated_at: number;
	attempts: number;
	last_error: string | null;
	lock_until: number | null;
	lock_token: string | null;
	pending_send: string | null;
	group_id?: string | null;
	fields?: string | null;
}

interface HistoryRow {
	sequence_id: string;
	at: number;
	kind: string;
	step: number | null;
	nudge_message_id: string | null;
	detail: string | null;
}

interface ConnectorRow {
	kind: string;
	email: string;
	refresh_token_enc: string;
	scopes: string;
	connected_at: number;
}

function toSequence(r: SequenceRow): StoredSequence {
	const addressees = parseJson<{ to?: Recipient[]; cc?: Recipient[] }>(
		r.addressees,
		{},
	);
	const s: StoredSequence = {
		id: r.id,
		messageId: r.message_id,
		connector: r.connector,
		providerThreadId: r.provider_thread_id,
		to: addressees.to ?? [],
		cc: addressees.cc ?? [],
		state: r.state as NudgeState,
		steps: parseJson<NudgeStep[]>(r.steps, []),
		nextStep: r.next_step,
		stopOnOpen: r.stop_on_open === 1,
		trackerBase: r.tracker_base,
		createdAt: r.created_at,
		updatedAt: r.updated_at,
		attempts: r.attempts,
	};
	if (r.next_at !== null) s.nextAt = r.next_at;
	const win = parseJson<SendWindow | null>(r.send_window, null);
	if (win) s.sendWindow = win;
	if (r.last_error) s.lastError = r.last_error;
	if (r.lock_until !== null) s.lockUntil = r.lock_until;
	if (r.lock_token) s.lockToken = r.lock_token;
	const pending = parseJson<PendingSend | null>(r.pending_send, null);
	if (pending) s.pendingSend = pending;
	if (r.group_id) s.groupId = r.group_id;
	const fields = parseJson<Record<string, string> | null>(
		r.fields ?? null,
		null,
		(v) => typeof v === "object" && v !== null && !Array.isArray(v),
	);
	if (fields) s.fields = fields;
	return s;
}

/** Patch field → [column, encoder]. */
const COLUMNS: Record<
	Exclude<keyof SequencePatch, never>,
	[string, (v: unknown) => unknown]
> = {
	state: ["state", (v) => v],
	steps: ["steps", (v) => JSON.stringify(v)],
	nextStep: ["next_step", (v) => v],
	nextAt: ["next_at", (v) => v],
	stopOnOpen: ["stop_on_open", (v) => (v ? 1 : 0)],
	sendWindow: ["send_window", (v) => JSON.stringify(v)],
	attempts: ["attempts", (v) => v],
	lastError: ["last_error", (v) => v],
	lockUntil: ["lock_until", (v) => v],
	lockToken: ["lock_token", (v) => v],
	pendingSend: ["pending_send", (v) => JSON.stringify(v)],
	updatedAt: ["updated_at", (v) => v],
};

const FINAL = NUDGE_FINAL_STATES.map((s) => `'${s}'`).join(",");

export class D1NudgeStore implements NudgeStore {
	constructor(private readonly db: D1Database) {}

	async insertSequence(s: StoredSequence): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO nudge_sequences (id, message_id, connector, provider_thread_id, addressees, state, steps, next_step,
				   next_at, stop_on_open, send_window, tracker_base, created_at, updated_at, attempts, group_id, fields)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				s.id,
				s.messageId,
				s.connector,
				s.providerThreadId,
				JSON.stringify({ to: s.to, cc: s.cc }),
				s.state,
				JSON.stringify(s.steps),
				s.nextStep,
				s.nextAt ?? null,
				s.stopOnOpen ? 1 : 0,
				s.sendWindow ? JSON.stringify(s.sendWindow) : null,
				s.trackerBase,
				s.createdAt,
				s.updatedAt,
				s.attempts,
				s.groupId ?? null,
				s.fields ? JSON.stringify(s.fields) : null,
			)
			.run();
	}

	async getSequence(id: string): Promise<StoredSequence | null> {
		const row = await this.db
			.prepare("SELECT * FROM nudge_sequences WHERE id = ?")
			.bind(id)
			.first<SequenceRow>();
		return row ? toSequence(row) : null;
	}

	async listSequences(q: SequenceQuery): Promise<StoredSequence[]> {
		const where: string[] = [];
		const args: unknown[] = [];
		if (q.state) {
			where.push("state = ?");
			args.push(q.state);
		}
		if (q.messageId) {
			where.push("message_id = ?");
			args.push(q.messageId);
		}
		if (q.groupId) {
			where.push("group_id = ?");
			args.push(q.groupId);
		}
		if (q.after) {
			where.push("(created_at, id) < (?, ?)");
			args.push(q.after.createdAt, q.after.id);
		}
		const sql = `SELECT * FROM nudge_sequences ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
		const { results } = await this.db
			.prepare(sql)
			.bind(...args, q.limit)
			.all<SequenceRow>();
		return results.map(toSequence);
	}

	async latestForMessages(
		messageIds: string[],
	): Promise<Map<string, StoredSequence>> {
		const out = new Map<string, StoredSequence>();
		for (const part of chunks([...new Set(messageIds)])) {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM nudge_sequences WHERE message_id IN (${placeholders(part.length)})
					 ORDER BY created_at DESC, id DESC`,
				)
				.bind(...part)
				.all<SequenceRow>();
			for (const r of results)
				if (!out.has(r.message_id)) out.set(r.message_id, toSequence(r));
		}
		return out;
	}

	async groupStats(groupId: string): Promise<GroupSequenceStats> {
		const { results } = await this.db
			.prepare(
				`SELECT state, COUNT(*) AS n, SUM(next_step) AS sent
				 FROM nudge_sequences WHERE group_id = ? GROUP BY state`,
			)
			.bind(groupId)
			.all<{ state: NudgeState; n: number; sent: number | null }>();
		const stats: GroupSequenceStats = {
			sequences: 0,
			states: {},
			nudgesSent: 0,
		};
		for (const r of results) {
			stats.sequences += r.n;
			stats.states[r.state] = r.n;
			stats.nudgesSent += r.sent ?? 0;
		}
		return stats;
	}

	async updateGroup(
		groupId: string,
		action: GroupAction,
		now: number,
	): Promise<number> {
		const rule = GROUP_ACTIONS[action];
		const from = placeholders(rule.from.length);
		const extra =
			action === "cancel"
				? ", next_at = NULL"
				: action === "resume"
					? ", attempts = 0, next_at = MAX(COALESCE(next_at, ?1), ?1)"
					: "";
		// History first: it selects the rows the update is about to change.
		const res = await this.db.batch([
			this.db
				.prepare(
					`INSERT INTO nudge_history (sequence_id, at, kind)
					 SELECT id, ?1, ?2 FROM nudge_sequences WHERE group_id = ?3 AND state IN (${from})`,
				)
				.bind(now, rule.history, groupId, ...rule.from),
			this.db
				.prepare(
					`UPDATE nudge_sequences SET state = ?2, updated_at = ?1${extra}
					 WHERE group_id = ?3 AND state IN (${from})`,
				)
				.bind(now, rule.to, groupId, ...rule.from),
		]);
		return res[1]?.meta.changes ?? 0;
	}

	async openSequencesForMessage(messageId: string): Promise<StoredSequence[]> {
		const { results } = await this.db
			.prepare(
				"SELECT * FROM nudge_sequences WHERE message_id = ? AND state IN ('active', 'paused')",
			)
			.bind(messageId)
			.all<SequenceRow>();
		return results.map(toSequence);
	}

	async claimDue(
		now: number,
		leaseMs: number,
		limit: number,
		token: string,
	): Promise<StoredSequence[]> {
		const { results } = await this.db
			.prepare(
				`SELECT id FROM nudge_sequences
				 WHERE state = 'active' AND next_at <= ? AND (lock_until IS NULL OR lock_until < ?)
				 ORDER BY next_at LIMIT ?`,
			)
			.bind(now, now, limit)
			.all<{ id: string }>();
		if (results.length === 0) return [];
		// The conditional UPDATE is the lock: only one run can flip an expired lease.
		const claim = this.db.prepare(
			`UPDATE nudge_sequences SET lock_until = ?, lock_token = ?
			 WHERE id = ? AND state = 'active' AND next_at <= ? AND (lock_until IS NULL OR lock_until < ?)`,
		);
		const outcomes = await this.db.batch(
			results.map((r) => claim.bind(now + leaseMs, token, r.id, now, now)),
		);
		const claimed = results
			.filter((_, i) => (outcomes[i]?.meta.changes ?? 0) > 0)
			.map((r) => r.id);
		if (claimed.length === 0) return [];
		const { results: rows } = await this.db
			.prepare(
				`SELECT * FROM nudge_sequences WHERE lock_token = ? AND id IN (${placeholders(claimed.length)})`,
			)
			.bind(token, ...claimed)
			.all<SequenceRow>();
		return rows.map(toSequence);
	}

	async updateSequence(
		id: string,
		patch: SequencePatch,
		guard: SequenceGuard = {},
	): Promise<boolean> {
		const sets: string[] = [];
		const args: unknown[] = [];
		for (const [key, value] of Object.entries(patch)) {
			if (value === undefined) continue;
			const col = COLUMNS[key as keyof SequencePatch];
			if (!col) continue;
			sets.push(`${col[0]} = ?`);
			args.push(value === null ? null : col[1](value));
		}
		const where = ["id = ?"];
		args.push(id);
		if (guard.lockToken !== undefined) {
			where.push("lock_token = ?");
			args.push(guard.lockToken);
		}
		if (guard.states?.length) {
			where.push(`state IN (${guard.states.map(() => "?").join(",")})`);
			args.push(...guard.states);
		}
		const res = await this.db
			.prepare(
				`UPDATE nudge_sequences SET ${sets.join(", ")} WHERE ${where.join(" AND ")}`,
			)
			.bind(...args)
			.run();
		return res.meta.changes > 0;
	}

	async addHistory(
		sequenceId: string,
		item: NudgeHistoryItem,
	): Promise<boolean> {
		const res = await this.db
			.prepare(
				`INSERT OR IGNORE INTO nudge_history (sequence_id, at, kind, step, nudge_message_id, detail)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				sequenceId,
				item.at,
				item.kind,
				item.step ?? null,
				item.nudgeMessageId ?? null,
				item.detail ?? null,
			)
			.run();
		return res.meta.changes > 0;
	}

	async getHistory(
		sequenceIds: string[],
	): Promise<Map<string, NudgeHistoryItem[]>> {
		const map = new Map<string, NudgeHistoryItem[]>();
		for (const part of chunks([...new Set(sequenceIds)])) {
			const { results } = await this.db
				.prepare(
					`SELECT * FROM nudge_history WHERE sequence_id IN (${placeholders(part.length)}) ORDER BY id`,
				)
				.bind(...part)
				.all<HistoryRow>();
			for (const r of results) {
				const item: NudgeHistoryItem = {
					at: r.at,
					kind: r.kind as NudgeHistoryKind,
				};
				if (r.step !== null) item.step = r.step;
				if (r.nudge_message_id) item.nudgeMessageId = r.nudge_message_id;
				if (r.detail) item.detail = r.detail;
				const list = map.get(r.sequence_id) ?? [];
				list.push(item);
				map.set(r.sequence_id, list);
			}
		}
		return map;
	}

	async purgeFinishedBefore(cutoff: number): Promise<number> {
		const old = `SELECT id FROM nudge_sequences WHERE state IN (${FINAL}) AND updated_at < ?1`;
		const results = await this.db.batch([
			this.db
				.prepare(`DELETE FROM nudge_history WHERE sequence_id IN (${old})`)
				.bind(cutoff),
			this.db
				.prepare(
					`DELETE FROM nudge_sequences WHERE state IN (${FINAL}) AND updated_at < ?1`,
				)
				.bind(cutoff),
		]);
		return results[1]?.meta.changes ?? 0;
	}

	async getConnector(kind: string): Promise<ConnectorRecord | null> {
		const row = await this.db
			.prepare("SELECT * FROM mail_connectors WHERE kind = ?")
			.bind(kind)
			.first<ConnectorRow>();
		return row
			? {
					kind: row.kind,
					email: row.email,
					refreshTokenEnc: row.refresh_token_enc,
					scopes: row.scopes,
					connectedAt: row.connected_at,
				}
			: null;
	}

	async saveConnector(r: ConnectorRecord): Promise<void> {
		await this.db
			.prepare(
				`INSERT INTO mail_connectors (kind, email, refresh_token_enc, scopes, connected_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(kind) DO UPDATE SET email = excluded.email,
				   refresh_token_enc = excluded.refresh_token_enc, scopes = excluded.scopes,
				   connected_at = excluded.connected_at`,
			)
			.bind(r.kind, r.email, r.refreshTokenEnc, r.scopes, r.connectedAt)
			.run();
	}

	async deleteConnector(kind: string): Promise<boolean> {
		const res = await this.db
			.prepare("DELETE FROM mail_connectors WHERE kind = ?")
			.bind(kind)
			.run();
		return res.meta.changes > 0;
	}
}
