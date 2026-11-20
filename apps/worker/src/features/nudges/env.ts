import type { Env } from "../../env";

/** Bindings used only by follow-up nudges. All are secrets (`wrangler secret put`). */
export interface NudgeEnv extends Env {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	/** Encrypts stored refresh tokens and signs OAuth state. Long random string. */
	TOKEN_ENC_KEY?: string;
	/** Override when the Worker is reached under another origin than the browser uses. */
	GOOGLE_REDIRECT_URI?: string;
}

export const nudgeEnv = (env: Env): NudgeEnv => env as NudgeEnv;

export function googleConfigured(env: NudgeEnv): boolean {
	return Boolean(
		env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.TOKEN_ENC_KEY,
	);
}
