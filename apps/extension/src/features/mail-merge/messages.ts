import type {
	CampaignDetail,
	CampaignLeaseRequest,
	CampaignStatus,
	ListCampaignsResponse,
	RecipientQuery,
	RecipientResultRequest,
	UpdateCampaignRequest,
} from "@bet/shared";
import type { ResultOutcome } from "../../api/client";
import { createChannel } from "../../lib/channel";

/**
 * Mail merge messaging, kept apart from the core "bet:" union so the feature stays
 * self-contained. Content script and dashboard -> background: MergeRequest.
 * Background -> mail tabs: MergeTabMessage.
 */
export type MergeRequest =
	| { type: "bet-merge:list"; status?: CampaignStatus }
	| { type: "bet-merge:get"; id: string; query?: RecipientQuery }
	| { type: "bet-merge:lease"; id: string; req: CampaignLeaseRequest }
	| {
			type: "bet-merge:result";
			id: string;
			email: string;
			req: RecipientResultRequest;
	  }
	| { type: "bet-merge:update"; id: string; req: UpdateCampaignRequest }
	/** From the dashboard: wake the mail tabs so one starts sending. */
	| { type: "bet-merge:dispatch" };

export interface MergeResponseMap {
	"bet-merge:list": ListCampaignsResponse;
	"bet-merge:get": CampaignDetail;
	"bet-merge:lease": boolean;
	"bet-merge:result": ResultOutcome;
	"bet-merge:update": CampaignDetail;
	/** Number of mail tabs that answered. */
	"bet-merge:dispatch": { tabs: number };
}

export type MergeTabMessage = { type: "bet-merge:wake" };
export interface WakeResponse {
	ok: true;
	provider: string;
}

const WAKE = "bet-merge:wake";

const merge = createChannel<MergeRequest, MergeResponseMap>(
	(type) => type.startsWith("bet-merge:") && type !== WAKE,
);

export const callMerge = merge.call;
/** Background side. */
export const listenForMergeRequests = merge.listen;

/** Background -> mail tab: start sending if a campaign is waiting. */
export function isWakeMessage(msg: unknown): msg is MergeTabMessage {
	return (
		typeof msg === "object" &&
		msg !== null &&
		(msg as { type?: unknown }).type === WAKE
	);
}
