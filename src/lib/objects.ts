import type * as utils from '@iobroker/adapter-core';

import { localize } from './i18n';

/** A state the adapter owns, described once and reused for create and write. */
export interface StateDef {
	/** Id relative to the adapter namespace. */
	id: string;
	name: string;
	type: ioBroker.CommonType;
	/**
	 * ioBroker state role. Always something meaningful such as `value.time`,
	 * `text`, `json` or `button`; a bare `state` is rejected by the adapter
	 * checker when an adapter is submitted to the ioBroker repository.
	 */
	role: string;
	value?: ioBroker.StateValue;
	unit?: string;
	read?: boolean;
	write?: boolean;
	states?: Record<string, string>;
}

/** A channel or folder grouping states. */
export interface ChannelDef {
	id: string;
	name: string;
	type?: 'channel' | 'device' | 'folder';
	/** False for names that come from KitchenOwl and must not be translated. */
	translate?: boolean;
}

/**
 * Object definitions already applied, keyed by id, valued by their signature.
 *
 * The adapter keeps one of these across polls: a definition that has not moved
 * since the last poll needs no object database round trip at all, which takes
 * roughly a thousand reads per household out of every single poll.
 */
export type ObjectCache = Map<string, string>;

/** The object shape the writer hands to the adapter. */
interface DesiredObject {
	type: ioBroker.ObjectType;
	common: Record<string, unknown>;
	native: Record<string, unknown>;
}

/**
 * Common fields the adapter owns and keeps in line with its own definitions.
 *
 * `name` is deliberately missing: it may have been edited in the admin UI, and
 * after a restart there is no way to tell that apart from a rename upstream.
 */
const MANAGED_FIELDS = ['type', 'role', 'read', 'write', 'unit', 'states'] as const;

/**
 * Whether an existing object's adapter-owned fields match the definition.
 *
 * @param existing - Common block as the object database has it
 * @param desired - Common block this run wants
 */
function managedFieldsDiffer(existing: Record<string, unknown>, desired: Record<string, unknown>): boolean {
	return MANAGED_FIELDS.some(field => JSON.stringify(existing[field]) !== JSON.stringify(desired[field]));
}

/**
 * Collects the objects and values one poll produced, then applies them.
 *
 * Writing goes through `setStateChanged` so that an unchanged poll does not
 * churn the states database. Objects are created once and afterwards only
 * corrected where the adapter's own fields drifted, so that a role or a write
 * flag changed by an adapter update reaches installations that already have
 * the object, while a name someone edited in the admin UI survives.
 */
export class ObjectWriter {
	private readonly channels: ChannelDef[] = [];
	private readonly states: StateDef[] = [];
	/** Every id this run touched, used to find objects that disappeared upstream. */
	private readonly seen = new Set<string>();
	/** Branches this run did not read, which pruning must therefore leave alone. */
	private readonly untouched = new Set<string>();

	/**
	 * @param adapter - Adapter instance the objects belong to
	 * @param cache - Definitions already applied, shared across polls
	 */
	public constructor(
		private readonly adapter: utils.AdapterInstance,
		private readonly cache: ObjectCache = new Map(),
	) {}

	/**
	 * Declares a grouping node the adapter names itself.
	 *
	 * @param id - Namespace-relative object id
	 * @param name - Human readable name shown in the object tree
	 * @param type - Channel, device or folder
	 */
	public channel(id: string, name: string, type: ChannelDef['type'] = 'channel'): void {
		this.channels.push({ id, name, type });
		this.seen.add(id);
	}

	/**
	 * Declares a grouping node whose name comes from KitchenOwl.
	 *
	 * Such a name is stored as it is: running it through the translation table
	 * would rename a shopping list called "Items" to "Artikel".
	 *
	 * @param id - Namespace-relative object id
	 * @param name - Name as KitchenOwl returned it
	 * @param type - Channel, device or folder
	 */
	public serverChannel(id: string, name: string, type: ChannelDef['type'] = 'channel'): void {
		this.channels.push({ id, name, type, translate: false });
		this.seen.add(id);
	}

	/**
	 * Declares a state and, when the definition carries one, its value.
	 *
	 * @param def - State description to create and write
	 */
	public state(def: StateDef): void {
		this.states.push(def);
		this.seen.add(def.id);
	}

	/**
	 * Convenience for a read-only state carrying a value.
	 *
	 * @param id - Namespace-relative object id
	 * @param name - Human readable name shown in the object tree
	 * @param type - ioBroker state or channel type
	 * @param role - ioBroker state role
	 * @param value - Value to publish
	 * @param unit - Optional unit shown next to the value
	 */
	public value(
		id: string,
		name: string,
		type: ioBroker.CommonType,
		role: string,
		value: ioBroker.StateValue,
		unit?: string,
	): void {
		this.state({ id, name, type, role, value, unit, read: true, write: false });
	}

	/**
	 * Convenience for a read-only state holding a JSON document.
	 *
	 * @param id - Namespace-relative object id
	 * @param name - Human readable name shown in the object tree
	 * @param payload - Value to serialise into the state
	 */
	public json(id: string, name: string, payload: unknown): void {
		this.state({
			id,
			name,
			type: 'string',
			role: 'json',
			value: JSON.stringify(payload ?? null),
			read: true,
			write: false,
		});
	}

