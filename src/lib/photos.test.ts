import { expect } from 'chai';
import type * as utils from '@iobroker/adapter-core';

import type { KitchenOwlClient } from './api';
import { initNames } from './i18n';
import { ADMIN_DIR } from './i18n.test';
import { PHOTO_DIR, PhotoCache } from './photos';

/** Enough of an adapter to exercise the file storage calls. */
class FakeAdapter {
	public readonly namespace = 'kitchenowl.0';
	public readonly files = new Map<string, Buffer>();
	public readonly warnings: string[] = [];
	/** Ids a meta object was created for, so the HTTP side can be checked. */
	public readonly metaObjects: string[] = [];
	/** The name each meta object was given, so its translations can be checked. */
	public readonly metaNames = new Map<string, ioBroker.StringOrTranslated>();
	public readonly log = {
		silly: (): void => {},
		debug: (): void => {},
		info: (): void => {},
		warn: (m: string): void => {
			this.warnings.push(m);
		},
		error: (): void => {},
	};

	public setForeignObjectNotExistsAsync(
		id: string,
		obj: { type: string; common?: { name?: ioBroker.StringOrTranslated } },
	): Promise<void> {
		if (obj.type === 'meta') {
			this.metaObjects.push(id);
			if (obj.common?.name !== undefined) {
				this.metaNames.set(id, obj.common.name);
			}
		}
		return Promise.resolve();
	}

	public readDirAsync(_ns: string, dir: string): Promise<{ file: string; isDir: boolean }[]> {
		const prefix = `${dir}/`;
		const entries = [...this.files.keys()]
			.filter(k => k.startsWith(prefix))
			.map(k => ({ file: k.slice(prefix.length), isDir: false }));
		if (entries.length === 0) {
			return Promise.reject(new Error('Not exists'));
		}
		return Promise.resolve(entries);
	}

	public writeFileAsync(_ns: string, path: string, data: Buffer): Promise<void> {
		this.files.set(path, data);
		return Promise.resolve();
	}

	public delFileAsync(_ns: string, path: string): Promise<void> {
		this.files.delete(path);
		return Promise.resolve();
	}

	public asAdapter(): utils.AdapterInstance {
		return this as unknown as utils.AdapterInstance;
	}
}

/**
 * A client that records what it was asked to download.
 *
 * @param failOn - Filenames the fake server refuses to hand over
 */
function fakeClient(failOn: string[] = []): { fetched: string[]; client: KitchenOwlClient } {
	const fetched: string[] = [];
	const client = {
		fetchPhoto(filename: string): Promise<Buffer> {
			fetched.push(filename);
			if (failOn.includes(filename)) {
				return Promise.reject(new Error('404'));
			}
			return Promise.resolve(Buffer.from(`bytes of ${filename}`));
		},
	} as unknown as KitchenOwlClient;
	return { fetched, client };
}

