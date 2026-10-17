import type * as utils from '@iobroker/adapter-core';

import type { KitchenOwlClient } from './api';

/** Where cached photos live inside the adapter's own file storage. */
export const PHOTO_DIR = 'photos';

/**
 * Keeps a local copy of the photos KitchenOwl serves behind its API token.
 *
 * The upload endpoint answers 401 without the token, and a browser never sends
 * one for an `<img>` tag, so a visualisation cannot load a photo straight from
 * KitchenOwl. ioBroker serves an adapter's own files at `/<namespace>/<path>`,
 * which needs no token, so a copy there is loadable from anywhere.
 *
 * KitchenOwl names every upload after a UUID, so a changed photo arrives under
 * a new name. A file that is already stored is therefore already current and
 * never has to be downloaded twice.
 */
export class PhotoCache {
	/** Filenames known to be stored, so a poll costs no file system calls. */
	private readonly stored = new Set<string>();
	/** Filenames that could not be fetched, so one bad photo is not retried forever. */
	private readonly failed = new Set<string>();
	private initialised = false;

	public constructor(
		private readonly adapter: utils.AdapterInstance,
		private readonly client: KitchenOwlClient,
	) {}

	/**
	 * The path a visualisation can load a photo from, relative to the ioBroker host.
	 *
	 * @param namespace
	 */
	public static urlBase(namespace: string): string {
		return `/${namespace}/${PHOTO_DIR}/`;
	}

	/** Reads back what previous runs already downloaded. */
	private async init(): Promise<void> {
		if (this.initialised) {
			return;
		}
		this.initialised = true;

		try {
			const entries = await this.adapter.readDirAsync(this.adapter.namespace, PHOTO_DIR);
			for (const entry of entries) {
				if (!entry.isDir) {
					this.stored.add(entry.file);
				}
			}
		} catch {
			// No directory yet, which is simply an empty cache.
		}
	}

	/**
	 * Downloads the photos that are not stored yet.
	 *
	 * A photo that cannot be fetched is logged once and then left alone. Polls
	 * repeat for as long as the adapter runs, and retrying a photo the server
	 * will never hand over would warn on every one of them. Restarting the
	 * adapter tries again.
	 *
	 * @param filenames - Photos referenced by this poll
	 */
	public async store(filenames: Iterable<string>): Promise<void> {
		await this.init();

		for (const filename of new Set(filenames)) {
			if (this.stored.has(filename) || this.failed.has(filename)) {
				continue;
			}
			try {
				const bytes = await this.client.fetchPhoto(filename);
				await this.adapter.writeFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`, bytes);
				this.stored.add(filename);
				this.adapter.log.debug(`Cached photo ${filename} (${bytes.length} bytes)`);
			} catch (error) {
				this.failed.add(filename);
				this.adapter.log.warn(
					`Could not cache photo ${filename}, and will not try again until the adapter restarts: ${(error as Error).message}`,
				);
			}
		}
	}

	/**
	 * Deletes stored photos that nothing refers to any more.
	 *
	 * Only safe when the caller read everything that can carry a photo, which
	 * a tiered poll does not always do.
	 *
	 * @param referenced - Every photo this poll saw
	 */
	public async prune(referenced: Iterable<string>): Promise<number> {
		await this.init();

		const keep = new Set(referenced);
		let deleted = 0;

		for (const filename of [...this.stored]) {
			if (keep.has(filename)) {
				continue;
			}
			try {
				await this.adapter.delFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`);
				this.stored.delete(filename);
				deleted++;
			} catch (error) {
				this.adapter.log.warn(`Could not remove photo ${filename}: ${(error as Error).message}`);
			}
		}
		return deleted;
	}
}
