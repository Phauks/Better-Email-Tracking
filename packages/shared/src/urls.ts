/** URL shapes served by the tracking Worker. Keep in sync with apps/worker routes. */
export interface TrackingUrls {
	pixel(messageId: string): string;
	click(messageId: string, linkIndex: number): string;
}

export function trackingUrls(baseUrl: string): TrackingUrls {
	const base = baseUrl.replace(/\/+$/, "");
	return {
		pixel: (id) => `${base}/o/${id}.gif`,
		click: (id, idx) => `${base}/c/${id}/${idx}`,
	};
}

export const ROUTES = {
	pixel: "/o/:file",
	click: "/c/:id/:idx",
} as const;
