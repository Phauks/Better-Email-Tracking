import { ApiError } from "../api/client";
import type {
	CreateNudgeResult,
	NudgeBgRequest,
	NudgeBgResponseMap,
} from "../features/follow-up/messages";
import { loadSettings } from "../settings";
import { apiFromSettings } from "./feed";

type Handlers = {
	[T in NudgeBgRequest["type"]]: (
		msg: Extract<NudgeBgRequest, { type: T }>,
	) => Promise<NudgeBgResponseMap[T]>;
};

const api = async () => apiFromSettings(await loadSettings());

/** Background handlers for follow-up nudges; spread into listenForBgRequests. */
export const nudgeHandlers: Handlers = {
	"bet:createNudge": async ({ req }): Promise<CreateNudgeResult> => {
		try {
			const { sequence } = await (await api()).createNudge(req);
			return { ok: true, sequence };
		} catch (err) {
			const error = err instanceof Error ? err.message : String(err);
			if (err instanceof ApiError && err.status === 409) {
				const code = /"code":"(no_connector|no_thread)"/.exec(error)?.[1];
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
