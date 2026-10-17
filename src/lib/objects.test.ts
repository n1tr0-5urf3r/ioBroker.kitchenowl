import { expect } from 'chai';
import type * as utils from '@iobroker/adapter-core';

import { type ObjectCache, ObjectWriter } from './objects';

/** A stored object, kept loose so tests can read `common` without narrowing. */
export interface StoredObject {
	type: string;
	common: Record<string, unknown>;
	native: unknown;
}

/** The value wrapper `setStateChangedAsync` receives. */
export interface StoredState {
	val: ioBroker.StateValue;
}

/** The options `delObjectAsync` understands. */
export interface DeleteOptions {
	recursive?: boolean;
}

/** Minimal in-memory stand-in for the parts of the adapter ObjectWriter touches. */
export class FakeAdapter {
	public readonly namespace = 'kitchenowl.0';
	public readonly objects = new Map<string, StoredObject>();
	public readonly states = new Map<string, ioBroker.StateValue>();
	public readonly warnings: string[] = [];
	/** Ids read back from the object database, to show what the cache saves. */
	public readonly reads: string[] = [];
	/** Ids whose definition was corrected. */
	public readonly extended: string[] = [];
	public readonly log = {
		silly: (): void => {},
		debug: (): void => {},
		info: (): void => {},
		warn: (message: string): void => {
			this.warnings.push(message);
		},
		error: (): void => {},
	};

	/**
	 * @param id - Namespace-relative object id
	 * @param obj - Object to store
	 */
	public setObjectNotExistsAsync(id: string, obj: unknown): Promise<void> {
		if (!this.objects.has(id)) {
			this.objects.set(id, obj as StoredObject);
		}
		return Promise.resolve();
	}

	/**
	 * @param id - Namespace-relative object id
	 */
	public getObjectAsync(id: string): Promise<StoredObject | null> {
		this.reads.push(id);
		return Promise.resolve(this.objects.get(id) ?? null);
	}

	/**
	 * Merges into the stored object, the way js-controller does.
	 *
	 * @param id - Namespace-relative object id
	 * @param obj - Partial object whose common block is merged in
	 */
	public extendObjectAsync(id: string, obj: StoredObject): Promise<void> {
		const existing = this.objects.get(id);
		if (!existing) {
			this.objects.set(id, obj);
		} else {
			this.objects.set(id, {
				...existing,
				...obj,
				common: { ...existing.common, ...obj.common },
			});
		}
		this.extended.push(id);
		return Promise.resolve();
	}

	/**
	 * @param id - Namespace-relative state id
	 * @param state - Wrapper carrying the value to store
	 */
	public setStateChangedAsync(id: string, state: StoredState): Promise<void> {
		this.states.set(id, state.val);
		return Promise.resolve();
	}

	/** Mimics the real call, which returns fully namespaced ids. */
	public getAdapterObjectsAsync(): Promise<Record<string, unknown>> {
		return Promise.resolve(Object.fromEntries([...this.objects.keys()].map(id => [`${this.namespace}.${id}`, {}])));
	}

	/**
	 * @param id - Namespace-relative object id
	 * @param options - Delete options, notably `recursive`
	 */
	public delObjectAsync(id: string, options?: DeleteOptions): Promise<void> {
		this.objects.delete(id);
		if (options?.recursive) {
			for (const key of [...this.objects.keys()]) {
				if (key.startsWith(`${id}.`)) {
					this.objects.delete(key);
				}
			}
		}
		return Promise.resolve();
	}

	/** Casts to the adapter type the production code expects. */
	public asAdapter(): utils.AdapterInstance {
		return this as unknown as utils.AdapterInstance;
	}
}

