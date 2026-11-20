import type {
	MarkSentRequest,
	RegisterMessageRequest,
	ThreadStatusResponse,
} from "@bet/shared";

/**
 * Typed messages from content scripts and pages to the background service worker.
 * Content scripts never call the Worker directly: the background holds the token and
 * host permission, and Gmail's page CSP does not apply there.
 */
export type BgRequest =
	| { type: "bet:register"; req: RegisterMessageRequest }
	| { type: "bet:markSent"; id: string; req: MarkSentRequest }
	| { type: "bet:threadStatus"; threadIds: string[] }
	| { type: "bet:ownerViews"; messageIds: string[] }
	| { type: "bet:pollNow" }
	| { type: "bet:markSeen" };

export interface BgResponseMap {
	"bet:register": null;
	"bet:markSent": null;
	"bet:threadStatus": ThreadStatusResponse;
	"bet:ownerViews": null;
	"bet:pollNow": null;
	"bet:markSeen": null;
}

export type BgType = BgRequest["type"];
export type BgRequestOf<T extends BgType> = Extract<BgRequest, { type: T }>;
export type BgResult<T extends BgType> =
	| { ok: true; data: BgResponseMap[T] }
	| { ok: false; error: string };

export type BgHandlers = {
	[T in BgType]: (msg: BgRequestOf<T>) => Promise<BgResponseMap[T]>;
};

export function isBgRequest(msg: unknown): msg is BgRequest {
	return (
		typeof msg === "object" &&
		msg !== null &&
		typeof (msg as { type?: unknown }).type === "string" &&
		(msg as { type: string }).type.startsWith("bet:")
	);
}

/** Sends a request to the background and unwraps the result (throws on error). */
export async function callBackground<T extends BgType>(
	msg: BgRequestOf<T>,
): Promise<BgResponseMap[T]> {
	const res = (await chrome.runtime.sendMessage(msg)) as
		| BgResult<T>
		| undefined;
	if (!res) throw new Error("No response from background");
	if (!res.ok) throw new Error(res.error);
	return res.data;
}

/**
 * Installs the background listener. Returns true only for our own messages so other
 * listeners (InboxSDK's pageWorld injector) keep working.
 */
export function listenForBgRequests(handlers: BgHandlers): void {
	chrome.runtime.onMessage.addListener(
		(msg: unknown, _sender, sendResponse) => {
			if (!isBgRequest(msg)) return false;
			const handler = handlers[msg.type] as (m: BgRequest) => Promise<unknown>;
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
