import { DocumentsClient } from "../../api/documents";
import { loadSettings } from "../../settings";

/** Document endpoints for extension pages (they have the host permission). */
export async function documentsApi(): Promise<DocumentsClient> {
	const s = await loadSettings();
	return new DocumentsClient(s.workerUrl, s.apiToken);
}
