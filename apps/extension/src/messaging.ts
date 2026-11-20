import type {
	MarkSentRequest,
	RegisterMessageRequest,
	ThreadStatusResponse,
} from "@bet/shared";
import type {
	DocumentBgRequest,
	DocumentBgResponseMap,
} from "./features/documents/messages";
import type {
	NudgeBgRequest,
	NudgeBgResponseMap,
} from "./features/follow-up/messages";
import { createChannel, type Handlers } from "./lib/channel";

/**
 * Typed messages from content scripts and pages to the background service worker.
 * Content scripts never call the Worker directly: the background holds the token and
 * host permission, and the mail client's page CSP does not apply there.
 *
 * A feature with its own background calls declares them in features/<name>/messages.ts
 * and adds them to the unions below; its handlers live in background/<name>.ts.
 * (Mail merge uses its own channel, see features/mail-merge/messages.ts.)
 */
type CoreBgRequest =
	| { type: "bet:register"; req: RegisterMessageRequest }
	| { type: "bet:markSent"; id: string; req: MarkSentRequest }
	| { type: "bet:threadStatus"; threadIds: string[] }
	| { type: "bet:ownerViews"; messageIds: string[] }
	| { type: "bet:pollNow" }
	| { type: "bet:markSeen" };

interface CoreBgResponseMap {
	"bet:register": null;
	"bet:markSent": null;
	"bet:threadStatus": ThreadStatusResponse;
	"bet:ownerViews": null;
	"bet:pollNow": null;
	"bet:markSeen": null;
}

export type BgRequest = CoreBgRequest | DocumentBgRequest | NudgeBgRequest;
export interface BgResponseMap
	extends CoreBgResponseMap,
		DocumentBgResponseMap,
		NudgeBgResponseMap {}

export type BgHandlers = Handlers<BgRequest, BgResponseMap>;

const background = createChannel<BgRequest, BgResponseMap>((type) =>
	type.startsWith("bet:"),
);

export const callBackground = background.call;
export const listenForBgRequests = background.listen;
