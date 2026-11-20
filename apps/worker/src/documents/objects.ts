import type { ObjectStore, StoredObject } from "./types";

/** R2-backed object store (binding DOCS). */
export class R2ObjectStore implements ObjectStore {
	constructor(private readonly bucket: R2Bucket) {}

	async put(key: string, data: ArrayBuffer, contentType: string) {
		await this.bucket.put(key, data, { httpMetadata: { contentType } });
	}

	async get(key: string): Promise<StoredObject | null> {
		const obj = await this.bucket.get(key);
		return obj ? { body: obj.body, size: obj.size } : null;
	}

	async delete(keys: string[]) {
		// R2 deletes up to 1000 keys per call.
		for (let i = 0; i < keys.length; i += 1000)
			await this.bucket.delete(keys.slice(i, i + 1000));
	}
}

/** In-memory object store for tests. */
export class MemoryObjectStore implements ObjectStore {
	readonly objects = new Map<string, { data: ArrayBuffer; type: string }>();

	async put(key: string, data: ArrayBuffer, contentType: string) {
		this.objects.set(key, { data: data.slice(0), type: contentType });
	}

	async get(key: string): Promise<StoredObject | null> {
		const o = this.objects.get(key);
		return o ? { body: o.data.slice(0), size: o.data.byteLength } : null;
	}

	async delete(keys: string[]) {
		for (const k of keys) this.objects.delete(k);
	}
}
