/**
 * Mail-client abstraction. Features talk only to these interfaces; each provider
 * (Gmail via InboxSDK today, Outlook/Yahoo later) implements them in src/providers/<name>.
 */
import type { Provider } from "@bet/shared";
import type { RecipientSet } from "../lib/recipients";

/**
 * What a before-send hook decided:
 * - "continue": let the next hook run, then send normally
 * - "handled": the hook took over the send (e.g. split into copies); don't send this compose
 * - "abort": keep the compose open and don't send
 */
export type BeforeSendResult = "continue" | "handled" | "abort";
export type BeforeSendHook = (
	session: ComposeSession,
) => Promise<BeforeSendResult>;

export interface SentInfo {
	providerThreadId?: string;
	providerMessageId?: string;
}

export interface ToolbarControlState {
	/** Raw SVG markup (uses currentColor). */
	iconSvg: string;
	/** Color applied to the icon. */
	color: string;
	tooltip: string;
}

export interface ToolbarControl {
	update(state: ToolbarControlState): void;
	remove(): void;
}

export interface ToolbarControlOptions extends ToolbarControlState {
	onClick(): void;
}

export interface ComposeSession {
	/** True for composes the extension opened itself (copies of an individual send). */
	readonly programmatic: boolean;
	/** Replies stay in their thread, so they can't be split into separate emails. */
	isReply(): boolean;
	getRecipients(): RecipientSet;
	getSubject(): string;
	getBodyHtml(): string;
	setBodyHtml(html: string): void;
	/** Inserts HTML at the caret. Optional: callers fall back to appending. */
	insertHtmlAtCursor?(html: string): void;
	/** true/false when known; undefined when the provider can't tell. */
	hasAttachments(): boolean | undefined;
	addToolbarControl(opts: ToolbarControlOptions): ToolbarControl;
	/** Hooks run in registration order before every user-initiated send. */
	onBeforeSend(hook: BeforeSendHook): void;
	onSent(cb: (info: SentInfo) => void): void;
	onDestroy(cb: () => void): void;
	/** Sends without running before-send hooks again. */
	send(): void;
	/** Closes, keeping a draft if the client does that. */
	close(): void;
	/** Closes and deletes the draft. */
	discard(): void;
}

export interface OpenComposeOptions {
	to: string[];
	cc?: string[];
	subject: string;
	html: string;
}

export interface StatusBadge {
	iconSvg: string;
	color: string;
	tooltip: string;
}

export interface ListRow {
	getThreadId(): Promise<string | null>;
	/** Sets or replaces the row's badge; null removes it. */
	setStatusBadge(badge: StatusBadge | null): void;
	onDestroy(cb: () => void): void;
}

export interface MessageViewInfo {
	isFromOwner(): boolean;
	getThreadId(): Promise<string | null>;
	readonly bodyElement: HTMLElement;
}

export type NoticeKind = "info" | "error";

export interface MailClientAdapter {
	readonly name: Provider;
	onCompose(handler: (session: ComposeSession) => void): void;
	openCompose(opts: OpenComposeOptions): Promise<ComposeSession>;
	/** Rows in thread lists (sent folder and other lists showing tracked threads). */
	onSentListRow(handler: (row: ListRow) => void): void;
	/** Fires once a message is loaded and visible. */
	onMessageView(handler: (view: MessageViewInfo) => void): void;
	/** Brief toast in the mail client's UI. */
	showNotice(text: string, kind?: NoticeKind): void;
	/** Root element whose subtree holds rendered mail (for DOM-level fallbacks). */
	getRootElement(): HTMLElement;
}

/** Provider modules export a factory; the registry picks one by hostname. */
export interface ProviderModule {
	name: Provider;
	matches(hostname: string): boolean;
	create(): Promise<MailClientAdapter>;
}
