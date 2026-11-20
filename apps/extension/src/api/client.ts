import {
	API,
	type AttachDocumentsRequest,
	CAMPAIGN_API,
	type CampaignDetail,
	type CampaignFollowUpAction,
	type CampaignFollowUpActionResponse,
	type CampaignLeaseRequest,
	type CampaignStatus,
	type ConnectorKind,
	type ConnectorStatusResponse,
	type CreateCampaignRequest,
	type CreateNudgeRequest,
	DOCUMENT_API,
	type DocumentDetail,
	type FeedResponse,
	type ListCampaignsResponse,
	type ListDocumentRecipientsResponse,
	type ListDocumentsResponse,
	type ListMessagesQuery,
	type ListMessagesResponse,
	type ListNudgesQuery,
	type ListNudgesResponse,
	type ListRecipientsResponse,
	type MarkSentRequest,
	type MessageDetail,
	NUDGE_API,
	type NudgeResponse,
	type OwnerViewRequest,
	type PageQuery,
	type RecipientQuery,
	type RecipientResultRequest,
	type RecipientResultResponse,
	type RegisterMessageRequest,
	type StartConnectorResponse,
	type ThreadStatusRequest,
	type ThreadStatusResponse,
	type UpdateCampaignRequest,
	type UpdateNudgeRequest,
	type UploadDocumentResponse,
} from "@bet/shared";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** Machine-readable reason from the Worker's `{ error, code }` body, if any. */
		readonly code?: string,
	) {
		super(message);
		this.name = "ApiError";
	}
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface SendOptions {
	/** JSON-encoded unless `raw` is set. */
	body?: unknown;
	/** Send the body as-is with this content type (uploads). */
	raw?: { body: BodyInit; contentType: string };
	auth?: boolean;
}

export type ResultOutcome =
	| RecipientResultResponse
	| { ok: false; conflict: true; error: string };

/**
 * Typed client for the tracking Worker, one section per module. Used by the background
 * worker and extension pages; content scripts go through the background instead (see
 * messaging.ts). To add a feature's endpoints, add a section here.
 */
export class ApiClient {
	constructor(
		private readonly baseUrl: string,
		private readonly token: string,
		private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
	) {}

