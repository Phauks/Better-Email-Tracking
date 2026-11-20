import {
	API,
	type FeedResponse,
	type ListMessagesResponse,
	type MarkSentRequest,
	type MessageDetail,
	type OwnerViewRequest,
	type RegisterMessageRequest,
	type ThreadStatusRequest,
	type ThreadStatusResponse,
} from "@bet/shared";

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "ApiError";
	}
}

/** Typed client for the tracking Worker. Used by the background worker and extension pages. */
export class ApiClient {
	constructor(
		private readonly baseUrl: string,
		private readonly token: string,
		private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
	) {}

	private async request<T>(
		method: "GET" | "POST",
		path: string,
		body?: unknown,
		auth = true,
	): Promise<T> {
		if (!this.baseUrl) throw new ApiError("Worker URL is not set", 0);
		const headers: Record<string, string> = { Accept: "application/json" };
		if (auth) headers.Authorization = `Bearer ${this.token}`;
		if (body !== undefined) headers["Content-Type"] = "application/json";
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		} catch (err) {
			throw new ApiError(`Network error: ${(err as Error).message}`, 0);
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new ApiError(
				`${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`.trim(),
				res.status,
			);
		}
		const type = res.headers.get("content-type") ?? "";
		return (type.includes("json") ? await res.json() : undefined) as T;
	}

	health(): Promise<unknown> {
		return this.request("GET", API.health, undefined, false);
	}
	registerMessage(req: RegisterMessageRequest): Promise<void> {
		return this.request("POST", API.messages, req);
	}
	markSent(id: string, req: MarkSentRequest): Promise<void> {
		return this.request("POST", API.sent(id), req);
	}
	listMessages(
		opts: { q?: string; limit?: number } = {},
	): Promise<ListMessagesResponse> {
		return this.request("GET", `${API.messages}${query(opts)}`);
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
}

function query(params: Record<string, string | number | undefined>): string {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined && v !== "") sp.set(k, String(v));
	}
	const s = sp.toString();
	return s ? `?${s}` : "";
}
