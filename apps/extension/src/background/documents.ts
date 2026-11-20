import type { RegisterMessageRequest } from "@bet/shared";
import { DocumentsClient } from "../api/documents";
import { base64ToBytes } from "../lib/documents";
import type { BgHandlers } from "../messaging";
import { loadSettings } from "../settings";

async function client(): Promise<DocumentsClient> {
	const s = await loadSettings();
	return new DocumentsClient(s.workerUrl, s.apiToken);
}

/** Background side of tracked documents: uploads and message links. */
export const documentHandlers = {
	upload: (async ({ name, mime, dataBase64 }) =>
		(await client()).uploadDocument(
			name,
			mime,
			base64ToBytes(dataBase64),
		)) satisfies BgHandlers["bet:docUpload"],

	/**
	 * Records which documents a registered message links to, for "sent, not viewed
	 * yet". Best effort: views are attributed by the link itself either way, so a
	 * failure here must not make the send fall back to untracked.
	 */
	async afterRegister(req: RegisterMessageRequest): Promise<void> {
		if (!req.documents?.length) return;
		try {
			await (await client()).attachDocuments({
				messageId: req.id,
				documentIds: req.documents,
			});
		} catch (err) {
			console.warn("[bet] attaching documents failed", err);
		}
	},
};
