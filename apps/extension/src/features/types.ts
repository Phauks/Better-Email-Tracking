import type {
	MarkSentRequest,
	RegisterMessageRequest,
	ThreadStatusResponse,
	TrackingUrls,
} from "@bet/shared";
import type { MailClientAdapter } from "../providers/types";
import type { Settings } from "../settings";

/** The Worker calls content-script features may make (proxied through the background). */
export interface TrackerApi {
	register(req: RegisterMessageRequest): Promise<void>;
	markSent(id: string, req: MarkSentRequest): Promise<void>;
	threadStatus(threadIds: string[]): Promise<ThreadStatusResponse>;
	ownerViews(messageIds: string[]): Promise<void>;
}

export interface FeatureContext {
	adapter: MailClientAdapter;
	api: TrackerApi;
	/** Current settings; always fresh (updated when storage changes). */
	settings(): Settings;
	/** Pixel/click URL builders for the configured Worker. */
	urls(): TrackingUrls;
}

/** A self-contained capability. Register it in src/features/index.ts. */
export interface Feature {
	id: string;
	setup(ctx: FeatureContext): void | Promise<void>;
}
