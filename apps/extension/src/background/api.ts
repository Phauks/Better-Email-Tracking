import { type ApiClient, apiFromSettings } from "../api/client";
import { loadSettings } from "../settings";

/** A Worker client for the current settings (read on every call: they can change). */
export async function workerApi(): Promise<ApiClient> {
	return apiFromSettings(await loadSettings());
}
