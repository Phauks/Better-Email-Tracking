import type { ComposeView, MessageView, ThreadRowView } from "@inboxsdk/core";
import * as InboxSDK from "@inboxsdk/core";
import { svgDataUrl } from "../../ui/icons";
import type {
	BeforeSendHook,
	ComposeSession,
	ListRow,
	MailClientAdapter,
	MessageViewInfo,
	OpenComposeOptions,
	SentInfo,
	StatusBadge,
	ToolbarControl,
	ToolbarControlOptions,
	ToolbarControlState,
} from "../types";
import { detectGmailAttachments } from "./attachments";
import { ValueStream } from "./value-stream";

type ImageDescriptor = Parameters<ThreadRowView["addImage"]>[0];
type ButtonDescriptor = Parameters<ComposeView["addButton"]>[0];

const SDK_VERSION = 2;

class GmailComposeSession implements ComposeSession {
	private hooks: BeforeSendHook[] = [];
	private bypassNextSend = false;
	private running = false;

	constructor(
		private readonly view: ComposeView,
		readonly programmatic: boolean,
	) {
		view.on("presending", (event) => {
			if (this.bypassNextSend) {
				this.bypassNextSend = false;
				return;
			}
			if (this.programmatic || this.hooks.length === 0) return;
			// presending is synchronous; cancel now, run async hooks, then resend.
			event.cancel();
			if (this.running) return;
			this.running = true;
			void this.runHooks().finally(() => {
				this.running = false;
			});
		});
	}

	private async runHooks(): Promise<void> {
		for (const hook of this.hooks) {
			let result: Awaited<ReturnType<BeforeSendHook>> = "continue";
			try {
				result = await hook(this);
			} catch (err) {
				// Never let a tracking bug block an email.
				console.error("[bet] before-send hook failed", err);
			}
			if (result === "handled" || result === "abort") return;
		}
		if (!this.view.destroyed) this.send();
	}

	isReply(): boolean {
		return this.view.isReply();
	}
	getRecipients() {
		const map = (list: { emailAddress: string; name?: string }[]) =>
			list.map((c) =>
				c.name
					? { email: c.emailAddress, name: c.name }
					: { email: c.emailAddress },
			);
		return {
			to: map(this.view.getToRecipients()),
			cc: map(this.view.getCcRecipients()),
			bcc: map(this.view.getBccRecipients()),
		};
	}
	getSubject(): string {
		return this.view.getSubject();
	}
	getBodyHtml(): string {
		return this.view.getHTMLContent();
	}
	setBodyHtml(html: string): void {
		this.view.setBodyHTML(html);
	}
	insertHtmlAtCursor(html: string): void {
		this.view.insertHTMLIntoBodyAtCursor(html);
	}
	hasAttachments(): boolean | undefined {
		try {
			return detectGmailAttachments(
				this.view.getElement(),
				this.view.getBodyElement(),
			);
		} catch {
			return undefined;
		}
	}
	addToolbarControl(opts: ToolbarControlOptions): ToolbarControl {
		const toDescriptor = (s: ToolbarControlState) => ({
			title: s.tooltip,
			tooltip: s.tooltip,
			iconUrl: svgDataUrl(s.iconSvg, s.color),
			type: "MODIFIER" as const,
			onClick: () => opts.onClick(),
		});
		const stream = new ValueStream<ReturnType<typeof toDescriptor> | null>(
			toDescriptor(opts),
		);
		this.view.addButton(stream as unknown as ButtonDescriptor);
		return {
			update: (s) => stream.set(toDescriptor(s)),
			// A null descriptor removes the button.
			remove: () => stream.set(null),
		};
	}
	onBeforeSend(hook: BeforeSendHook): void {
		this.hooks.push(hook);
	}
	onSent(cb: (info: SentInfo) => void): void {
		this.view.on("sent", (data) => {
			void Promise.all([
				data.getThreadID().catch(() => undefined),
				data.getMessageID().catch(() => undefined),
			]).then(([providerThreadId, providerMessageId]) =>
				cb({ providerThreadId, providerMessageId }),
			);
		});
	}
	onDestroy(cb: () => void): void {
		this.view.on("destroy", () => cb());
	}
	send(): void {
		this.bypassNextSend = true;
		this.view.send();
	}
	close(): void {
		if (!this.view.destroyed) this.view.close();
	}
	discard(): void {
		if (!this.view.destroyed) this.view.discard();
	}
}

