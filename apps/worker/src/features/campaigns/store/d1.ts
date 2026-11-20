import {
	type CampaignFollowUp,
	type CampaignRecipientState,
	type CampaignSettings,
	type CampaignStatus,
	DEFAULT_CAMPAIGN_SETTINGS,
} from "@bet/shared";
import { chunks, likeContains, parseJson, placeholders } from "../../../lib/d1";
import {
	type CampaignListQuery,
	type CampaignStore,
	emptyCounts,
	type NewCampaign,
	type NewRecipient,
	type RecipientPageQuery,
	type RecipientPatch,
	type StateCounts,
	type StoredCampaign,
	type StoredRecipient,
} from "./types";

interface CampaignRow {
	id: string;
	name: string;
	provider: string;
	subject_template: string;
	body_template: string;
	status: string;
	pause_reason: string | null;
	settings: string;
	total: number;
	created_at: number;
	updated_at: number;
	runner_id: string | null;
	lease_until: number | null;
	follow_up?: string | null;
}

interface RecipientRow {
	campaign_id: string;
	position: number;
	email: string;
	name: string | null;
	fields: string;
	state: string;
	message_id: string | null;
	error: string | null;
	sent_at: number | null;
	updated_at: number;
}

const isObjectJson = (v: unknown) => typeof v === "object" && v !== null;

