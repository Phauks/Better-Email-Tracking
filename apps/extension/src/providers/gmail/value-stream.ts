/**
 * Minimal Kefir-compatible stream. InboxSDK runs descriptors through kefir-cast, which
 * accepts any object with onAny/offAny, so we can update buttons and row images
 * without depending on Kefir directly.
 */
type KefirEvent<T> = { type: "value"; value: T } | { type: "end" };
type Listener<T> = (event: KefirEvent<T>) => void;

export class ValueStream<T> {
	private listeners = new Set<Listener<T>>();
	constructor(private current: T) {}

	onAny(fn: Listener<T>): void {
		this.listeners.add(fn);
		fn({ type: "value", value: this.current });
	}
	offAny(fn: Listener<T>): void {
		this.listeners.delete(fn);
	}
	set(value: T): void {
		this.current = value;
		for (const fn of this.listeners) fn({ type: "value", value });
	}
	end(): void {
		for (const fn of this.listeners) fn({ type: "end" });
		this.listeners.clear();
	}
}
