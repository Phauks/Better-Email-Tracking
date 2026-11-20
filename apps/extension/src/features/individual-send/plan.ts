import type { Recipient } from "@bet/shared";
import {
	allRecipients,
	type RecipientSet,
	uniqueRecipients,
} from "../../lib/recipients";

export type SharedReason =
	| "single_recipient"
	| "reply"
	| "attachments"
	| "attachments_unknown";

export interface CopyPlan {
	id: string;
	recipient: Recipient;
}

export type IndividualSendPlan =
	| { kind: "shared"; reason: SharedReason }
	| { kind: "split"; groupId: string; copies: CopyPlan[] };

export interface PlanInput {
	recipients: RecipientSet;
	/** undefined = the provider couldn't tell. */
	hasAttachments: boolean | undefined;
	isReply: boolean;
}

/**
 * Decides whether "Track each recipient" can split this email into one copy per
 * recipient. To, CC and BCC all become separate emails addressed To that person.
 * We don't split replies (copies would leave the thread) or anything with attachments
 * (copies can't carry them), including when we can't tell.
 */
export function planIndividualSend(
	input: PlanInput,
	makeId: () => string,
): IndividualSendPlan {
	const recipients = uniqueRecipients(allRecipients(input.recipients));
	if (recipients.length <= 1)
		return { kind: "shared", reason: "single_recipient" };
	if (input.isReply) return { kind: "shared", reason: "reply" };
	if (input.hasAttachments === true)
		return { kind: "shared", reason: "attachments" };
	if (input.hasAttachments === undefined)
		return { kind: "shared", reason: "attachments_unknown" };
	return {
		kind: "split",
		groupId: makeId(),
		copies: recipients.map((recipient) => ({ id: makeId(), recipient })),
	};
}

export const SHARED_REASON_NOTICE: Record<SharedReason, string | null> = {
	single_recipient: null,
	reply:
		"Replies can't be split per recipient, so this one uses shared tracking.",
	attachments:
		"Emails with attachments can't be split per recipient, so this one uses shared tracking.",
	attachments_unknown:
		"Couldn't confirm this email has no attachments, so it was sent once with shared tracking.",
};
