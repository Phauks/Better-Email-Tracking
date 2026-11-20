import type { RegisterMessageRequest } from "@bet/shared";
import { base64ToBytes } from "../lib/documents";
import type { BgHandlers } from "../messaging";
import { workerApi } from "./api";

/** Background handlers for tracked documents; spread into listenForBgRequests. */
export const documentHandlers: Pick<BgHandlers, "bet:docUpload"> = {
	"bet:docUpload": async ({ name, mime, dataBase64 }) =>
		(await workerApi()).uploadDocument(name, mime, base64ToBytes(dataBase64)),
};

/**
 * Records which documents a registered message links to, for "sent, not viewed
 * yet". Best effort: views are attributed by the link itself either way, so a
 * failure here must not make the send fall back to untracked.
 */
export async function attachDocumentsAfterRegister(
	req: RegisterMessageRequest,
): Promise<void> {
	if (!req.documents?.length) return;
	try {
		await (await workerApi()).attachDocuments({
			messageId: req.id,
			documentIds: req.documents,
		});
	} catch (err) {
		console.warn("[bet] attaching documents failed", err);
	}
}
