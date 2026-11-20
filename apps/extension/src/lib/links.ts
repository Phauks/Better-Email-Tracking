const UNSUBSCRIBE =
	/(unsubscribe|unsub|opt[-_]?out|email[-_]?preferences|manage[-_]?preferences|list-manage\.com\/(unsubscribe|profile))/i;

/** Links we never rewrite: unsubscribe/opt-out flows must stay direct. */
export function shouldTrackLink(url: string): boolean {
	return !UNSUBSCRIBE.test(url);
}
