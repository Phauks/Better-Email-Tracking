/**
 * A typed request/response channel over chrome.runtime messages. Each channel owns the
 * message types its predicate accepts; listeners answer only those, so channels (and
 * InboxSDK's own background listener) coexist.
 */

type Message = { type: string };
type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type Handlers<
	Req extends Message,
	Res extends { [K in Req["type"]]: unknown },
> = {
	[K in Req["type"]]: (msg: Extract<Req, { type: K }>) => Promise<Res[K]>;
};

export interface Channel<
	Req extends Message,
	Res extends { [K in Req["type"]]: unknown },
> {
	is(msg: unknown): msg is Req;
	/** Sends to the background and unwraps the result (throws on error). */
	call<K extends Req["type"]>(msg: Extract<Req, { type: K }>): Promise<Res[K]>;
	/** Installs the background listener for this channel. */
	listen(handlers: Handlers<Req, Res>): void;
}

export function createChannel<
	Req extends Message,
	Res extends { [K in Req["type"]]: unknown },
>(owns: (type: string) => boolean): Channel<Req, Res> {
	const is = (msg: unknown): msg is Req =>
		typeof msg === "object" &&
		msg !== null &&
		typeof (msg as { type?: unknown }).type === "string" &&
		owns((msg as Message).type);

	return {
		is,
		async call(msg) {
			const res = (await chrome.runtime.sendMessage(msg)) as
				| Result<Res[typeof msg.type]>
				| undefined;
			if (!res) throw new Error("No response from background");
			if (!res.ok) throw new Error(res.error);
			return res.data;
		},
		listen(handlers) {
			chrome.runtime.onMessage.addListener(
				(msg: unknown, _sender, sendResponse) => {
					if (!is(msg)) return false;
					const handler = handlers[msg.type as Req["type"]] as
						| ((m: Req) => Promise<unknown>)
						| undefined;
					if (!handler) return false;
					handler(msg).then(
						(data) => sendResponse({ ok: true, data: data ?? null }),
						(err: unknown) =>
							sendResponse({
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							}),
					);
					return true;
				},
			);
		},
	};
}
