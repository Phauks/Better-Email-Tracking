import {
	NUDGE_FINAL_STATES,
	type NudgeHistoryItem,
	type NudgeState,
} from "@bet/shared";
import type { ConnectorRecord } from "../../../connectors/types";
import {
	GROUP_ACTIONS,
	type GroupAction,
	type GroupSequenceStats,
	type NudgeStore,
	type SequenceGuard,
	type SequencePatch,
	type SequenceQuery,
	type StoredSequence,
} from "./types";

const clone = <T>(v: T): T => structuredClone(v);

const newestFirst = (a: StoredSequence, b: StoredSequence) =>
	b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/** In-memory NudgeStore for tests. Mirrors the D1 semantics, including the lock. */
export class MemoryNudgeStore implements NudgeStore {
	readonly sequences = new Map<string, StoredSequence>();
	readonly history: (NudgeHistoryItem & { sequenceId: string })[] = [];
	readonly connectors = new Map<string, ConnectorRecord>();

	async insertSequence(seq: StoredSequence): Promise<void> {
		this.sequences.set(seq.id, clone(seq));
	}

	async getSequence(id: string): Promise<StoredSequence | null> {
		const s = this.sequences.get(id);
		return s ? clone(s) : null;
	}

	async listSequences(query: SequenceQuery): Promise<StoredSequence[]> {
		const after = query.after;
		return [...this.sequences.values()]
			.filter((s) => !query.state || s.state === query.state)
			.filter((s) => !query.messageId || s.messageId === query.messageId)
			.filter((s) => !query.groupId || s.groupId === query.groupId)
			.filter(
				(s) =>
					!after ||
					s.createdAt < after.createdAt ||
					(s.createdAt === after.createdAt && s.id < after.id),
			)
			.sort(newestFirst)
			.slice(0, query.limit)
			.map(clone);
	}

	async latestForMessages(
		messageIds: string[],
	): Promise<Map<string, StoredSequence>> {
		const ids = new Set(messageIds);
		const out = new Map<string, StoredSequence>();
		for (const s of [...this.sequences.values()].sort(newestFirst))
			if (ids.has(s.messageId) && !out.has(s.messageId))
				out.set(s.messageId, clone(s));
		return out;
	}

	async groupStats(groupId: string): Promise<GroupSequenceStats> {
		const stats: GroupSequenceStats = {
			sequences: 0,
			states: {},
			nudgesSent: 0,
		};
		for (const s of this.sequences.values()) {
			if (s.groupId !== groupId) continue;
			stats.sequences++;
			stats.states[s.state] = (stats.states[s.state] ?? 0) + 1;
			stats.nudgesSent += s.nextStep;
		}
		return stats;
	}

	async updateGroup(
		groupId: string,
		action: GroupAction,
		now: number,
	): Promise<number> {
		const rule = GROUP_ACTIONS[action];
		let n = 0;
		for (const s of this.sequences.values()) {
			if (s.groupId !== groupId || !rule.from.includes(s.state)) continue;
			s.state = rule.to;
			s.updatedAt = now;
			if (action === "cancel") delete s.nextAt;
			if (action === "resume") {
				s.attempts = 0;
				s.nextAt = Math.max(s.nextAt ?? now, now);
			}
			this.history.push({ sequenceId: s.id, at: now, kind: rule.history });
			n++;
		}
		return n;
	}

	async openSequencesForMessage(messageId: string): Promise<StoredSequence[]> {
		return [...this.sequences.values()]
			.filter(
				(s) =>
					s.messageId === messageId &&
					(s.state === "active" || s.state === "paused"),
			)
			.map(clone);
	}

	async claimDue(
		now: number,
		leaseMs: number,
		limit: number,
		token: string,
	): Promise<StoredSequence[]> {
		const due = [...this.sequences.values()]
			.filter(
				(s) =>
					s.state === "active" &&
					s.nextAt !== undefined &&
					s.nextAt <= now &&
					(s.lockUntil === undefined || s.lockUntil < now),
			)
			.sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))
			.slice(0, limit);
		for (const s of due) {
			s.lockUntil = now + leaseMs;
			s.lockToken = token;
		}
		return due.map(clone);
	}

	async updateSequence(
		id: string,
		patch: SequencePatch,
		guard: SequenceGuard = {},
	): Promise<boolean> {
		const s = this.sequences.get(id);
		if (!s) return false;
		if (guard.lockToken !== undefined && s.lockToken !== guard.lockToken)
			return false;
		if (guard.states && !guard.states.includes(s.state)) return false;
		const target = s as unknown as Record<string, unknown>;
		for (const [k, v] of Object.entries(patch)) {
			if (v === null || v === undefined) {
				if (v === null) delete target[k];
			} else target[k] = clone(v);
		}
		return true;
	}

	async addHistory(
		sequenceId: string,
		item: NudgeHistoryItem,
	): Promise<boolean> {
		if (
			item.kind === "sent" &&
			this.history.some(
				(h) =>
					h.sequenceId === sequenceId &&
					h.kind === "sent" &&
					h.step === item.step,
			)
		)
			return false;
		this.history.push({ ...clone(item), sequenceId });
		return true;
	}

	async getHistory(
		sequenceIds: string[],
	): Promise<Map<string, NudgeHistoryItem[]>> {
		const set = new Set(sequenceIds);
		const map = new Map<string, NudgeHistoryItem[]>();
		for (const { sequenceId, ...item } of this.history) {
			if (!set.has(sequenceId)) continue;
			const list = map.get(sequenceId) ?? [];
			list.push(item);
			map.set(sequenceId, list);
		}
		return map;
	}

	async purgeFinishedBefore(cutoff: number): Promise<number> {
		let n = 0;
		for (const [id, s] of this.sequences) {
			if (
				NUDGE_FINAL_STATES.includes(s.state as NudgeState) &&
				s.updatedAt < cutoff
			) {
				this.sequences.delete(id);
				for (let i = this.history.length - 1; i >= 0; i--)
					if (this.history[i]?.sequenceId === id) this.history.splice(i, 1);
				n++;
			}
		}
		return n;
	}

	async getConnector(kind: string): Promise<ConnectorRecord | null> {
		const r = this.connectors.get(kind);
		return r ? clone(r) : null;
	}

	async saveConnector(record: ConnectorRecord): Promise<void> {
		this.connectors.set(record.kind, clone(record));
	}

	async deleteConnector(kind: string): Promise<boolean> {
		return this.connectors.delete(kind);
	}
}
