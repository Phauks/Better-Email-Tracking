import type {
	NudgeHistoryItem,
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
	limit: number;
	state?: NudgeState;
	messageId?: string;
}

/**
 * Persistence for nudge sequences, their history and mailbox connectors. Kept apart
 * from the core Store so the feature stays self-contained (D1 in production,
 * memory in tests).
 */
export interface NudgeStore {
	insertSequence(seq: StoredSequence): Promise<void>;
	getSequence(id: string): Promise<StoredSequence | null>;
	/** Newest first. */
	listSequences(query: SequenceQuery): Promise<StoredSequence[]>;
	/** Active or paused sequences for a message. */
	openSequencesForMessage(messageId: string): Promise<StoredSequence[]>;
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