function toCampaign(row: CampaignRow): StoredCampaign {
	const c: StoredCampaign = {
		id: row.id,
		name: row.name,
		provider: row.provider,
		subjectTemplate: row.subject_template,
		bodyTemplate: row.body_template,
		status: row.status as CampaignStatus,
		settings: {
			...DEFAULT_CAMPAIGN_SETTINGS,
			...parseJson<Partial<CampaignSettings>>(row.settings, {}, isObjectJson),
		},
		total: row.total,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
	if (row.pause_reason) c.pauseReason = row.pause_reason;
	const followUp = parseJson<CampaignFollowUp | null>(
		row.follow_up ?? null,
		null,
		(v) => isObjectJson(v) && Array.isArray((v as CampaignFollowUp).steps),
	);
	if (followUp) c.followUp = followUp;
	if (row.runner_id) c.runnerId = row.runner_id;
	if (row.lease_until !== null) c.leaseUntil = row.lease_until;
	return c;
}

function toRecipient(row: RecipientRow): StoredRecipient {
	const r: StoredRecipient = {
		campaignId: row.campaign_id,
		position: row.position,
		email: row.email,
		fields: parseJson<Record<string, string>>(row.fields, {}, isObjectJson),
		state: row.state as CampaignRecipientState,
		updatedAt: row.updated_at,
	};
	if (row.name) r.name = row.name;
	if (row.message_id) r.messageId = row.message_id;
	if (row.error) r.error = row.error;
	if (row.sent_at !== null) r.sentAt = row.sent_at;
	return r;
}

const RECIPIENT_COLS = 9;
/** D1 allows 100 bound parameters per statement. */
const ROWS_PER_INSERT = Math.floor(100 / RECIPIENT_COLS);

export class D1CampaignStore implements CampaignStore {
	constructor(private readonly db: D1Database) {}

	async create(c: NewCampaign, recipients: NewRecipient[]): Promise<void> {
		const stmts: D1PreparedStatement[] = [
			this.db
				.prepare(
					`INSERT INTO campaigns (id, name, provider, subject_template, body_template, status, pause_reason, settings, follow_up, total, created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					c.id,
					c.name,
					c.provider,
					c.subjectTemplate,
					c.bodyTemplate,
					c.status,
					c.pauseReason ?? null,
					JSON.stringify(c.settings),
					c.followUp ? JSON.stringify(c.followUp) : null,
					c.total,
					c.createdAt,
					c.updatedAt,
				),
		];
		for (let i = 0; i < recipients.length; i += ROWS_PER_INSERT) {
			const part = recipients.slice(i, i + ROWS_PER_INSERT);
			const values = part
				.map(() => `(${placeholders(RECIPIENT_COLS)})`)
				.join(",");
			stmts.push(
				this.db
					.prepare(
						`INSERT INTO campaign_recipients (campaign_id, position, email, name, fields, state, error, sent_at, updated_at) VALUES ${values}`,
					)
					.bind(
						...part.flatMap((r) => [
							c.id,
							r.position,
							r.email,
							r.name ?? null,
							JSON.stringify(r.fields),
							r.state,
							r.error ?? null,
							r.sentAt ?? null,
							r.updatedAt,
						]),
					),
			);
		}
		await this.db.batch(stmts);
	}

	async get(id: string): Promise<StoredCampaign | null> {
		const row = await this.db
			.prepare("SELECT * FROM campaigns WHERE id = ?")
			.bind(id)
			.first<CampaignRow>();
		return row ? toCampaign(row) : null;
	}

	async list(query: CampaignListQuery): Promise<StoredCampaign[]> {
		const where: string[] = [];
		const args: unknown[] = [];
		if (query.status) {
			where.push("status = ?");
			args.push(query.status);
		}
		if (query.after) {
			where.push("(created_at, id) < (?, ?)");
			args.push(query.after.createdAt, query.after.id);
		}
		const { results } = await this.db
			.prepare(
				`SELECT * FROM campaigns ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
				 ORDER BY created_at DESC, id DESC LIMIT ?`,
			)
			.bind(...args, query.limit)
			.all<CampaignRow>();
		return results.map(toCampaign);
	}

	async recipients(
		id: string,
		query: RecipientPageQuery,
	): Promise<StoredRecipient[]> {
		const where = ["campaign_id = ?"];
		const args: unknown[] = [id];
		if (query.states?.length) {
			where.push(`state IN (${placeholders(query.states.length)})`);
			args.push(...query.states);
		}
		if (query.afterPosition !== undefined) {
			where.push("position > ?");
			args.push(query.afterPosition);
		}
		if (query.q) {
			const like = likeContains(query.q);
			where.push("(email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')");
			args.push(like, like);
		}
		const { results } = await this.db
			.prepare(
				`SELECT * FROM campaign_recipients WHERE ${where.join(" AND ")}
				 ORDER BY position LIMIT ?`,
			)
			.bind(...args, query.limit)
			.all<RecipientRow>();
		return results.map(toRecipient);
	}

	async setFollowUp(
		id: string,
		followUp: CampaignFollowUp | null,
		now: number,
	): Promise<boolean> {
		const res = await this.db
			.prepare(
				"UPDATE campaigns SET follow_up = ?, updated_at = ? WHERE id = ?",
			)
			.bind(followUp ? JSON.stringify(followUp) : null, now, id)
			.run();
		return res.meta.changes > 0;
	}

	async getRecipient(
		id: string,
		email: string,
	): Promise<StoredRecipient | null> {
		const row = await this.db
			.prepare(
				"SELECT * FROM campaign_recipients WHERE campaign_id = ? AND email = ?",
			)
			.bind(id, email.toLowerCase())
			.first<RecipientRow>();
		return row ? toRecipient(row) : null;
	}

	async counts(ids: string[]) {
		const out = new Map<string, { states: StateCounts; lastSentAt?: number }>();
		for (const id of ids) out.set(id, { states: emptyCounts() });
		for (const part of chunks(ids)) {
			const { results } = await this.db
				.prepare(
					`SELECT campaign_id, state, COUNT(*) AS n, MAX(sent_at) AS last_sent
					 FROM campaign_recipients WHERE campaign_id IN (${placeholders(part.length)})
					 GROUP BY campaign_id, state`,
				)
				.bind(...part)
				.all<{
					campaign_id: string;
					state: CampaignRecipientState;
					n: number;
					last_sent: number | null;
				}>();
			for (const r of results) {
				const entry = out.get(r.campaign_id);
				if (!entry || !(r.state in entry.states)) continue;
				entry.states[r.state] = r.n;
				if (r.last_sent !== null && (entry.lastSentAt ?? 0) < r.last_sent)
					entry.lastSentAt = r.last_sent;
			}
		}
		return out;
	}

	async setStatus(
		id: string,
		status: CampaignStatus,
		from: CampaignStatus[],
		now: number,
		pauseReason?: string,
	): Promise<boolean> {
		const res = await this.db
			.prepare(
				`UPDATE campaigns SET status = ?, pause_reason = ?, updated_at = ?
				 WHERE id = ? AND status IN (${placeholders(from.length)})`,
			)
			.bind(
				status,
				status === "paused" ? (pauseReason ?? null) : null,
				now,
				id,
				...from,
			)
			.run();
		return res.meta.changes > 0;
	}

	async updateRecipient(
		id: string,
		email: string,
		from: CampaignRecipientState[],
		patch: RecipientPatch,
		now: number,
	): Promise<boolean> {
		const sets = ["state = ?", "updated_at = ?"];
		const args: unknown[] = [patch.state, now];
		for (const [col, value] of [
			["message_id", patch.messageId],
			["error", patch.error],
			["sent_at", patch.sentAt],
		] as const) {
			if (value === undefined) continue;
			sets.push(`${col} = ?`);
			args.push(value);
		}
		const [res] = await this.db.batch([
			this.db
				.prepare(
					`UPDATE campaign_recipients SET ${sets.join(", ")}
					 WHERE campaign_id = ? AND email = ? AND state IN (${placeholders(from.length)})`,
				)
				.bind(...args, id, email.toLowerCase(), ...from),
			this.db
				.prepare("UPDATE campaigns SET updated_at = ? WHERE id = ?")
				.bind(now, id),
		]);
		return (res?.meta.changes ?? 0) > 0;
	}

	async moveRecipients(
		id: string,
		from: CampaignRecipientState[],
		to: CampaignRecipientState,
		now: number,
		error?: string,
	): Promise<number> {
		const clear =
			to === "queued"
				? ", message_id = NULL, error = NULL"
				: error
					? ", error = ?"
					: "";
		const res = await this.db
			.prepare(
				`UPDATE campaign_recipients SET state = ?, updated_at = ?${clear}
				 WHERE campaign_id = ? AND state IN (${placeholders(from.length)})`,
			)
			.bind(to, now, ...(to !== "queued" && error ? [error] : []), id, ...from)
			.run();
		return res.meta.changes;
	}

	async acquireLease(
		id: string,
		runnerId: string,
		until: number,
		now: number,
	): Promise<boolean> {
		const res = await this.db
			.prepare(
				`UPDATE campaigns SET runner_id = ?, lease_until = ?
				 WHERE id = ? AND (runner_id IS NULL OR runner_id = ? OR lease_until IS NULL OR lease_until <= ?)`,
			)
			.bind(runnerId, until, id, runnerId, now)
			.run();
		return res.meta.changes > 0;
	}

	async delete(id: string): Promise<boolean> {
		const results = await this.db.batch([
			this.db
				.prepare("DELETE FROM campaign_recipients WHERE campaign_id = ?")
				.bind(id),
			this.db.prepare("DELETE FROM campaigns WHERE id = ?").bind(id),
		]);
		return (results[1]?.meta.changes ?? 0) > 0;
	}

	async purgeBefore(cutoff: number): Promise<number> {
		const results = await this.db.batch([
			this.db
				.prepare(
					"DELETE FROM campaign_recipients WHERE campaign_id IN (SELECT id FROM campaigns WHERE updated_at < ?)",
				)
				.bind(cutoff),
			this.db
				.prepare("DELETE FROM campaigns WHERE updated_at < ?")
				.bind(cutoff),
		]);
		return results[1]?.meta.changes ?? 0;
	}
}
