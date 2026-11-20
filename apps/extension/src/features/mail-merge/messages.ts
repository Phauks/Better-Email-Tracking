import type {
	CampaignDetail,
	CampaignLeaseRequest,
	CampaignStatus,
	ListCampaignsResponse,
	RecipientResultRequest,
	UpdateCampaignRequest,
} from "@bet/shared";
import type { ResultOutcome } from "../../api/campaigns";

/**
 * Mail merge messaging, kept apart from the core "bet:" union so the feature stays
 * self-contained. Content script and dashboard -> background: MergeRequest.
 * Background -> mail tabs: MergeTabMessage.
 */
export type MergeRequest =
	| { type: "bet-merge:list"; status?: CampaignStatus }
	| { type: "bet-merge:get"; id: string }
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

export type MergeType = MergeRequest["type"];
export type MergeRequestOf<T extends MergeType> = Extract<
	MergeRequest,
	{ type: T }
>;
export type MergeHandlers = {
	[T in MergeType]: (msg: MergeRequestOf<T>) => Promise<MergeResponseMap[T]>;
};

export type MergeTabMessage = { type: "bet-merge:wake" };
export interface WakeResponse {
	ok: true;
	provider: string;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const PREFIX = "bet-merge:";

export function isMergeRequest(msg: unknown): msg is MergeRequest {
	return (
		typeof msg === "object" &&
		msg !== null &&
		typeof (msg as { type?: unknown }).type === "string" &&
		(msg as { type: string }).type.startsWith(PREFIX) &&
		(msg as { type: string }).type !== "bet-merge:wake"
	);
}

export function isWakeMessage(msg: unknown): msg is MergeTabMessage {
	return (
		typeof msg === "object" &&
		msg !== null &&
		(msg as { type?: unknown }).type === "bet-merge:wake"
	);
}

export async function callMerge<T extends MergeType>(
	msg: MergeRequestOf<T>,
): Promise<MergeResponseMap[T]> {
	const res = (await chrome.runtime.sendMessage(msg)) as
		| Result<MergeResponseMap[T]>
		| undefined;
	if (!res) throw new Error("No response from background");
	if (!res.ok) throw new Error(res.error);
	return res.data;
}

/** Background side. Returns true only for our messages so other listeners keep working. */
export function listenForMergeRequests(handlers: MergeHandlers): void {
	chrome.runtime.onMessage.addListener(
		(msg: unknown, _sender, sendResponse) => {
			if (!isMergeRequest(msg)) return false;
			const handler = handlers[msg.type] as (
				m: MergeRequest,
			) => Promise<unknown>;
			handler(msg).then(
				(data) => sendResponse({ ok: true, data: data ?? null }),
				(err: unknown) =>
					sendResponse({
						ok: false,
						error: err instanceof Error ? err.message : String(err),
					}),
			);
			return true;
		},
	);
}
