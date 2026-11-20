import {
	type NudgeStep,
	newId,
	type Recipient,
	type RecipientFollowUp,
	type SendWindow,
} from "@bet/shared";
import type { Store, StoredMessage } from "../../core/store/types";
import { DAY } from "../../env";
import { nextAllowed } from "./schedule";
import type {
	GroupAction,
	GroupSequenceStats,
	NudgeStore,
	StoredSequence,
} from "./store/types";

/** The only connector today; sequences record theirs so others can follow. */
export const DEFAULT_CONNECTOR = "google";

/** What to send and when: the part of a sequence its creator chooses. */
export interface SequenceSpec {
	steps: NudgeStep[];
	stopOnOpen: boolean;
	sendWindow?: SendWindow;
}

/** A fresh sequence for a sent message, first nudge due `steps[0].afterDays` after sentAt. */
export function newSequence(args: {
	message: StoredMessage;
	threadId: string;
	spec: SequenceSpec;
	to: Recipient[];
	cc: Recipient[];
	fields?: Record<string, string>;
	trackerBase: string;
	sentAt: number;
	now: number;
	paused?: boolean;
}): StoredSequence {
	const { message, spec, now } = args;
	const first = spec.steps[0]?.afterDays ?? 0;
	const seq: StoredSequence = {
		id: newId(),
		messageId: message.id,
		connector: DEFAULT_CONNECTOR,
		providerThreadId: args.threadId,
		to: args.to,
		cc: args.cc,
		state: args.paused ? "paused" : "active",
		steps: spec.steps,
		nextStep: 0,
		nextAt: nextAllowed(args.sentAt + first * DAY, spec.sendWindow),
		stopOnOpen: spec.stopOnOpen,
		trackerBase: args.trackerBase,
		createdAt: now,
		updatedAt: now,
		attempts: 0,
	};
	if (spec.sendWindow) seq.sendWindow = spec.sendWindow;
	if (message.groupId) seq.groupId = message.groupId;
	if (args.fields && Object.keys(args.fields).length) seq.fields = args.fields;
	return seq;
}

export interface StartFollowUp {
	messageId: string;
	/** Used when the message has no thread id yet (its markSent was lost). */
	providerThreadId?: string;
	spec: SequenceSpec;
	/** Create it paused (the owner paused the group's follow-ups). */
	paused?: boolean;
	/** Defaults to the message's recipients. */
	to?: Recipient[];
	/** Merge fields for the nudge text. */
	fields?: Record<string, string>;
	/** Origin of the Worker as the extension sees it (the nudge's own pixel). */
	trackerBase: string;
	now: number;
}

export type StartFollowUpResult =
	| { status: "created" | "exists"; sequenceId: string }
	| { status: "skipped"; reason: "no_message" | "no_thread" | "no_connector" };

/**
 * Follow-ups as a service for other features (mail merge). The interface is all a
 * caller sees; the nudge store stays private to this feature.
 */
export interface FollowUpService {
	/**
	 * Starts a sequence for a sent message. Idempotent: a message that already has a
	 * sequence (in any state) keeps it.
	 */
	start(input: StartFollowUp): Promise<StartFollowUpResult>;
	/** The newest sequence of each message, summarised. */
	forMessages(messageIds: string[]): Promise<Map<string, RecipientFollowUp>>;
	groupStats(groupId: string): Promise<GroupSequenceStats>;
	/** Pause, resume or cancel every sequence of a send group. Returns how many changed. */
	updateGroup(
		groupId: string,
		action: GroupAction,
		now: number,
	): Promise<number>;
}

export function toRecipientFollowUp(s: StoredSequence): RecipientFollowUp {
	const out: RecipientFollowUp = {
		sequenceId: s.id,
		state: s.state,
		sent: s.nextStep,
		steps: s.steps.length,
	};
	if (s.nextAt !== undefined && (s.state === "active" || s.state === "paused"))
		out.nextAt = s.nextAt;
	return out;
}

export function createFollowUpService(deps: {
	nudges: NudgeStore;
	store: Store;
}): FollowUpService {
	const { nudges, store } = deps;
	return {
		async start(input) {
			const [existing] = await nudges.listSequences({
				messageId: input.messageId,
				limit: 1,
			});
			if (existing) return { status: "exists", sequenceId: existing.id };
			const message = await store.getMessage(input.messageId);
			if (!message) return { status: "skipped", reason: "no_message" };
			const threadId = message.providerThreadId ?? input.providerThreadId;
			if (!threadId) return { status: "skipped", reason: "no_thread" };
			if (!(await nudges.getConnector(DEFAULT_CONNECTOR)))
				return { status: "skipped", reason: "no_connector" };
			const seq = newSequence({
				message,
				threadId,
				spec: input.spec,
				to: input.to ?? message.recipients,
				cc: [],
				...(input.fields ? { fields: input.fields } : {}),
				trackerBase: input.trackerBase,
				sentAt: message.sentAt ?? input.now,
				now: input.now,
				...(input.paused ? { paused: true } : {}),
			});
			await nudges.insertSequence(seq);
			await nudges.addHistory(seq.id, { at: input.now, kind: "created" });
			return { status: "created", sequenceId: seq.id };
		},
		async forMessages(messageIds) {
			const out = new Map<string, RecipientFollowUp>();
			for (const [id, s] of await nudges.latestForMessages(messageIds))
				out.set(id, toRecipientFollowUp(s));
			return out;
		},
		groupStats: (groupId) => nudges.groupStats(groupId),
		updateGroup: (groupId, action, now) =>
			nudges.updateGroup(groupId, action, now),
	};
}
