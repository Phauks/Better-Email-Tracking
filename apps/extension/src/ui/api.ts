import { type ApiClient, apiFromSettings } from "../api/client";
import { loadSettings } from "../settings";

/** Extension pages call the Worker directly (they have the host permission). */
export async function pageApi(): Promise<ApiClient> {
	return apiFromSettings(await loadSettings());
}
