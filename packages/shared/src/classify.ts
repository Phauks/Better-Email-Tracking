/**
 * Classifies who fetched a pixel or followed a link, from request metadata.
 * Basis: Gmail proxies images with "GoogleImageProxy" in the user agent; Apple Mail
 * Privacy Protection preloads images through Apple's network, so those hits are
 * machine opens; link scanners click from cloud networks right after delivery.
 */
export type EventSource =
	| "google_proxy" // Gmail image proxy: usually a real open, but location/device hidden
	| "apple_proxy" // Apple MPP prefetch: may not be a real open
	| "scanner" // security scanner or bot
	| "direct"; // a real client fetching directly

export interface RequestMeta {
	userAgent: string;
	asn?: number;
	asOrganization?: string;
}

const APPLE_ASNS = new Set([714, 6185]);
const SCANNER_UA =
	/(bot|crawler|spider|scanner|preview|safelinks|mimecast|proofpoint|barracuda|python-requests|curl|wget|headless)/i;
const CLOUD_ORGS =
	/(amazon|google cloud|microsoft|azure|digitalocean|ovh|hetzner|linode|oracle)/i;

export function classifyRequest(meta: RequestMeta): EventSource {
	const ua = meta.userAgent ?? "";
	if (/GoogleImageProxy/i.test(ua)) return "google_proxy";
	if (
		(meta.asn !== undefined && APPLE_ASNS.has(meta.asn)) ||
		/apple/i.test(meta.asOrganization ?? "")
	) {
		return "apple_proxy";
	}
	if (ua === "" || SCANNER_UA.test(ua)) return "scanner";
	if (CLOUD_ORGS.test(meta.asOrganization ?? "")) return "scanner";
	return "direct";
}

/** Machine opens are kept but shown separately from likely-human ones. */
export function isLikelyHuman(source: EventSource): boolean {
	return source === "google_proxy" || source === "direct";
}

export interface DeviceHint {
	os?: "Windows" | "macOS" | "iOS" | "Android" | "Linux" | "ChromeOS";
	client?: "Outlook" | "Apple Mail" | "Thunderbird" | "Browser";
}

/** Best-effort device hint from the user agent (not available behind Gmail/Apple proxies). */
export function deviceHint(userAgent: string): DeviceHint {
	const ua = userAgent;
	const hint: DeviceHint = {};
	if (/iPhone|iPad|iPod/.test(ua)) hint.os = "iOS";
	else if (/Android/.test(ua)) hint.os = "Android";
	else if (/CrOS/.test(ua)) hint.os = "ChromeOS";
	else if (/Mac OS X|Macintosh/.test(ua)) hint.os = "macOS";
	else if (/Windows/.test(ua)) hint.os = "Windows";
	else if (/Linux/.test(ua)) hint.os = "Linux";
	if (/Outlook|Microsoft Office/.test(ua)) hint.client = "Outlook";
	else if (/Thunderbird/.test(ua)) hint.client = "Thunderbird";
	else if (/AppleWebKit/.test(ua) && !/Chrome|Safari/.test(ua))
		hint.client = "Apple Mail";
	else if (/Chrome|Firefox|Safari|Edg\//.test(ua)) hint.client = "Browser";
	return hint;
}