export async function createGmailAdapter(): Promise<MailClientAdapter> {
	const appId = import.meta.env.VITE_INBOXSDK_APP_ID;
	if (!appId) {
		throw new Error(
			"VITE_INBOXSDK_APP_ID is not set. Register a free app id at https://www.inboxsdk.com/register and rebuild.",
		);
	}
	const sdk = await InboxSDK.load(SDK_VERSION, appId, {
		appName: "Better Email Tracking",
	});
	const ownEmail = () => sdk.User.getEmailAddress().toLowerCase();

	// Compose views we open ourselves are not handed to feature handlers.
	let expectProgrammatic = 0;
	const programmaticViews = new WeakSet<ComposeView>();
	const sessions = new WeakMap<ComposeView, GmailComposeSession>();
	const composeHandlers: ((s: ComposeSession) => void)[] = [];

	const sessionFor = (view: ComposeView): GmailComposeSession => {
		let s = sessions.get(view);
		if (!s) {
			if (expectProgrammatic > 0) {
				expectProgrammatic--;
				programmaticViews.add(view);
			}
			s = new GmailComposeSession(view, programmaticViews.has(view));
			sessions.set(view, s);
		}
		return s;
	};

	sdk.Compose.registerComposeViewHandler((view) => {
		const session = sessionFor(view);
		if (session.programmatic) return;
		for (const h of composeHandlers) h(session);
	});

	return {
		name: "gmail",
		onCompose(handler) {
			composeHandlers.push(handler);
		},
		async openCompose(opts: OpenComposeOptions) {
			expectProgrammatic++;
			let view: ComposeView;
			try {
				view = await sdk.Compose.openNewComposeView();
			} catch (err) {
				expectProgrammatic = Math.max(0, expectProgrammatic - 1);
				throw err;
			}
			programmaticViews.add(view);
			const session = sessionFor(view);
			view.setToRecipients(opts.to);
			if (opts.cc?.length) view.setCcRecipients(opts.cc);
			view.setSubject(opts.subject);
			view.setBodyHTML(opts.html);
			return session;
		},
		onSentListRow(handler) {
			sdk.Lists.registerThreadRowViewHandler((rowView) => {
				handler(gmailListRow(rowView));
			});
		},
		onMessageView(handler) {
			sdk.Conversations.registerMessageViewHandler((mv) => {
				const emit = () => handler(gmailMessageView(mv, ownEmail));
				if (mv.isLoaded()) emit();
				else mv.on("load", emit);
			});
		},
		showNotice(text, kind = "info") {
			if (kind === "error") sdk.ButterBar.showError({ text, time: 8000 });
			else sdk.ButterBar.showMessage({ text, time: 6000 });
		},
		getRootElement() {
			return document.body;
		},
	};
}

function gmailListRow(rowView: ThreadRowView): ListRow {
	let stream: ValueStream<ImageDescriptor | null> | null = null;
	return {
		getThreadId: async () => {
			try {
				return (await rowView.getThreadIDAsync()) || null;
			} catch {
				return null;
			}
		},
		setStatusBadge(badge: StatusBadge | null) {
			if (rowView.destroyed) return;
			const desc: ImageDescriptor | null = badge
				? {
						imageUrl: svgDataUrl(badge.iconSvg, badge.color),
						tooltip: badge.tooltip,
						orderHint: 100,
					}
				: null;
			if (stream) stream.set(desc);
			else if (desc) {
				stream = new ValueStream<ImageDescriptor | null>(desc);
				rowView.addImage(stream as unknown as ImageDescriptor);
			}
		},
		onDestroy(cb) {
			rowView.on("destroy", () => {
				stream?.end();
				cb();
			});
		},
	};
}

function gmailMessageView(
	mv: MessageView,
	ownEmail: () => string,
): MessageViewInfo {
	return {
		isFromOwner() {
			try {
				return mv.getSender().emailAddress.toLowerCase() === ownEmail();
			} catch {
				return false;
			}
		},
		async getThreadId() {
			try {
				return await mv.getThreadView().getThreadIDAsync();
			} catch {
				return null;
			}
		},
		get bodyElement() {
			return mv.getBodyElement();
		},
	};
}
