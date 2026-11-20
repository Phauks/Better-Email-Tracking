import type {
	MailboxConnector,
	OutgoingReply,
	SentReply,
	ThreadInspection,
	ThreadRef,
} from "./types";

export interface FakeThreadMessage {
	id: string;
	from: string;
	at: number;
	messageIdHeader: string;
	references?: string[];
	marker?: string;
	auto?: boolean;
}

/**
 * In-memory MailboxConnector for tests and local experiments: threads are lists of
 * messages, sends are recorded and appended to the thread.
 */
export class FakeMailbox implements MailboxConnector {
	readonly kind = "google";
	readonly threads = new Map<string, FakeThreadMessage[]>();
	readonly sent: { thread: ThreadRef; reply: OutgoingReply }[] = [];
	findCalls = 0;
	/** Next findReplies/sendReply throws this. */
	failFind: Error | null = null;
	failSend: Error | null = null;
	/** Simulates a crash after Gmail accepted the message: it lands, then we throw. */
	crashAfterSend = false;
	private seq = 0;

	constructor(
		readonly ownerAddress = "me@example.com",
		private readonly clock: () => number = () => Date.now(),
	) {}

	addMessage(threadId: string, msg: Omit<FakeThreadMessage, "id">): void {
		const list = this.threads.get(threadId) ?? [];
		list.push({ ...msg, id: `m${++this.seq}` });
		this.threads.set(threadId, list);
	}

	async findReplies(
		thread: ThreadRef,
		since: number,
		ownerAddress: string,
	): Promise<ThreadInspection> {
		this.findCalls++;
		if (this.failFind) {
			const err = this.failFind;
			this.failFind = null;
			throw err;
		}
		const msgs = [...(this.threads.get(thread.threadId) ?? [])].sort(
			(a, b) => a.at - b.at,
		);
		const out: ThreadInspection = {
			reply: null,
			bounced: false,
			sentMarkers: msgs.flatMap((m) => (m.marker ? [m.marker] : [])),
			threading: { references: [] },
		};
		for (const m of msgs) {
			if (m.from.toLowerCase() === ownerAddress.toLowerCase() || m.at <= since)
				continue;
			if (/^mailer-daemon@/i.test(m.from)) out.bounced = true;
			else if (!m.auto) out.reply ??= { at: m.at, from: m.from };
		}
		const last = msgs.at(-1);
		if (last) {
			out.threading = {
				inReplyTo: last.messageIdHeader,
				references: last.references ?? [],
			};
		}
		return out;
	}

	async sendReply(thread: ThreadRef, reply: OutgoingReply): Promise<SentReply> {
		if (this.failSend) {
			const err = this.failSend;
			this.failSend = null;
			throw err;
		}
		this.sent.push({ thread, reply });
		const id = `sent${this.sent.length}`;
		this.addMessage(thread.threadId, {
			from: this.ownerAddress,
			at: this.clock(),
			messageIdHeader: `<${id}@mail.example.com>`,
			references: [
				...reply.references,
				...(reply.inReplyTo ? [reply.inReplyTo] : []),
			],
			marker: reply.markerId,
		});
		if (this.crashAfterSend) {
			this.crashAfterSend = false;
			throw new Error("crashed after send");
		}
		return { providerMessageId: id, providerThreadId: thread.threadId };
	}
}
