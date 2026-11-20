import { ApiError } from "../api/client";
import type {
	CreateNudgeResult,
	NudgeBgRequest,
	NudgeBgResponseMap,
} from "../features/follow-up/messages";
import type { Handlers } from "../lib/channel";
import { workerApi as api } from "./api";

/** Background handlers for follow-up nudges; spread into listenForBgRequests. */
export const nudgeHandlers: Handlers<NudgeBgRequest, NudgeBgResponseMap> = {
	"bet:createNudge": async ({ req }): Promise<CreateNudgeResult> => {
		try {
			const { sequence } = await (await api()).createNudge(req);
			return { ok: true, sequence };
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			if (err instanceof ApiError && err.status === 409) {
				const { code } = err;
				if (code === "no_connector" || code === "no_thread")
					return { ok: false, code, error };
			}
			return { ok: false, code: "error", error };
		}
	},
	"bet:connectorStatus": async () => (await api()).connectorStatus(),
	"bet:openOptions": async () => {
		await chrome.runtime.openOptionsPage();
		return null;
	},
};
