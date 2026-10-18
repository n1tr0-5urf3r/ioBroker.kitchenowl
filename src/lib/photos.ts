import type * as utils from '@iobroker/adapter-core';

import type { KitchenOwlClient } from './api';
import { localize } from './i18n';

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
	/**
	 * Polls a photo that could not be fetched is left alone for.
	 *
	 * Long enough that a server which will never hand it over is not asked on
	 * every poll, short enough that a photo lost to one timeout comes back
	 * without restarting the adapter.
	 */
	private static readonly RETRY_AFTER_POLLS = 10;

	/** Filenames known to be stored, so a poll costs no file system calls. */
	private readonly stored = new Set<string>();
	/** Filenames that could not be fetched, each with the polls left before another try. */
	private readonly waiting = new Map<string, number>();
	/** Filenames that failed at least once, so the repeat is logged more quietly. */
	private readonly everFailed = new Set<string>();
	private initialised = false;

	/**
	 * @param adapter - Adapter instance whose file storage the copies live in
	 * @param client - Client the photos are downloaded through
	 */
	public constructor(
		private readonly adapter: utils.AdapterInstance,
		private readonly client: KitchenOwlClient,
	) {}

	/**
	 * The path a visualisation can load a photo from, relative to the ioBroker host.
	 *
	 * @param namespace - Adapter namespace, e.g. `kitchenowl.0`
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

		// ioBroker serves an adapter's files over HTTP only once a meta object
		// carries them, and without one the copies exist but no visualisation
		// can load them, which is the whole point of keeping them.
		try {
			await this.adapter.setForeignObjectNotExistsAsync(this.adapter.namespace, {
				type: 'meta',
				common: { name: localize('Cached KitchenOwl photos'), type: 'meta.user' },
				native: {},
			});
		} catch (error) {
			this.adapter.log.warn(`Could not prepare the photo storage: ${(error as Error).message}`);
		}

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
	 * A photo that cannot be fetched is left alone for a while rather than
	 * retried on every poll, which for a picture the server will never hand
	 * over would warn once a poll interval for as long as the adapter runs.
	 * The wait expires on its own, so a photo lost to one timeout returns
	 * without a restart, and only the first failure is a warning.
	 *
	 * @param filenames - Photos referenced by this poll
	 */
	public async store(filenames: Iterable<string>): Promise<void> {
		await this.init();

		for (const [filename, polls] of this.waiting) {
			if (polls <= 1) {
				this.waiting.delete(filename);
			} else {
				this.waiting.set(filename, polls - 1);
			}
		}

		for (const filename of new Set(filenames)) {
			if (this.stored.has(filename) || this.waiting.has(filename)) {
				continue;
			}
			try {
				const bytes = await this.client.fetchPhoto(filename);
				await this.adapter.writeFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`, bytes);
				this.stored.add(filename);
				this.waiting.delete(filename);
				this.everFailed.delete(filename);
				this.adapter.log.debug(`Cached photo ${filename} (${bytes.length} bytes)`);
			} catch (error) {
				this.waiting.set(filename, PhotoCache.RETRY_AFTER_POLLS);
				const message = `Could not cache photo ${filename}, and will try again in ${PhotoCache.RETRY_AFTER_POLLS} polls: ${(error as Error).message}`;
				// Only the first failure is news; the repeats are the same photo.
				if (this.everFailed.has(filename)) {
					this.adapter.log.debug(message);
				} else {
					this.everFailed.add(filename);
					this.adapter.log.warn(message);
				}
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
