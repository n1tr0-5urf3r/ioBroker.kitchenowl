import { expect } from 'chai';
import type * as utils from '@iobroker/adapter-core';

import type { KitchenOwlClient } from './api';
import { PHOTO_DIR, PhotoCache } from './photos';

/** Enough of an adapter to exercise the file storage calls. */
class FakeAdapter {
	public readonly namespace = 'kitchenowl.0';
	public readonly files = new Map<string, Buffer>();
	public readonly warnings: string[] = [];
	public readonly log = {
		silly: (): void => {},
		debug: (): void => {},
		info: (): void => {},
		warn: (m: string): void => {
			this.warnings.push(m);
		},
		error: (): void => {},
	};

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
 * @param failOn
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
