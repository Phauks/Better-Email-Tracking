import type { CampaignRecipientState, CampaignStatus } from "@bet/shared";
import {
	type CampaignStore,
	emptyCounts,
	type NewCampaign,
	type NewRecipient,
	type RecipientPatch,
	type StateCounts,
	type StoredCampaign,
	type StoredRecipient,
} from "./store";

/** In-memory CampaignStore for tests. Not for production. */
export class MemoryCampaignStore implements CampaignStore {
	readonly campaigns = new Map<string, StoredCampaign>();
	readonly recipientRows = new Map<string, StoredRecipient[]>();

	async create(c: NewCampaign, recipients: NewRecipient[]): Promise<void> {
		if (this.campaigns.has(c.id)) throw new Error("campaign exists");
		this.campaigns.set(c.id, { ...c });
		this.recipientRows.set(
			c.id,
			recipients.map((r) => ({ ...r, campaignId: c.id })),
		);
	}

	async get(id: string): Promise<StoredCampaign | null> {
		const c = this.campaigns.get(id);
		return c ? { ...c } : null;
	}

	async list(
		limit: number,
		status?: CampaignStatus,
	): Promise<StoredCampaign[]> {
		return [...this.campaigns.values()]
			.filter((c) => !status || c.status === status)
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, limit)
			.map((c) => ({ ...c }));
	}

	async recipients(id: string): Promise<StoredRecipient[]> {
		return (this.recipientRows.get(id) ?? [])
			.map((r) => ({ ...r, fields: { ...r.fields } }))
			.sort((a, b) => a.position - b.position);
	}

	async getRecipient(
		id: string,
		email: string,
	): Promise<StoredRecipient | null> {
		const r = this.find(id, email);
		return r ? { ...r } : null;
	}

	async counts(ids: string[]) {
		const out = new Map<string, { states: StateCounts; lastSentAt?: number }>();
		for (const id of ids) {
			const states = emptyCounts();
			let lastSentAt: number | undefined;
			for (const r of this.recipientRows.get(id) ?? []) {
				states[r.state]++;
				if (r.sentAt !== undefined && (lastSentAt ?? 0) < r.sentAt)
					lastSentAt = r.sentAt;
			}
			out.set(
				id,
				lastSentAt === undefined ? { states } : { states, lastSentAt },
			);
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
		const c = this.campaigns.get(id);
		if (!c || !from.includes(c.status)) return false;
		c.status = status;
		c.updatedAt = now;
		if (status === "paused" && pauseReason) c.pauseReason = pauseReason;
		else delete c.pauseReason;
		return true;
	}

	async updateRecipient(
		id: string,
		email: string,
		from: CampaignRecipientState[],
		patch: RecipientPatch,
		now: number,
	): Promise<boolean> {
		const r = this.find(id, email);
		if (!r || !from.includes(r.state)) return false;
		r.state = patch.state;
		r.updatedAt = now;
		applyOptional(r, "messageId", patch.messageId);
		applyOptional(r, "error", patch.error);
		applyOptional(r, "sentAt", patch.sentAt);
		const c = this.campaigns.get(id);
		if (c) c.updatedAt = now;
		return true;
	}

	async moveRecipients(
		id: string,
		from: CampaignRecipientState[],
		to: CampaignRecipientState,
		now: number,
		error?: string,
	): Promise<number> {
		let n = 0;
		for (const r of this.recipientRows.get(id) ?? []) {
			if (!from.includes(r.state)) continue;
			r.state = to;
			r.updatedAt = now;
			if (to === "queued") {
				delete r.messageId;
				delete r.error;
			} else if (error) r.error = error;
			n++;
		}
		return n;
	}

	async acquireLease(
		id: string,
		runnerId: string,
		until: number,
		now: number,
	): Promise<boolean> {
		const c = this.campaigns.get(id);
		if (!c) return false;
		const free =
			!c.runnerId || c.runnerId === runnerId || (c.leaseUntil ?? 0) <= now;
		if (!free) return false;
		c.runnerId = runnerId;
		c.leaseUntil = until;
		return true;
	}

	async delete(id: string): Promise<boolean> {
		this.recipientRows.delete(id);
		return this.campaigns.delete(id);
	}

	async purgeBefore(cutoff: number): Promise<number> {
		let n = 0;
		for (const c of [...this.campaigns.values()]) {
			if (c.updatedAt < cutoff) {
				await this.delete(c.id);
				n++;
			}
		}
		return n;
	}

	private find(id: string, email: string): StoredRecipient | undefined {
		const key = email.toLowerCase();
		return this.recipientRows.get(id)?.find((r) => r.email === key);
	}
}

function applyOptional<K extends "messageId" | "error" | "sentAt">(
	r: StoredRecipient,
	key: K,
	value: StoredRecipient[K] | null | undefined,
): void {
	if (value === undefined) return;
	if (value === null) delete r[key];
	else r[key] = value as StoredRecipient[K];
}
