import type {
	NudgeHistoryItem,
	NudgeHistoryKind,
	NudgeState,
	NudgeStep,
	Recipient,
	SendWindow,
} from "@bet/shared";
import type { ConnectorRecord } from "../../../connectors/types";

/** Written just before a send so a retry can check the thread instead of sending twice. */
export interface PendingSend {
	step: number;
	nudgeMessageId: string;
	at: number;
}

export interface StoredSequence {
	id: string;
	messageId: string;
	/** The original message's groupId (a mail merge campaign's id). */
	groupId?: string;
	/** Merge fields of a mail merge copy, for {{field}} in the nudge text. */
	fields?: Record<string, string>;
	connector: string;
	providerThreadId: string;
	/** Who the nudges go to (visible To/CC of the original; BCC is never included). */
	to: Recipient[];
	cc: Recipient[];
	state: NudgeState;
	steps: NudgeStep[];
	nextStep: number;
	nextAt?: number;
	stopOnOpen: boolean;
	sendWindow?: SendWindow;
	/** Origin of the Worker as the extension sees it; used for the nudge's own pixel. */
	trackerBase: string;
	createdAt: number;
	updatedAt: number;
	attempts: number;
	lastError?: string;
	lockUntil?: number;
	lockToken?: string;
	pendingSend?: PendingSend;
}

type Nullable<T> = { [K in keyof T]?: T[K] | null };

export type SequencePatch = Nullable<
	Pick<
		StoredSequence,
		| "state"
		| "steps"
		| "nextStep"
		| "nextAt"
		| "stopOnOpen"
		| "sendWindow"
		| "attempts"
		| "lastError"
		| "lockUntil"
		| "lockToken"
		| "pendingSend"
	>
> & { updatedAt: number };

export interface SequenceGuard {
	/** Only update while this run still holds the lock. */
	lockToken?: string;
	/** Only update when the current state is one of these. */
	states?: NudgeState[];
}

export interface SequenceQuery {
	/** Rows to return (routes ask for one more to detect a next page). */
	limit: number;
	/** Keyset: strictly after this (createdAt, id) in newest-first order. */
	after?: { createdAt: number; id: string };
	state?: NudgeState;
	messageId?: string;
	groupId?: string;
}

/** Sequences of one group by state, and nudges sent across them. */
export interface GroupSequenceStats {
	sequences: number;
	states: Partial<Record<NudgeState, number>>;
	nudgesSent: number;
}

export type GroupAction = "pause" | "resume" | "cancel";

/**
 * What a group action does: which states it applies to, the new state and the history
 * entry. Resuming also resets attempts and moves a past nextAt to now; cancelling
 * clears nextAt.
 */
export const GROUP_ACTIONS: Record<
	GroupAction,
	{ from: NudgeState[]; to: NudgeState; history: NudgeHistoryKind }
> = {
	pause: { from: ["active"], to: "paused", history: "paused" },
	resume: { from: ["paused"], to: "active", history: "resumed" },
	cancel: { from: ["active", "paused"], to: "cancelled", history: "cancelled" },
};

/**
 * Persistence for nudge sequences, their history and mailbox connectors. Kept apart
 * from the core Store so the feature stays self-contained (D1 in production,
 * memory in tests).
 */
export interface NudgeStore {
	insertSequence(seq: StoredSequence): Promise<void>;
	getSequence(id: string): Promise<StoredSequence | null>;
	/** Newest first by (createdAt, id). */
	listSequences(query: SequenceQuery): Promise<StoredSequence[]>;
	/** Active or paused sequences for a message. */
	openSequencesForMessage(messageId: string): Promise<StoredSequence[]>;
	/** The newest sequence of each message, if any. */
	latestForMessages(messageIds: string[]): Promise<Map<string, StoredSequence>>;
	groupStats(groupId: string): Promise<GroupSequenceStats>;
	/**
	 * Pauses (active), resumes (paused) or cancels (active or paused) every sequence of
	 * a group, with a history entry each. Returns how many changed.
	 */
	updateGroup(
		groupId: string,
		action: GroupAction,
		now: number,
	): Promise<number>;
	/**
	 * Locks up to `limit` active sequences due at `now` (conditional update, so two
	 * overlapping runs never claim the same one). Returns the claimed rows.
	 */
	claimDue(
		now: number,
		leaseMs: number,
		limit: number,
		token: string,
	): Promise<StoredSequence[]>;
	/** Returns false if the guard didn't match (lock lost, state changed, missing). */
	updateSequence(
		id: string,
		patch: SequencePatch,
		guard?: SequenceGuard,
	): Promise<boolean>;

	/** Returns false for a duplicate "sent" entry of the same step (idempotency guard). */
	addHistory(sequenceId: string, item: NudgeHistoryItem): Promise<boolean>;
	getHistory(sequenceIds: string[]): Promise<Map<string, NudgeHistoryItem[]>>;

	/** Deletes finished sequences (and their history) last updated before cutoff. */
	purgeFinishedBefore(cutoff: number): Promise<number>;

	getConnector(kind: string): Promise<ConnectorRecord | null>;
	saveConnector(record: ConnectorRecord): Promise<void>;
	deleteConnector(kind: string): Promise<boolean>;
}