	/** Sends a request and returns the response, throwing ApiError on network or HTTP errors. */
	private async send(
		method: Method,
		path: string,
		opts: SendOptions = {},
	): Promise<Response> {
		if (!this.baseUrl) throw new ApiError("Worker URL is not set", 0);
		const headers: Record<string, string> = { Accept: "application/json" };
		if (opts.auth !== false) headers.Authorization = `Bearer ${this.token}`;
		let body: BodyInit | undefined;
		if (opts.raw) {
			headers["Content-Type"] = opts.raw.contentType;
			body = opts.raw.body;
		} else if (opts.body !== undefined) {
			headers["Content-Type"] = "application/json";
			body = JSON.stringify(opts.body);
		}
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers,
				...(body !== undefined ? { body } : {}),
			});
		} catch (err) {
			throw new ApiError(`Network error: ${(err as Error).message}`, 0);
		}
		if (!res.ok) throw await errorFrom(res, method, path);
		return res;
	}

	private async request<T>(
		method: Method,
		path: string,
		body?: unknown,
		auth = true,
	): Promise<T> {
		const res = await this.send(method, path, { body, auth });
		const type = res.headers.get("content-type") ?? "";
		return (type.includes("json") ? await res.json() : undefined) as T;
	}

	// Core message tracking

	health(): Promise<unknown> {
		return this.request("GET", API.health, undefined, false);
	}
	registerMessage(req: RegisterMessageRequest): Promise<void> {
		return this.request("POST", API.messages, req);
	}
	markSent(id: string, req: MarkSentRequest): Promise<void> {
		return this.request("POST", API.sent(id), req);
	}
	/** Emails only (nudges are never listed), newest first; pass nextCursor back as cursor. */
	listMessages(
		opts: ListMessagesQuery & PageQuery = {},
	): Promise<ListMessagesResponse> {
		return this.request("GET", `${API.messages}${query({ ...opts })}`);
	}
	getMessage(id: string): Promise<MessageDetail> {
		return this.request("GET", API.message(id));
	}
	feed(opts: { since?: number; limit?: number } = {}): Promise<FeedResponse> {
		return this.request("GET", `${API.feed}${query(opts)}`);
	}
	threadStatus(threadIds: string[]): Promise<ThreadStatusResponse> {
		const body: ThreadStatusRequest = { threadIds };
		return this.request("POST", API.threadStatus, body);
	}
	ownerViews(req: OwnerViewRequest): Promise<void> {
		return this.request("POST", API.ownerViews, req);
	}

	// Tracked documents

	listDocuments(opts: PageQuery = {}): Promise<ListDocumentsResponse> {
		return this.request(
			"GET",
			`${DOCUMENT_API.documents}${query({ ...opts })}`,
		);
	}
	/** Detail with the first page of per-recipient rows. */
	getDocument(id: string, opts: PageQuery = {}): Promise<DocumentDetail> {
		return this.request(
			"GET",
			`${DOCUMENT_API.document(id)}${query({ ...opts })}`,
		);
	}
	listDocumentRecipients(
		id: string,
		opts: PageQuery = {},
	): Promise<ListDocumentRecipientsResponse> {
		return this.request(
			"GET",
			`${DOCUMENT_API.recipients(id)}${query({ ...opts })}`,
		);
	}
	deleteDocument(id: string): Promise<void> {
		return this.request("DELETE", DOCUMENT_API.document(id));
	}
	attachDocuments(req: AttachDocumentsRequest): Promise<void> {
		return this.request("POST", DOCUMENT_API.attach, req);
	}
	/** Raw bytes upload; the name travels in the query string. */
	async uploadDocument(
		name: string,
		mime: string,
		data: Blob | ArrayBuffer | Uint8Array<ArrayBuffer>,
	): Promise<UploadDocumentResponse> {
		const path = `${DOCUMENT_API.documents}?name=${encodeURIComponent(name)}`;
		const res = await this.send("POST", path, {
			raw: { body: data, contentType: mime || "application/octet-stream" },
		});
		return (await res.json()) as UploadDocumentResponse;
	}
	/** The file through the authenticated preview route: never counted as a view. */
	async previewDocument(id: string): Promise<Blob> {
		return (await this.send("GET", DOCUMENT_API.file(id))).blob();
	}

	// Mail merge campaigns

	listCampaigns(
		opts: { status?: CampaignStatus } & PageQuery = {},
	): Promise<ListCampaignsResponse> {
		return this.request(
			"GET",
			`${CAMPAIGN_API.campaigns}${query({ ...opts })}`,
		);
	}
	/** Detail with the first page of recipients matching `opts`. */
	getCampaign(id: string, opts: RecipientQuery = {}): Promise<CampaignDetail> {
		return this.request(
			"GET",
			`${CAMPAIGN_API.campaign(id)}${recipientQuery(opts)}`,
		);
	}
	listCampaignRecipients(
		id: string,
		opts: RecipientQuery = {},
	): Promise<ListRecipientsResponse> {
		return this.request(
			"GET",
			`${CAMPAIGN_API.recipients(id)}${recipientQuery(opts)}`,
		);
	}
	/** Pause, resume or cancel every follow-up of a campaign. */
	campaignFollowUps(
		id: string,
		action: CampaignFollowUpAction,
	): Promise<CampaignFollowUpActionResponse> {
		return this.request("POST", CAMPAIGN_API.followUps(id), { action });
	}
	createCampaign(req: CreateCampaignRequest): Promise<CampaignDetail> {
		return this.request("POST", CAMPAIGN_API.campaigns, req);
	}
	updateCampaign(
		id: string,
		req: UpdateCampaignRequest,
	): Promise<CampaignDetail> {
		return this.request("PATCH", CAMPAIGN_API.campaign(id), req);
	}
	deleteCampaign(id: string): Promise<void> {
		return this.request("DELETE", CAMPAIGN_API.campaign(id));
	}
	/** False when another sender holds the lease or the campaign is not sending. */
	async leaseCampaign(id: string, req: CampaignLeaseRequest): Promise<boolean> {
		try {
			await this.request("POST", CAMPAIGN_API.lease(id), req);
			return true;
		} catch (err) {
			if (err instanceof ApiError && err.status === 409) return false;
			throw err;
		}
	}
	/** A 409 (recipient or campaign changed state meanwhile) is returned, not thrown. */
	async recipientResult(
		id: string,
		email: string,
		req: RecipientResultRequest,
	): Promise<ResultOutcome> {
		try {
			return await this.request(
				"POST",
				CAMPAIGN_API.recipientResult(id, email),
				req,
			);
		} catch (err) {
			if (err instanceof ApiError && err.status === 409)
				return { ok: false, conflict: true, error: err.message };
			throw err;
		}
	}

	// Follow-up nudges and mailbox connectors

	createNudge(req: CreateNudgeRequest): Promise<NudgeResponse> {
		return this.request("POST", NUDGE_API.nudges, req);
	}
	listNudges(
		opts: ListNudgesQuery & PageQuery = {},
	): Promise<ListNudgesResponse> {
		return this.request("GET", `${NUDGE_API.nudges}${query({ ...opts })}`);
	}
	updateNudge(id: string, req: UpdateNudgeRequest): Promise<NudgeResponse> {
		return this.request("PATCH", NUDGE_API.nudge(id), req);
	}
	cancelNudge(id: string): Promise<NudgeResponse> {
		return this.request("DELETE", NUDGE_API.nudge(id));
	}
	connectorStatus(): Promise<ConnectorStatusResponse> {
		return this.request("GET", NUDGE_API.connectorStatus);
	}
	startConnector(kind: ConnectorKind): Promise<StartConnectorResponse> {
		return this.request("POST", NUDGE_API.connectorStart(kind));
	}
	disconnectConnector(kind: ConnectorKind): Promise<{ revoked: boolean }> {
		return this.request("DELETE", NUDGE_API.connector(kind));
	}
}

/** A client for the stored settings' Worker. */
export function apiFromSettings(s: {
	workerUrl: string;
	apiToken: string;
}): ApiClient {
	return new ApiClient(s.workerUrl, s.apiToken);
}

/** ApiError with the Worker's `{ error, code }` message when the body has one. */
async function errorFrom(
	res: Response,
	method: Method,
	path: string,
): Promise<ApiError> {
	const text = await res.text().catch(() => "");
	let message = text.slice(0, 200);
	let code: string | undefined;
	try {
		const body = JSON.parse(text) as { error?: unknown; code?: unknown };
		if (typeof body.error === "string") message = body.error;
		if (typeof body.code === "string") code = body.code;
	} catch {}
	return new ApiError(
		`${method} ${path.split("?")[0]} failed: ${res.status} ${message}`.trim(),
		res.status,
		code,
	);
}

function recipientQuery(q: RecipientQuery): string {
	const { state, ...rest } = q;
	return query({
		...rest,
		...(state?.length ? { state: state.join(",") } : {}),
	});
}

function query(params: Record<string, string | number | undefined>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== "") sp.set(k, String(v));
	}
	const s = sp.toString();
	return s ? `?${s}` : "";
}
