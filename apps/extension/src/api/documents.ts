import {
	type AttachDocumentsRequest,
	DOCUMENT_API,
	type DocumentDetail,
	type ListDocumentsResponse,
	type UploadDocumentResponse,
} from "@bet/shared";
import { ApiClient, ApiError } from "./client";

/** Worker client plus the tracked-document endpoints (raw uploads, file previews). */
export class DocumentsClient extends ApiClient {
	listDocuments(): Promise<ListDocumentsResponse> {
		return this.request("GET", DOCUMENT_API.documents);
	}
	getDocument(id: string): Promise<DocumentDetail> {
		return this.request("GET", DOCUMENT_API.document(id));
	}
	deleteDocument(id: string): Promise<void> {
		return this.request("DELETE", DOCUMENT_API.document(id));
	}
	attachDocuments(req: AttachDocumentsRequest): Promise<void> {
		return this.request("POST", DOCUMENT_API.attach, req);
	}

	async uploadDocument(
		name: string,
		mime: string,
		data: Blob | ArrayBuffer | Uint8Array<ArrayBuffer>,
	): Promise<UploadDocumentResponse> {
		const path = `${DOCUMENT_API.documents}?name=${encodeURIComponent(name)}`;
		const res = await this.raw("POST", path, {
			"Content-Type": mime || "application/octet-stream",
			body: data,
		});
		return (await res.json()) as UploadDocumentResponse;
	}

	/** The file through the authenticated preview route: never counted as a view. */
	async previewDocument(id: string): Promise<Blob> {
		return (await this.raw("GET", DOCUMENT_API.file(id))).blob();
	}

	private async raw(
		method: "GET" | "POST",
		path: string,
		opts: { "Content-Type"?: string; body?: BodyInit } = {},
	): Promise<Response> {
		if (!this.baseUrl) throw new ApiError("Worker URL is not set", 0);
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.token}`,
		};
		if (opts["Content-Type"]) headers["Content-Type"] = opts["Content-Type"];
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.baseUrl}${path}`, {
				method,
				headers,
				...(opts.body !== undefined ? { body: opts.body } : {}),
			});
		} catch (err) {
			throw new ApiError(`Network error: ${(err as Error).message}`, 0);
		}
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			let message = text.slice(0, 200);
			try {
				message = (JSON.parse(text) as { error?: string }).error ?? message;
			} catch {}
			throw new ApiError(
				`${method} ${path.split("?")[0]} failed: ${res.status} ${message}`.trim(),
				res.status,
			);
		}
		return res;
	}
}
