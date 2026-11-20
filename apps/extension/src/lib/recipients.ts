import type { Recipient } from "@bet/shared";

export interface RecipientSet {
	to: Recipient[];
	cc: Recipient[];
	bcc: Recipient[];
}

export function allRecipients(r: RecipientSet): Recipient[] {
	return [...r.to, ...r.cc, ...r.bcc];
}

/** Unique by lowercase email, keeping the first occurrence (To before CC before BCC). */
export function uniqueRecipients(list: Recipient[]): Recipient[] {
	const seen = new Set<string>();
	const out: Recipient[] = [];
	for (const r of list) {
		const key = r.email.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	return out;
}

export function emailDomain(email: string): string {
	const at = email.lastIndexOf("@");
	return at === -1
		? ""
		: email
				.slice(at + 1)
				.trim()
				.toLowerCase();
}

/** True if the domain equals or is a subdomain of an entry in the list. */
export function domainMatches(domain: string, list: string[]): boolean {
	if (!domain) return false;
	return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

/** Recipients whose domain is on the never-track list. Any match means: do not track. */
export function blockedRecipients(
	list: Recipient[],
	neverTrackDomains: string[],
): Recipient[] {
	return list.filter((r) =>
		domainMatches(emailDomain(r.email), neverTrackDomains),
	);
}

export function formatRecipient(r: Recipient): string {
	return r.name ? `${r.name} <${r.email}>` : r.email;
}
