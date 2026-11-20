/** Typed settings stored in chrome.storage.sync. Pure helpers are exported for tests. */
import {
	DEFAULT_NUDGES,
	type NudgeDefaults,
	normalizeNudgeDefaults,
} from "./lib/nudges";

export type DefaultMode = "off" | "shared" | "individual";

export interface Settings {
	/** Base URL of the tracking Worker; also serves pixels and click redirects. */
	workerUrl: string;
	apiToken: string;
	defaultMode: DefaultMode;
	trackLinks: boolean;
	notify: boolean;
	/** Also notify for opens by mail privacy proxies (Apple MPP) and scanners. */
	notifyMachineOpens: boolean;
	/** Never track mail to these domains (subdomains included). */
	neverTrackDomains: string[];
	/** Follow-up nudge defaults (see lib/nudges.ts). */
	nudges: NudgeDefaults;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
	workerUrl: "",
	apiToken: "",
	defaultMode: "shared",
	trackLinks: true,
	notify: true,
	notifyMachineOpens: false,
	neverTrackDomains: [],
	nudges: DEFAULT_NUDGES,
});

const MODES: DefaultMode[] = ["off", "shared", "individual"];

/** Fills defaults and drops wrong-typed values from whatever storage returned. */
export function normalizeSettings(raw: Record<string, unknown>): Settings {
	const d = DEFAULT_SETTINGS;
	const str = (v: unknown, f: string) => (typeof v === "string" ? v : f);
	const bool = (v: unknown, f: boolean) => (typeof v === "boolean" ? v : f);
	return {
		workerUrl: normalizeWorkerUrl(str(raw.workerUrl, d.workerUrl)),
		apiToken: str(raw.apiToken, d.apiToken).trim(),
		defaultMode: MODES.includes(raw.defaultMode as DefaultMode)
			? (raw.defaultMode as DefaultMode)
			: d.defaultMode,
		trackLinks: bool(raw.trackLinks, d.trackLinks),
		notify: bool(raw.notify, d.notify),
		notifyMachineOpens: bool(raw.notifyMachineOpens, d.notifyMachineOpens),
		neverTrackDomains: Array.isArray(raw.neverTrackDomains)
			? normalizeDomains(
					raw.neverTrackDomains.filter((x) => typeof x === "string"),
				)
			: [...d.neverTrackDomains],
		nudges: normalizeNudgeDefaults(raw.nudges),
	};
}

export function normalizeWorkerUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/** Accepts "example.com", "@example.com", " Example.COM " and returns unique lowercase domains. */
export function normalizeDomains(list: string[]): string[] {
	const out = new Set<string>();
	for (const item of list) {
		const d = item.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
		if (d) out.add(d);
	}
	return [...out];
}

export function isConfigured(s: Settings): boolean {
	return /^https:\/\//.test(s.workerUrl) && s.apiToken.length > 0;
}

/** Origin pattern used for the optional host permission. */
export function workerOriginPattern(workerUrl: string): string | null {
	try {
		return `${new URL(workerUrl).origin}/*`;
	} catch {
		return null;
	}
}

export async function loadSettings(): Promise<Settings> {
	const raw = await chrome.storage.sync.get(null);
	return normalizeSettings(raw);
}

export async function saveSettings(
	patch: Partial<Settings>,
): Promise<Settings> {
	const next = normalizeSettings({ ...(await loadSettings()), ...patch });
	await chrome.storage.sync.set(next);
	return next;
}

/** Calls back with fresh settings whenever they change in any context. */
export function watchSettings(cb: (s: Settings) => void): () => void {
	const listener = (_: unknown, area: string) => {
		if (area === "sync") void loadSettings().then(cb);
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}
