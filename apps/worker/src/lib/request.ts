import { classifyRequest, deviceHint, type EventSource } from "@bet/shared";
import type { Config } from "../env";
import { hashIp } from "./hash";

type Cf = {
	asn?: number;
	asOrganization?: string;
	city?: string;
	country?: string;
};

export interface RequestFacts {
	source: EventSource;
	device?: string;
	location?: string;
	ipHash?: string;
}

export function clientIp(req: Request): string | null {
	return req.headers.get("CF-Connecting-IP");
}

export async function ipHashOf(
	req: Request,
	salt: string | undefined,
): Promise<string | undefined> {
	const ip = clientIp(req);
	return ip ? hashIp(ip, salt ?? "") : undefined;
}

/** Everything we keep about who fetched a pixel/link: classification, not identity. */
export async function describeRequest(
	req: Request,
	config: Config,
	salt: string | undefined,
): Promise<RequestFacts> {
	const cf = (req as { cf?: Cf }).cf ?? {};
	const userAgent = req.headers.get("User-Agent") ?? "";
	const source = classifyRequest({
		userAgent,
		...(cf.asn !== undefined ? { asn: cf.asn } : {}),
		...(cf.asOrganization ? { asOrganization: cf.asOrganization } : {}),
	});
	const facts: RequestFacts = { source };
	// Proxies hide the reader's device; their UA describes the proxy, not the reader.
	if (source === "direct" || source === "scanner") {
		const hint = deviceHint(userAgent);
		const device = [hint.client, hint.os].filter(Boolean).join(" on ");
		if (device) facts.device = device;
	}
	if (config.storeLocation) {
		const location = [cf.city, cf.country].filter(Boolean).join(", ");
		if (location) facts.location = location;
	}
	const ipHash = await ipHashOf(req, salt);
	if (ipHash) facts.ipHash = ipHash;
	return facts;
}
