import type { NudgeEnv } from "../features/nudges/env";
import { decryptSecret } from "../lib/crypto";
import { GmailConnector } from "./gmail";
import { type FetchLike, refreshAccessToken } from "./google-oauth";
import type { ConnectorRecord, MailboxConnector } from "./types";

export interface ResolveArgs {
	env: NudgeEnv;
	record: ConnectorRecord;
	fetch: FetchLike;
	now: () => number;
}

/** Builds a live connector from its stored record. Tests inject a fake instead. */
export type ConnectorResolver = (
	args: ResolveArgs,
) => Promise<MailboxConnector>;

/** Production resolver. Add Outlook/Yahoo here by `record.kind`. */
export const resolveConnector: ConnectorResolver = async ({
	env,
	record,
	fetch,
	now,
}) => {
	switch (record.kind) {
		case "google": {
			const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENC_KEY } = env;
			if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !TOKEN_ENC_KEY)
				throw new Error("Google connector secrets are not set");
			const refreshToken = await decryptSecret(
				record.refreshTokenEnc,
				TOKEN_ENC_KEY,
			);
			// Access tokens live about an hour; refresh on first use and when close to expiry.
			let cached: { accessToken: string; expiresAt: number } | null = null;
			const accessToken = async () => {
				if (!cached || cached.expiresAt - 60_000 < now()) {
					cached = await refreshAccessToken(
						{ clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET },
						refreshToken,
						fetch,
						now(),
					);
				}
				return cached.accessToken;
			};
			return new GmailConnector(record.email, accessToken, fetch);
		}
		default:
			throw new Error(`unknown connector ${record.kind}`);
	}
};
