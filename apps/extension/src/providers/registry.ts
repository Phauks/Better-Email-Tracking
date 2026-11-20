import type { MailClientAdapter, ProviderModule } from "./types";

/**
 * Known providers. Modules are loaded lazily so adding Outlook/Yahoo doesn't pull
 * their SDKs into other clients. To add one: implement MailClientAdapter in
 * src/providers/<name>/ and add an entry here plus its host to the manifest.
 */
export const PROVIDERS: ProviderModule[] = [
	{
		name: "gmail",
		matches: (host) => host === "mail.google.com",
		create: async () => (await import("./gmail")).createGmailAdapter(),
	},
];

export function findProvider(hostname: string): ProviderModule | undefined {
	return PROVIDERS.find((p) => p.matches(hostname));
}

export async function createAdapterFor(
	hostname: string,
): Promise<MailClientAdapter | null> {
	const mod = findProvider(hostname);
	return mod ? mod.create() : null;
}
