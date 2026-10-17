/*
 * Created with @iobroker/create-adapter v3.1.5
 */

import * as utils from '@iobroker/adapter-core';

import { KitchenOwlApiError, KitchenOwlClient } from './lib/api';
import { parseCommand, runCommand } from './lib/commands';
import { connectionOptions, selectHouseholds } from './lib/instance';
import { type ObjectCache, ObjectWriter } from './lib/objects';
import {
	householdBase,
	type SyncConfig,
	syncCatalog,
	syncExpenses,
	syncHousehold,
	syncMembers,
	syncPlanner,
	syncRecipes,
	syncShoppingLists,
} from './lib/sync';
import type { Household, PlannerEntry } from './lib/types';

class Kitchenowl extends utils.Adapter {
	private client?: KitchenOwlClient;
	private pollTimer?: ioBroker.Timeout;
	private refreshTimer?: ioBroker.Timeout;
	private unloading = false;
	/** True while a poll runs, so a manual refresh cannot start a second one. */
	private polling = false;
	/** Set when a refresh arrives mid-poll, so the request is served afterwards. */
	private pollAgain = false;
	/**
	 * Object definitions already applied, kept across polls. Only a definition
	 * that actually changed costs an object database round trip.
	 */
	private readonly objectCache: ObjectCache = new Map();
	/** Last known meal plan per household, so `days.<n>.remove` can find its recipe. */
	private readonly plannerCache = new Map<number, PlannerEntry[]>();

	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'kitchenowl',
		});
		this.on('ready', this.onReady.bind(this));
		this.on('stateChange', this.onStateChange.bind(this));
		this.on('message', this.onMessage.bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		await this.setState('info.connection', false, true);

		const url = (this.config.url ?? '').trim();
		// Values listed in `encryptedNative` arrive already decrypted in this.config.
		const token = (this.config.token ?? '').trim();

		if (!url || !token) {
			this.log.error('Please configure the server URL and an API token in the instance settings.');
			await this.setState('info.lastError', 'Server URL or API token is missing', true);
			return;
		}

		this.client = new KitchenOwlClient({
			url,
			token,
			timeout: this.config.requestTimeout,
			retries: this.config.retries,
			retryDelay: this.config.retryDelay,
			rejectUnauthorized: this.config.rejectUnauthorized,
			log: message => this.log.debug(message),
		});

		await this.subscribeStatesAsync('commands.refresh');
		if (this.config.enableWrite) {
			await this.subscribeStatesAsync('households.*');
			this.log.info('Write access is enabled: writable states will change data in KitchenOwl.');
		}

		await this.poll();
	}

	/** Reads everything that is enabled and writes it into the object tree. */
	private async poll(): Promise<void> {
		if (!this.client || this.unloading) {
			return;
		}
		if (this.polling) {
			// Remember the request rather than dropping it: whatever prompted the
			// refresh may have landed after the running poll read that branch.
			this.pollAgain = true;
			return;
		}
		this.polling = true;

		try {
			const health = await this.client.health();
			await this.setStateChangedAsync('info.serverVersion', { val: health.version, ack: true });
			await this.setStateChangedAsync('info.minFrontendVersion', {
				val: health.min_frontend_version,
				ack: true,
			});

			const households = await this.householdsToSync();
			if (households.length === 0) {
				this.log.warn('No matching household was found for the configured token.');
			}

			const writer = new ObjectWriter(this, this.objectCache);
			writer.channel('households', 'Households', 'folder');

			let failed = 0;
			let lastHouseholdError = '';

			for (const household of households) {
				try {
					await this.syncOneHousehold(writer, household);
				} catch (error) {
					// A rejected token is fatal for every household, so let it through
					// instead of softening it into one warning per household.
					if (error instanceof KitchenOwlApiError && error.isAuthError) {
						throw error;
					}
					failed++;
					lastHouseholdError = `Household ${household.name} (${household.id}) could not be read: ${(error as Error).message}`;
					this.log.warn(lastHouseholdError);
				}
			}

			// One unreadable household must not cost the others their update, but
			// if none of them could be read there is nothing to report as success.
			if (failed > 0 && failed === households.length) {
				throw new Error(lastHouseholdError);
			}

			await writer.flush();

			if (this.config.deleteStaleObjects) {
				if (failed > 0) {
					// Everything below a household that failed is missing from this
					// run, and pruning would read that as deleted upstream.
					this.log.debug('Skipping the cleanup of stale objects: a household could not be read');
				} else {
					const deleted = await writer.prune(['households']);
					if (deleted > 0) {
						this.log.debug(`Removed ${deleted} object(s) that no longer exist in KitchenOwl`);
					}
				}
			}

			await this.setState('info.connection', true, true);
			await this.setState('info.lastUpdate', Date.now(), true);
			await this.setStateChangedAsync('info.lastError', { val: lastHouseholdError, ack: true });
			this.log.debug(`Poll finished for ${households.length - failed} of ${households.length} household(s)`);
		} catch (error) {
			const message = (error as Error).message;
			await this.setState('info.connection', false, true);
			await this.setStateChangedAsync('info.lastError', { val: message, ack: true });

			if (error instanceof KitchenOwlApiError && error.isAuthError) {
				this.log.error(`The API token was rejected by the server: ${message}`);
			} else {
				this.log.error(`Poll failed: ${message}`);
			}
		} finally {
			this.polling = false;

			if (this.pollAgain && !this.unloading) {
				// A refresh came in while this poll was running; serve it now.
				this.pollAgain = false;
				void this.poll();
			} else {
				this.pollAgain = false;
				this.schedulePoll();
			}
		}
	}

	/**
	 * Reads and writes every enabled branch of a single household.
	 *
	 * @param writer - Collector the states are added to
	 * @param household - Household being written
	 */
	private async syncOneHousehold(writer: ObjectWriter, household: Household): Promise<void> {
		const client = this.client!;
		const base = householdBase(household);
		const config = this.syncConfig();

		syncHousehold(writer, client, base, household);

		if (config.syncMembers) {
			syncMembers(writer, client, base, household);
		}

		if (config.syncShoppingLists) {
			syncShoppingLists(writer, base, await client.shoppingLists(household.id), config);
		}

		if (config.syncRecipes) {
			syncRecipes(writer, client, base, await client.recipes(household.id), config);
		}

		// The planner and expense branches only exist when the household enables them.
		if (config.syncPlanner && household.planner_feature) {
			const entries = await client.planner(household.id);
			this.plannerCache.set(household.id, entries);
			syncPlanner(writer, base, entries, config);
		}

		if (config.syncExpenses && household.expenses_feature) {
			// Expenses reference members by id; the names live on the household.
			const memberNames = new Map((household.member ?? []).map(member => [member.id, member.name]));
			const [expenses, categories, overview] = await Promise.all([
				client.expenses(household.id, config.expenseView, config.expensePages),
				client.expenseCategories(household.id),
				client.expenseOverview(
					household.id,
					config.expenseOverviewFrame,
					config.expenseOverviewSteps,
					config.expenseView,
				),
			]);
			syncExpenses(writer, base, expenses, categories, overview, config, memberNames);
		}

		if (config.syncCatalog) {
			const [items, categories, tags] = await Promise.all([
				client.items(household.id),
				client.categories(household.id),
				client.tags(household.id),
			]);
			syncCatalog(writer, base, items, categories, tags);
		}
	}

	/** The households to synchronise, filtered by the instance configuration. */
	private async householdsToSync(): Promise<Household[]> {
		const { selected, missing } = selectHouseholds(await this.client!.households(), this.config.householdIds);

		for (const id of missing) {
			this.log.warn(`Configured household ${id} is not visible to this token and will be skipped.`);
		}
		return selected;
	}

	private syncConfig(): SyncConfig {
		return {
			syncMembers: this.config.syncMembers,
			syncShoppingLists: this.config.syncShoppingLists,
			syncRecipes: this.config.syncRecipes,
			syncPlanner: this.config.syncPlanner,
			syncExpenses: this.config.syncExpenses,
			syncCatalog: this.config.syncCatalog,
			createRecipeObjects: this.config.createRecipeObjects,
			createShoppingItemObjects: this.config.createShoppingItemObjects,
			enableWrite: this.config.enableWrite,
			expenseOverviewFrame: this.config.expenseOverviewFrame,
			expenseOverviewSteps: this.config.expenseOverviewSteps,
			expenseView: this.config.expenseView,
			expensePages: this.config.expensePages,
		};
	}

	/** Arms the next poll, unless the adapter is shutting down. */
	private schedulePoll(): void {
		if (this.unloading) {
			return;
		}
		const interval = Math.max(30, this.config.pollInterval || 300) * 1000;
		// Returns undefined once unload has started, so do not assume a handle.
		this.pollTimer = this.setTimeout(() => {
			this.pollTimer = undefined;
			void this.poll();
		}, interval);
	}

	/**
	 * Is called if a subscribed state changes
	 *
	 * @param id - State ID
	 * @param state - State object
	 */
	private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
		// Only unacknowledged values are commands; our own writes carry ack=true.
		if (!state || state.ack) {
			return;
		}

		const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;

		if (relativeId === 'commands.refresh') {
			this.log.info('Manual refresh requested');
			void this.setState(relativeId, { val: true, ack: true });
			void this.refreshNow();
			return;
		}

		void this.handleWrite(relativeId, state);
	}

	/**
	 * Runs a write command and re-reads the data afterwards.
	 *
	 * @param relativeId - State id without the adapter namespace
	 * @param state - The state that changed
	 */
	private async handleWrite(relativeId: string, state: ioBroker.State): Promise<void> {
		if (!this.config.enableWrite || !this.client) {
			return;
		}

		const command = parseCommand(relativeId);
		if (!command) {
			return;
		}

		try {
			const result = await runCommand(
				{ client: this.client, log: this.log },
				command,
				state.val,
				(householdId, day) => {
					const entry = this.plannerCache.get(householdId)?.find(candidate => candidate.day === day);
					return entry ? { recipeId: entry.recipe_id, cookingDate: entry.cooking_date ?? null } : undefined;
				},
			);
			this.log.info(`Command ${command.kind} succeeded for household ${command.householdId}`);

			// The import is the one command with something to hand back.
			if (command.kind === 'recipes.scrapeUrl') {
				await this.setState(`households.${command.householdId}.recipes.scrapeResult`, {
					val: JSON.stringify(result ?? null),
					ack: true,
				});
			}

			// Acknowledge so the state reflects that the command was carried out.
			await this.setState(relativeId, { val: state.val, ack: true });
			this.scheduleRefresh();
		} catch (error) {
			this.log.error(`Command ${command.kind} failed: ${(error as Error).message}`);
			await this.setStateChangedAsync('info.lastError', { val: (error as Error).message, ack: true });
		}
	}

	/** Re-reads the server shortly after a write, so the tree catches up. */
	private scheduleRefresh(): void {
		if (this.unloading || this.refreshTimer) {
			return;
		}
		const delay = Math.max(0, this.config.writeRefreshDelay ?? 1500);
		this.refreshTimer = this.setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refreshNow();
		}, delay);
	}

	/**
	 * Cancels the pending poll and runs one immediately.
	 *
	 * Returns what happened, so that a caller waiting on the message box is not
	 * told the data is current when the poll has yet to start.
	 */
	private async refreshNow(): Promise<string> {
		if (this.polling) {
			this.pollAgain = true;
			return 'A poll is already running; another one follows right after it';
		}

		if (this.pollTimer) {
			this.clearTimeout(this.pollTimer);
			this.pollTimer = undefined;
		}
		await this.poll();
		return 'Refresh finished';
	}

	/**
	 * Some message was sent to this instance over message box.
	 * Requires "common.messagebox" to be true in io-package.json.
	 *
	 * @param obj - The incoming message
	 */
	private async onMessage(obj: ioBroker.Message): Promise<void> {
		if (typeof obj !== 'object' || !obj.command) {
			return;
		}

		const respond = (payload: unknown): void => {
			if (obj.callback) {
				this.sendTo(obj.from, obj.command, payload as ioBroker.MessagePayload, obj.callback);
			}
		};

		try {
			switch (obj.command) {
				case 'getHouseholds': {
					// Called by the admin UI before the instance is configured, so it
					// builds a throwaway client from the values typed into the form.
					const client = this.clientFromMessage(obj.message);
					try {
						const households = await client.households();
						respond(
							households.map(household => ({
								value: String(household.id),
								label: household.name,
							})),
						);
					} finally {
						await client.destroy();
					}
					return;
				}

				case 'testConnection': {
					const client = this.clientFromMessage(obj.message);
					try {
						const health = await client.health();
						const households = await client.households();
						respond({
							result: `Connected. Server version ${health.version}, ${households.length} household(s) available: ${households
								.map(household => household.name)
								.join(', ')}`,
						});
					} finally {
						await client.destroy();
					}
					return;
				}

				case 'refresh':
					respond({ result: await this.refreshNow() });
					return;

				default:
					respond({ error: `Unknown command: ${obj.command}` });
			}
		} catch (error) {
			this.log.warn(`Message ${obj.command} failed: ${(error as Error).message}`);
			respond({ error: (error as Error).message });
		}
	}

	/**
	 * Builds a client from a message payload, falling back to the saved config.
	 *
	 * @param message - Payload sent with the message
	 */
	private clientFromMessage(message: unknown): KitchenOwlClient {
		const options = connectionOptions(message, this.config);

		return new KitchenOwlClient({
			...options,
			// One attempt is enough while someone waits in front of the admin UI.
			retries: 0,
			log: text => this.log.debug(text),
		});
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 *
	 * @param callback - Callback function
	 */
	private onUnload(callback: () => void): void {
		try {
			this.unloading = true;

			if (this.pollTimer) {
				this.clearTimeout(this.pollTimer);
				this.pollTimer = undefined;
			}
			if (this.refreshTimer) {
				this.clearTimeout(this.refreshTimer);
				this.refreshTimer = undefined;
			}

			void this.client?.destroy();
			this.client = undefined;

			callback();
		} catch (error) {
			this.log.error(`Error during unloading: ${(error as Error).message}`);
			callback();
		}
	}
}

if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Kitchenowl(options);
} else {
	// otherwise start the instance directly
	(() => new Kitchenowl())();
}
