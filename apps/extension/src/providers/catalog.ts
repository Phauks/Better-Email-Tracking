import type { Provider } from "@bet/shared";

/**
 * What extension pages may know about mail providers without loading their SDKs
 * (registry.ts adds the lazily loaded adapters for content scripts).
 */
export interface ProviderInfo {
	name: Provider;
	/** Product name for UI copy, e.g. "Gmail". */
	label: string;
	matches(hostname: string): boolean;
}

export const GMAIL: ProviderInfo = {
	name: "gmail",
	label: "Gmail",
	matches: (host) => host === "mail.google.com",
};

/**
 * The provider extension pages act for when no mail tab is involved yet (e.g. a new
 * mail merge campaign). Gmail until there is a setting to choose one.
 */
export const DEFAULT_PROVIDER: ProviderInfo = GMAIL;
