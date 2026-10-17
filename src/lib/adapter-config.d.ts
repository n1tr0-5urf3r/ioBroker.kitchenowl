// This file extends the AdapterConfig type from "@iobroker/types"
//
// The shape here must stay in sync with the `native` block of io-package.json.
// It is written out rather than derived from the JSON so that the enum-like
// numeric options and the string array keep useful types.

import type { ExpenseFrame, ExpenseView } from './types';

declare global {
	namespace ioBroker {
		interface AdapterConfig {
			/** Base URL of the KitchenOwl instance, without a trailing /api. */
			url: string;
			/** Long-lived API token. Listed in `encryptedNative`, so it arrives decrypted. */
			token: string;
			rejectUnauthorized: boolean;
			requestTimeout: number;
			retries: number;
			retryDelay: number;

			/** Household ids to synchronise. Empty means every visible household. */
			householdIds: string[];
			pollInterval: number;
			/** Read recipes and the item catalog only every Nth poll; 1 means every poll. */
			slowPollFactor: number;

			syncMembers: boolean;
			syncShoppingLists: boolean;
			syncRecipes: boolean;
			syncPlanner: boolean;
			syncExpenses: boolean;
			syncCatalog: boolean;

			createRecipeObjects: boolean;
			createShoppingItemObjects: boolean;
			deleteStaleObjects: boolean;

			expenseOverviewFrame: ExpenseFrame;
			expenseOverviewSteps: number;
			expenseView: ExpenseView;
			expensePages: number;

			enableWrite: boolean;
			writeRefreshDelay: number;
		}
	}
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
