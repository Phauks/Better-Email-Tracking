import type { TrackerApi } from "../features/types";
import { callBackground } from "../messaging";

/** TrackerApi for content scripts: every call goes through the background worker. */
export const backgroundApi: TrackerApi = {
	async register(req) {
		await callBackground({ type: "bet:register", req });
	},
	async markSent(id, req) {
		await callBackground({ type: "bet:markSent", id, req });
	},
	threadStatus(threadIds) {
		return callBackground({ type: "bet:threadStatus", threadIds });
	},
	async ownerViews(messageIds) {
		await callBackground({ type: "bet:ownerViews", messageIds });
	},
};
