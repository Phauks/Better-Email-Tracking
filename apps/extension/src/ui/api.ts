import { ApiClient } from "../api/client";
import { loadSettings } from "../settings";

/** Extension pages call the Worker directly (they have the host permission). */
export async function pageApi(): Promise<ApiClient> {
	const s = await loadSettings();
	return new ApiClient(s.workerUrl, s.apiToken);
}
