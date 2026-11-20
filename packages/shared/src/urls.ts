/** URL shapes served by the tracking Worker. Keep in sync with apps/worker routes. */
export interface TrackingUrls {
	pixel(messageId: string): string;
	click(messageId: string, linkIndex: number): string;
	/** Tracked document link; per-message once instrumented at send time. */
	document(documentId: string, messageId?: string): string;
}

export function trackingUrls(baseUrl: string): TrackingUrls {
	const base = baseUrl.replace(/\/+$/, "");
	return {
		pixel: (id) => `${base}/o/${id}.gif`,
		click: (id, idx) => `${base}/c/${id}/${idx}`,
		document: (docId, messageId) =>
			messageId ? `${base}/d/${docId}/${messageId}` : `${base}/d/${docId}`,
	};
}

export const ROUTES = {
	pixel: "/o/:file",
	click: "/c/:id/:idx",
} as const;
