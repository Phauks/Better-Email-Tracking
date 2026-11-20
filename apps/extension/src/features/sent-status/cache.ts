import type { ThreadStatus, ThreadStatusResponse } from "@bet/shared";

const MAX_BATCH = 100;

/**
 * Batches thread-status lookups (one request per tick for all rows that appeared) and
 * caches answers, including "not tracked", for ttlMs.
 */
export class ThreadStatusCache {
	private cache = new Map<string, { value: ThreadStatus | null; at: number }>();
	private waiting = new Map<string, ((v: ThreadStatus | null) => void)[]>();
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly fetchStatuses: (
			ids: string[],
		) => Promise<ThreadStatusResponse>,
		private readonly ttlMs = 60_000,
		private readonly delayMs = 100,
		private readonly now: () => number = Date.now,
	) {}

	get(threadId: string): Promise<ThreadStatus | null> {
		const hit = this.cache.get(threadId);
		if (hit && this.now() - hit.at < this.ttlMs)
			return Promise.resolve(hit.value);
		return new Promise((resolve) => {
			const list = this.waiting.get(threadId);
			if (list) list.push(resolve);
			else this.waiting.set(threadId, [resolve]);
			this.schedule();
		});
	}

	invalidate(): void {
		this.cache.clear();
	}

	private schedule(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.delayMs);
	}

	private async flush(): Promise<void> {
		const ids = [...this.waiting.keys()].slice(0, MAX_BATCH);
		const resolvers = ids.map(
			(id) => [id, this.waiting.get(id) ?? []] as const,
		);
		for (const id of ids) this.waiting.delete(id);
		if (this.waiting.size > 0) this.schedule();
		let threads: Record<string, ThreadStatus> = {};
		try {
			threads = (await this.fetchStatuses(ids)).threads ?? {};
		} catch (err) {
			console.warn("[bet] thread-status failed", err);
			for (const [, list] of resolvers) for (const r of list) r(null);
			return; // don't cache failures
		}
		const at = this.now();
		for (const [id, list] of resolvers) {
			const value = threads[id] ?? null;
			this.cache.set(id, { value, at });
			for (const r of list) r(value);
		}
	}
}