describe('ObjectWriter', () => {
	let adapter: FakeAdapter;
	let writer: ObjectWriter;

	beforeEach(() => {
		adapter = new FakeAdapter();
		writer = new ObjectWriter(adapter.asAdapter());
	});

	it('creates channels and states and publishes their values', async () => {
		writer.channel('households', 'Households', 'folder');
		writer.value('households.1.name', 'Name', 'string', 'text', 'Example Household');
		await writer.flush();

		expect(adapter.objects.get('households')?.type).to.equal('folder');
		expect(adapter.objects.get('households.1.name')?.common).to.deep.include({
			name: { en: 'Name', de: 'Name' },
			type: 'string',
			role: 'text',
			read: true,
			write: false,
		});
		expect(adapter.states.get('households.1.name')).to.equal('Example Household');
	});

	it('localizes names that have a German translation and passes others through', async () => {
		writer.channel('households.1', 'Example Household', 'device');
		writer.value('households.1.expenses.count', 'Number of expenses read', 'number', 'value', 3);
		await writer.flush();

		// A name that comes from KitchenOwl itself stays as it is.
		expect(adapter.objects.get('households.1')?.common.name).to.equal('Example Household');
		expect(adapter.objects.get('households.1.expenses.count')?.common.name).to.deep.equal({
			en: 'Number of expenses read',
			de: 'Anzahl der gelesenen Ausgaben',
		});
	});

	it('serialises JSON states', async () => {
		writer.json('households.1.json', 'Raw', { a: [1, 2] });
		await writer.flush();

		expect(adapter.states.get('households.1.json')).to.equal('{"a":[1,2]}');
	});

	it('creates buttons as write-only states without a value', async () => {
		writer.button('commands.refresh', 'Refresh');
		await writer.flush();

		expect(adapter.objects.get('commands.refresh')?.common).to.include({
			role: 'button',
			read: false,
			write: true,
		});
		expect(adapter.states.has('commands.refresh')).to.equal(false);
	});

	it('attaches a unit only when one was given', async () => {
		writer.value('a', 'A', 'number', 'value', 1, 'min');
		writer.value('b', 'B', 'number', 'value', 2);
		await writer.flush();

		expect(adapter.objects.get('a')?.common).to.have.property('unit', 'min');
		expect(adapter.objects.get('b')?.common).to.not.have.property('unit');
	});

	it('never overwrites an object a user has edited', async () => {
		writer.value('households.1.name', 'Name', 'string', 'text', 'First');
		await writer.flush();
		adapter.objects.get('households.1.name')!.common.name = 'Renamed by user';

		const second = new ObjectWriter(adapter.asAdapter());
		second.value('households.1.name', 'Name', 'string', 'text', 'Second');
		await second.flush();

		expect(adapter.objects.get('households.1.name')?.common.name).to.equal('Renamed by user');
		// The value still updates, only the object definition is left alone.
		expect(adapter.states.get('households.1.name')).to.equal('Second');
	});

	it("corrects the adapter's own fields on an object that already exists", async () => {
		writer.state({ id: 'households.1.items.7.description', name: 'Description', type: 'string', role: 'text' });
		await writer.flush();
		expect(adapter.objects.get('households.1.items.7.description')?.common.write).to.equal(false);

		// What turning on write access does to the very same state.
		const second = new ObjectWriter(adapter.asAdapter());
		second.state({
			id: 'households.1.items.7.description',
			name: 'Description',
			type: 'string',
			role: 'text',
			read: true,
			write: true,
		});
		await second.flush();

		expect(adapter.objects.get('households.1.items.7.description')?.common.write).to.equal(true);
	});

	it('adds a states mapping that a later adapter version introduced', async () => {
		writer.state({ id: 'households.1.recipes.9.visibility', name: 'Visibility', type: 'number', role: 'value' });
		await writer.flush();

		const second = new ObjectWriter(adapter.asAdapter());
		second.state({
			id: 'households.1.recipes.9.visibility',
			name: 'Visibility',
			type: 'number',
			role: 'value',
			states: { 0: 'private', 1: 'link', 2: 'public' },
		});
		await second.flush();

		expect(adapter.objects.get('households.1.recipes.9.visibility')?.common.states).to.deep.equal({
			0: 'private',
			1: 'link',
			2: 'public',
		});
	});

	it('keeps names that come from KitchenOwl out of the translation table', async () => {
		writer.serverChannel('households.1.shoppingLists.2', 'Items');
		writer.channel('households.1.shoppingLists.2.items', 'Items');
		await writer.flush();

		expect(adapter.objects.get('households.1.shoppingLists.2')?.common.name).to.equal('Items');
		expect(adapter.objects.get('households.1.shoppingLists.2.items')?.common.name).to.deep.equal({
			en: 'Items',
			de: 'Artikel',
		});
	});

	describe('with a cache shared across polls', () => {
		let cache: ObjectCache;

		beforeEach(() => {
			cache = new Map();
		});

		/**
		 * One poll's worth of writes against the shared cache.
		 *
		 * @param name - Name the server reports for the list this poll
		 */
		const poll = async (name: string): Promise<void> => {
			const run = new ObjectWriter(adapter.asAdapter(), cache);
			run.serverChannel('households.1.shoppingLists.2', name);
			run.value('households.1.shoppingLists.2.itemCount', 'Number of items', 'number', 'value', 3);
			await run.flush();
		};

		it('reads an object once and leaves the database alone afterwards', async () => {
			await poll('Groceries');
			const afterFirst = adapter.reads.length;
			await poll('Groceries');

			expect(afterFirst).to.be.greaterThan(0);
			expect(adapter.reads.length).to.equal(afterFirst);
			// Values are still published on every poll.
			expect(adapter.states.get('households.1.shoppingLists.2.itemCount')).to.equal(3);
		});

		it('follows a list renamed in KitchenOwl', async () => {
			await poll('Groceries');
			await poll('Weekly shop');

			expect(adapter.objects.get('households.1.shoppingLists.2')?.common.name).to.equal('Weekly shop');
		});
	});

	describe('prune', () => {
		it('removes objects the current run did not touch', async () => {
			writer.channel('households.1', 'One');
			writer.value('households.1.name', 'Name', 'string', 'text', 'One');
			writer.channel('households.2', 'Two');
			writer.value('households.2.name', 'Name', 'string', 'text', 'Two');
			await writer.flush();

			const second = new ObjectWriter(adapter.asAdapter());
			second.channel('households.1', 'One');
			second.value('households.1.name', 'Name', 'string', 'text', 'One');
			await second.flush();
			const deleted = await second.prune(['households']);

			expect(deleted).to.equal(1);
			expect(adapter.objects.has('households.1.name')).to.equal(true);
			expect(adapter.objects.has('households.2')).to.equal(false);
			expect(adapter.objects.has('households.2.name')).to.equal(false);
		});

		it('leaves branches outside the given prefixes alone', async () => {
			writer.value('info.connection', 'Connected', 'boolean', 'indicator.connected', true);
			writer.channel('households.1', 'One');
			await writer.flush();

			const second = new ObjectWriter(adapter.asAdapter());
			await second.flush();
			await second.prune(['households']);

			expect(adapter.objects.has('info.connection')).to.equal(true);
			expect(adapter.objects.has('households.1')).to.equal(false);
		});

		it('deletes a whole subtree with one recursive call', async () => {
			writer.channel('households.1', 'One');
			writer.channel('households.1.recipes', 'Recipes');
			writer.value('households.1.recipes.9.name', 'Name', 'string', 'text', 'Soup');
			await writer.flush();

			const second = new ObjectWriter(adapter.asAdapter());
			const deleted = await second.prune(['households']);

			// Only the top of the subtree is deleted; the children go with it.
			expect(deleted).to.equal(1);
			expect(adapter.objects.size).to.equal(0);
		});

		it('recreates an object that was pruned and later came back', async () => {
			// The cache is what makes a poll cheap, so a delete has to clear it:
			// otherwise the writer still believes the object is in the database
			// and silently skips recreating a list that reappears in KitchenOwl.
			const cache = new Map<string, string>();

			const pollWith = async (listIds: number[]): Promise<void> => {
				const run = new ObjectWriter(adapter.asAdapter(), cache);
				run.channel('households.1', 'One');
				for (const listId of listIds) {
					run.serverChannel(`households.1.shoppingLists.${listId}`, `List ${listId}`);
					run.value(
						`households.1.shoppingLists.${listId}.itemCount`,
						'Number of items',
						'number',
						'value',
						listId,
					);
				}
				await run.flush();
				await run.prune(['households']);
			};

			await pollWith([1, 2]);
			expect(adapter.objects.has('households.1.shoppingLists.2')).to.equal(true);

			// List 2 disappears upstream and is pruned.
			await pollWith([1]);
			expect(adapter.objects.has('households.1.shoppingLists.2')).to.equal(false);
			expect(adapter.objects.has('households.1.shoppingLists.2.itemCount')).to.equal(false);

			// It comes back, so both the channel and its state must exist again.
			await pollWith([1, 2]);
			expect(adapter.objects.has('households.1.shoppingLists.2')).to.equal(true);
			expect(adapter.objects.has('households.1.shoppingLists.2.itemCount')).to.equal(true);
			expect(adapter.states.get('households.1.shoppingLists.2.itemCount')).to.equal(2);
		});

		it('leaves a branch alone that the poll deliberately skipped', async () => {
			// A tiered poll does not read the recipes every time. Without
			// keepTree the cleanup would see the whole branch missing from this
			// run and delete it, then the next slow poll would rebuild it.
			writer.channel('households.1', 'One');
			writer.channel('households.1.recipes', 'Recipes');
			writer.value('households.1.recipes.20.name', 'Name', 'string', 'text', 'Tomato Soup');
			await writer.flush();

			const skipped = new ObjectWriter(adapter.asAdapter());
			skipped.channel('households.1', 'One');
			skipped.keepTree('households.1.recipes');
			await skipped.flush();
			const deleted = await skipped.prune(['households']);

			expect(deleted).to.equal(0);
			expect(adapter.objects.has('households.1.recipes.20.name')).to.equal(true);
		});

		it('still prunes inside a branch once it is read again', async () => {
			writer.channel('households.1', 'One');
			writer.channel('households.1.recipes', 'Recipes');
			writer.value('households.1.recipes.20.name', 'Name', 'string', 'text', 'Tomato Soup');
			await writer.flush();

			const read = new ObjectWriter(adapter.asAdapter());
			read.channel('households.1', 'One');
			read.channel('households.1.recipes', 'Recipes');
			await read.flush();
			await read.prune(['households']);

			expect(adapter.objects.has('households.1.recipes.20.name')).to.equal(false);
		});

		it('keeps ids that were explicitly marked as still alive', async () => {
			writer.value('households.1.recipes.scrapeResult', 'Result', 'string', 'json', '{}');
			await writer.flush();

			const second = new ObjectWriter(adapter.asAdapter());
			second.channel('households.1', 'One');
			second.channel('households.1.recipes', 'Recipes');
			second.keep('households.1.recipes.scrapeResult');
			await second.flush();
			await second.prune(['households']);

			expect(adapter.objects.has('households.1.recipes.scrapeResult')).to.equal(true);
		});
	});
});