describe('PhotoCache', () => {
	let adapter: FakeAdapter;

	beforeEach(() => {
		adapter = new FakeAdapter();
	});

	it('publishes a path that needs no token', () => {
		// ioBroker serves an adapter's own files at /<namespace>/<path>.
		expect(PhotoCache.urlBase('kitchenowl.0')).to.equal('/kitchenowl.0/photos/');
	});

	it('downloads a photo once and keeps it', async () => {
		const { fetched, client } = fakeClient();
		const cache = new PhotoCache(adapter.asAdapter(), client);

		await cache.store(['a.jpg', 'b.jpg']);
		await cache.store(['a.jpg', 'b.jpg']);

		// KitchenOwl names uploads after a UUID, so a stored file is current.
		expect(fetched).to.deep.equal(['a.jpg', 'b.jpg']);
		expect([...adapter.files.keys()]).to.deep.equal([`${PHOTO_DIR}/a.jpg`, `${PHOTO_DIR}/b.jpg`]);
	});

	it('does not re-download on later polls that see the same photos', async () => {
		const { fetched, client } = fakeClient();
		const cache = new PhotoCache(adapter.asAdapter(), client);
		const recipePhotos = ['r1.jpg', 'r2.jpg', 'r3.jpg'];

		// Ten polls, three of which read the recipes again.
		for (let poll = 0; poll < 10; poll++) {
			await cache.store(poll % 3 === 0 ? recipePhotos : ['household.jpg']);
		}

		// Each distinct photo is fetched exactly once, however often it is seen.
		expect(fetched.sort()).to.deep.equal(['household.jpg', 'r1.jpg', 'r2.jpg', 'r3.jpg']);
	});

	it('survives a photo it cannot fetch', async () => {
		const { client } = fakeClient(['gone.jpg']);
		const cache = new PhotoCache(adapter.asAdapter(), client);

		await cache.store(['gone.jpg', 'fine.jpg']);

		// A missing picture must not cost the poll everything else.
		expect(adapter.files.has(`${PHOTO_DIR}/fine.jpg`)).to.equal(true);
		expect(adapter.warnings.join(' ')).to.contain('gone.jpg');
	});

	it('gives up on a photo it cannot fetch instead of retrying every poll', async () => {
		const { fetched, client } = fakeClient(['gone.jpg']);
		const cache = new PhotoCache(adapter.asAdapter(), client);

		for (let poll = 0; poll < 5; poll++) {
			await cache.store(['gone.jpg']);
		}

		// Otherwise a photo the server will never hand over warns once a minute
		// for as long as the adapter runs.
		expect(fetched).to.deep.equal(['gone.jpg']);
		expect(adapter.warnings).to.have.lengthOf(1);
	});

	it('tries a failed photo again later instead of writing it off until a restart', async () => {
		const failing = ['gone.jpg'];
		const fetched: string[] = [];
		const client = {
			fetchPhoto(filename: string): Promise<Buffer> {
				fetched.push(filename);
				return failing.includes(filename)
					? Promise.reject(new Error('502 Bad Gateway'))
					: Promise.resolve(Buffer.from('bytes'));
			},
		} as unknown as KitchenOwlClient;
		const cache = new PhotoCache(adapter.asAdapter(), client);

		// One bad gateway while the KitchenOwl container restarts.
		await cache.store(['gone.jpg']);
		expect(fetched).to.have.lengthOf(1);

		// The server recovers, and the wait runs out without the adapter restarting.
		failing.length = 0;
		for (let poll = 0; poll < 12; poll++) {
			await cache.store(['gone.jpg']);
		}

		expect(adapter.files.has(`${PHOTO_DIR}/gone.jpg`)).to.equal(true);
		// Tried again, but nowhere near once a poll.
		expect(fetched.length).to.be.greaterThan(1).and.lessThan(5);
	});

	it('repeats a failure quietly, so one unreachable photo does not fill the log', async () => {
		const { client } = fakeClient(['gone.jpg']);
		const cache = new PhotoCache(adapter.asAdapter(), client);

		for (let poll = 0; poll < 40; poll++) {
			await cache.store(['gone.jpg']);
		}

		// Several attempts over forty polls, but only the first one is a warning.
		expect(adapter.warnings).to.have.lengthOf(1);
	});

	it('creates the meta object ioBroker needs to serve the files over HTTP', async () => {
		const { client } = fakeClient();

		await new PhotoCache(adapter.asAdapter(), client).store(['a.jpg']);

		// Without it the copies exist but no visualisation can load them.
		expect(adapter.metaObjects).to.deep.equal(['kitchenowl.0']);
	});

	it('names the meta object in every language ioBroker asks for', async () => {
		// It is created outside the ObjectWriter, so the sweep over the synced
		// objects never sees it and it has to be checked on its own.
		initNames(ADMIN_DIR);
		const { client } = fakeClient();

		await new PhotoCache(adapter.asAdapter(), client).store(['a.jpg']);

		const name = adapter.metaNames.get('kitchenowl.0') as Record<string, string>;
		expect(name).to.be.an('object');
		for (const language of ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn']) {
			expect(name, `missing ${language}`).to.have.property(language);
		}
	});

	it('picks up what an earlier run already downloaded', async () => {
		adapter.files.set(`${PHOTO_DIR}/old.jpg`, Buffer.from('x'));
		const { fetched, client } = fakeClient();

		await new PhotoCache(adapter.asAdapter(), client).store(['old.jpg', 'new.jpg']);

		expect(fetched).to.deep.equal(['new.jpg']);
	});

	it('removes copies nothing refers to any more', async () => {
		const { client } = fakeClient();
		const cache = new PhotoCache(adapter.asAdapter(), client);
		await cache.store(['keep.jpg', 'drop.jpg']);

		const deleted = await cache.prune(['keep.jpg']);

		expect(deleted).to.equal(1);
		expect(adapter.files.has(`${PHOTO_DIR}/keep.jpg`)).to.equal(true);
		expect(adapter.files.has(`${PHOTO_DIR}/drop.jpg`)).to.equal(false);
	});
});
