/** Google OAuth 2.0 (web server flow) with plain fetch. */

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Send mail and read message headers (never bodies). */
export const GOOGLE_SCOPES = [
	"https://www.googleapis.com/auth/gmail.send",
	"https://www.googleapis.com/auth/gmail.metadata",
];

export interface GoogleOAuthConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export type FetchLike = typeof fetch;

const TIMEOUT_MS = 30_000;

export class GoogleApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "GoogleApiError";
	}
}

export function googleAuthUrl(cfg: GoogleOAuthConfig, state: string): string {
	const p = new URLSearchParams({
		client_id: cfg.clientId,
		redirect_uri: cfg.redirectUri,
		response_type: "code",
		scope: GOOGLE_SCOPES.join(" "),
		access_type: "offline",
		// Always show consent so Google returns a refresh token every time.
		prompt: "consent",
		state,
	});
	return `${GOOGLE_AUTH_URL}?${p}`;
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
	error_description?: string;
}

async function postForm(
	fetchImpl: FetchLike,
	url: string,
	form: Record<string, string>,
): Promise<TokenResponse> {
	const res = await fetchImpl(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(form).toString(),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = (await res.json().catch(() => ({}))) as TokenResponse;
	if (!res.ok || body.error) {
		throw new GoogleApiError(
			`Google token endpoint: ${body.error ?? res.status} ${body.error_description ?? ""}`.trim(),
			res.status,
		);
	}
	return body;
}

export interface CodeExchange {
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
	scope: string;
}

export async function exchangeCode(
	cfg: GoogleOAuthConfig,
	code: string,
	fetchImpl: FetchLike,
	now: number,
): Promise<CodeExchange> {
	const body = await postForm(fetchImpl, GOOGLE_TOKEN_URL, {
		code,
		client_id: cfg.clientId,
		client_secret: cfg.clientSecret,
		redirect_uri: cfg.redirectUri,
		grant_type: "authorization_code",
	});
	if (!body.access_token) throw new GoogleApiError("no access token", 500);
	const out: CodeExchange = {
		accessToken: body.access_token,
		expiresAt: now + (body.expires_in ?? 3600) * 1000,
		scope: body.scope ?? "",
	};
	if (body.refresh_token) out.refreshToken = body.refresh_token;
	return out;
}

export async function refreshAccessToken(
	cfg: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">,
	refreshToken: string,
	fetchImpl: FetchLike,
	now: number,
): Promise<{ accessToken: string; expiresAt: number }> {
	const body = await postForm(fetchImpl, GOOGLE_TOKEN_URL, {
		refresh_token: refreshToken,
		client_id: cfg.clientId,
		client_secret: cfg.clientSecret,
		grant_type: "refresh_token",
	});
	if (!body.access_token) throw new GoogleApiError("no access token", 500);
	return {
		accessToken: body.access_token,
		expiresAt: now + (body.expires_in ?? 3600) * 1000,
	};
}

/** Best effort: a failed revoke still lets the owner disconnect locally. */
export async function revokeToken(
	token: string,
	fetchImpl: FetchLike,
): Promise<boolean> {
	try {
		const res = await fetchImpl(GOOGLE_REVOKE_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ token }).toString(),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		return res.ok;
	} catch {
		return false;
	}
}

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** Calls the Gmail API with a bearer token; throws GoogleApiError on failure. */
export async function gmailFetch<T>(
	fetchImpl: FetchLike,
	accessToken: string,
	path: string,
	init: { method?: string; body?: unknown } = {},
): Promise<T> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/json",
	};
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	const res = await fetchImpl(`${GMAIL_API}${path}`, {
		method: init.method ?? "GET",
		headers,
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new GoogleApiError(
			`Gmail ${init.method ?? "GET"} ${path.split("?")[0]}: ${res.status} ${text.slice(0, 200)}`.trim(),
			res.status,
		);
	}
	return (await res.json()) as T;
}

export async function gmailProfileEmail(
	fetchImpl: FetchLike,
	accessToken: string,
): Promise<string> {
	const p = await gmailFetch<{ emailAddress?: string }>(
		fetchImpl,
		accessToken,
		"/profile",
	);
	if (!p.emailAddress) throw new GoogleApiError("profile has no email", 500);
	return p.emailAddress;
}