	/**
	 * Convenience for a writable command button.
	 *
	 * @param id - Namespace-relative object id
	 * @param name - Human readable name shown in the object tree
	 */
	public button(id: string, name: string): void {
		this.state({ id, name, type: 'boolean', role: 'button', value: undefined, read: false, write: true });
	}

	/**
	 * Declares a branch as not read this run, so pruning skips it entirely.
	 *
	 * A poll that deliberately skips the recipes or the catalog has not seen
	 * their objects, and without this the cleanup would read that as the whole
	 * branch having disappeared upstream.
	 *
	 * @param prefix - Namespace-relative prefix to leave untouched
	 */
	public keepTree(prefix: string): void {
		this.untouched.add(prefix);
	}

	/**
	 * Marks an id as still alive without writing to it, so pruning leaves it alone.
	 *
	 * @param id - Namespace-relative object id
	 */
	public keep(id: string): void {
		this.seen.add(id);
	}

	/**
	 * Whether this run already touched an id.
	 *
	 * @param id - Namespace-relative object id
	 */
	public has(id: string): boolean {
		return this.seen.has(id);
	}

	/** Creates missing objects, corrects changed ones and writes every collected value. */
	public async flush(): Promise<void> {
		for (const channel of this.channels) {
			await this.upsert(channel.id, {
				type: channel.type ?? 'channel',
				common: { name: channel.translate === false ? channel.name : localize(channel.name) },
				native: {},
			});
		}

		for (const def of this.states) {
			await this.upsert(def.id, {
				type: 'state',
				common: {
					name: localize(def.name),
					type: def.type,
					role: def.role,
					read: def.read ?? true,
					write: def.write ?? false,
					...(def.unit ? { unit: def.unit } : {}),
					...(def.states ? { states: def.states } : {}),
				},
				native: {},
			});

			// Buttons and other pure command states carry no value to publish.
			if (def.value !== undefined) {
				await this.adapter.setStateChangedAsync(def.id, { val: def.value, ack: true });
			}
		}
	}

	/**
	 * Creates an object, or brings an existing one in line with the definition.
	 *
	 * @param id - Namespace-relative object id
	 * @param desired - Object as this run wants it to look
	 */
	private async upsert(id: string, desired: DesiredObject): Promise<void> {
		const signature = JSON.stringify(desired);
		const applied = this.cache.get(id);

		if (applied === signature) {
			return;
		}

		if (applied !== undefined) {
			// An earlier poll in this run of the adapter wrote the object and the
			// definition has moved on since, a list renamed in KitchenOwl for
			// example, so the new name is this adapter's to apply.
			await this.adapter.extendObjectAsync(id, desired as ioBroker.PartialObject);
			this.cache.set(id, signature);
			return;
		}

		const existing = await this.adapter.getObjectAsync(id);
		if (!existing) {
			await this.adapter.setObjectNotExistsAsync(id, desired as ioBroker.SettableObject);
			this.cache.set(id, signature);
			return;
		}

		// The object outlived an adapter restart, so a name that differs may just
		// as well have been edited in the admin UI. The rest is the adapter's.
		if (existing.type !== desired.type || managedFieldsDiffer(existing.common, desired.common)) {
			await this.adapter.extendObjectAsync(id, {
				...desired,
				common: { ...desired.common, name: existing.common.name },
			} as ioBroker.PartialObject);
		}
		this.cache.set(id, signature);
	}

	/**
	 * Deletes objects below `prefix` that this run did not touch.
	 *
	 * This is what keeps the tree honest when a shopping list, recipe or member
	 * is removed in KitchenOwl. Only branches the adapter manages are considered.
	 *
	 * @param prefixes - Namespace-relative prefixes to prune within
	 */
	public async prune(prefixes: string[]): Promise<number> {
		const existing = await this.adapter.getAdapterObjectsAsync();
		const namespacePrefix = `${this.adapter.namespace}.`;
		const stale: string[] = [];

		for (const fullId of Object.keys(existing)) {
			if (!fullId.startsWith(namespacePrefix)) {
				continue;
			}
			const relativeId = fullId.slice(namespacePrefix.length);

			if (!prefixes.some(prefix => relativeId === prefix || relativeId.startsWith(`${prefix}.`))) {
				continue;
			}
			if (this.seen.has(relativeId)) {
				continue;
			}
			if ([...this.untouched].some(tree => relativeId === tree || relativeId.startsWith(`${tree}.`))) {
				continue;
			}
			stale.push(relativeId);
		}

		// Delete parents first: a recursive delete of a channel takes its
		// children with it, so the children below it need no second pass.
		stale.sort((a, b) => a.length - b.length);

		let deleted = 0;
		for (const id of stale) {
			// Skip anything already removed as part of a parent's recursive delete.
			if (stale.some(other => other !== id && id.startsWith(`${other}.`) && id.length > other.length)) {
				this.forget(id);
				continue;
			}
			try {
				await this.adapter.delObjectAsync(id, { recursive: true });
				this.forget(id);
				deleted++;
			} catch (error) {
				this.adapter.log.warn(`Could not delete stale object ${id}: ${(error as Error).message}`);
			}
		}

		return deleted;
	}

	/**
	 * Drops a deleted object and its children from the definition cache, so that
	 * a branch that comes back is written out again rather than assumed current.
	 *
	 * @param id - Namespace-relative object id that no longer exists
	 */
	private forget(id: string): void {
		this.cache.delete(id);
		for (const cached of this.cache.keys()) {
			if (cached.startsWith(`${id}.`)) {
				this.cache.delete(cached);
			}
		}
	}
}
