import { appendPage, type PageResult, refreshFirstPage } from "../lib/paging";

/**
 * A cursor-paginated list for dashboard views: `reload()` starts over (new filters),
 * `more()` appends the next page, `refresh()` re-reads the first page and keeps what
 * "Load more" already added (for live updates). Render with ListState + LoadMore.
 */
export class PagedList<T> {
	items = $state<T[]>([]);
	nextCursor = $state<string | undefined>(undefined);
	loading = $state(false);
	error = $state("");
	/** At least one page has arrived since the last reload. */
	loaded = $state(false);
	private firstPageSize = 0;
	/** Drops answers to superseded requests (fast typing in a search box). */
	private generation = 0;

	constructor(
		private readonly fetchPage: (cursor?: string) => Promise<PageResult<T>>,
		private readonly key: (item: T) => string,
	) {}

	get hasMore(): boolean {
		return this.nextCursor !== undefined;
	}

	async reload(): Promise<void> {
		const gen = ++this.generation;
		this.loading = true;
		this.error = "";
		try {
			const page = await this.fetchPage();
			if (gen !== this.generation) return;
			this.items = page.items;
			this.firstPageSize = page.items.length;
			this.nextCursor = page.nextCursor;
			this.loaded = true;
		} catch (err) {
			if (gen === this.generation) this.error = (err as Error).message;
		} finally {
			if (gen === this.generation) this.loading = false;
		}
	}

	async more(): Promise<void> {
		if (!this.nextCursor || this.loading) return;
		const gen = this.generation;
		this.loading = true;
		this.error = "";
		try {
			const page = await this.fetchPage(this.nextCursor);
			if (gen !== this.generation) return;
			this.items = appendPage(this.items, page.items, this.key);
			this.nextCursor = page.nextCursor;
		} catch (err) {
			if (gen === this.generation) this.error = (err as Error).message;
		} finally {
			if (gen === this.generation) this.loading = false;
		}
	}

	/** Re-reads the first page in place; rows loaded beyond it stay. */
	async refresh(): Promise<void> {
		if (!this.loaded || this.loading) return this.reload();
		const gen = this.generation;
		try {
			const page = await this.fetchPage();
			if (gen !== this.generation) return;
			const onlyFirst = this.items.length <= this.firstPageSize;
			this.items = refreshFirstPage(
				this.items,
				page.items,
				this.key,
				this.firstPageSize,
			);
			this.firstPageSize = page.items.length;
			if (onlyFirst) this.nextCursor = page.nextCursor;
			this.error = "";
		} catch (err) {
			if (gen === this.generation) this.error = (err as Error).message;
		}
	}

	/** Local edit after an action (e.g. a paused follow-up). */
	replace(item: T): void {
		const k = this.key(item);
		this.items = this.items.map((i) => (this.key(i) === k ? item : i));
	}

	remove(key: string): void {
		this.items = this.items.filter((i) => this.key(i) !== key);
	}
}
