import type { KitchenOwlClient } from './api';

/** Everything a write command needs to reach the server and report back. */
export interface CommandContext {
	client: KitchenOwlClient;
	log: ioBroker.Logger;
}

/** The meal on one weekday, as the last poll saw it. */
export interface PlannedMeal {
	recipeId: number;
	/** Which of possibly several plannings of this recipe the button refers to. */
	cookingDate: number | null;
}

/** A parsed writable state id, e.g. `households.1.shoppingLists.2.items.3.remove`. */
export interface ParsedCommand {
	householdId: number;
	kind:
		| 'shoppingList.addItemByName'
		| 'shoppingList.clear'
		| 'shoppingList.item.remove'
		| 'shoppingList.item.description'
		| 'expenses.add'
		| 'expenses.recalculateBalances'
		| 'planner.addRecipe'
		| 'planner.day.remove'
		| 'recipes.scrapeUrl';
	shoppingListId?: number;
	itemId?: number;
	day?: number;
}

/**
 * Turns a namespace-relative state id into a command description.
 *
 * Returns null for ids the adapter does not treat as commands, so the caller
 * can ignore acknowledged values and states it merely subscribed to.
 *
 * @param relativeId - State id without the adapter namespace
 */
export function parseCommand(relativeId: string): ParsedCommand | null {
	const parts = relativeId.split('.');
	if (parts[0] !== 'households' || parts.length < 3) {
		return null;
	}

	const householdId = Number(parts[1]);
	if (!Number.isFinite(householdId)) {
		return null;
	}

	const [, , branch, ...rest] = parts;

	if (branch === 'shoppingLists') {
		const shoppingListId = Number(rest[0]);
		if (!Number.isFinite(shoppingListId)) {
			return null;
		}

		if (rest[1] === 'addItemByName') {
			return { householdId, kind: 'shoppingList.addItemByName', shoppingListId };
		}
		if (rest[1] === 'clear') {
			return { householdId, kind: 'shoppingList.clear', shoppingListId };
		}
		if (rest[1] === 'items' && rest.length === 4) {
			const itemId = Number(rest[2]);
			if (!Number.isFinite(itemId)) {
				return null;
			}
			if (rest[3] === 'remove') {
				return { householdId, kind: 'shoppingList.item.remove', shoppingListId, itemId };
			}
			if (rest[3] === 'description') {
				return { householdId, kind: 'shoppingList.item.description', shoppingListId, itemId };
			}
		}
		return null;
	}

	if (branch === 'expenses') {
		if (rest[0] === 'add') {
			return { householdId, kind: 'expenses.add' };
		}
		if (rest[0] === 'recalculateBalances') {
			return { householdId, kind: 'expenses.recalculateBalances' };
		}
		return null;
	}

	if (branch === 'planner') {
		if (rest[0] === 'addRecipe') {
			return { householdId, kind: 'planner.addRecipe' };
		}
		if (rest[0] === 'days' && rest[2] === 'remove') {
			const day = Number(rest[1]);
			return Number.isFinite(day) ? { householdId, kind: 'planner.day.remove', day } : null;
		}
		return null;
	}

	if (branch === 'recipes' && rest[0] === 'scrapeUrl') {
		return { householdId, kind: 'recipes.scrapeUrl' };
	}

	return null;
}

/** A worked example, shown in the state name and in the error when input falls short. */
export const EXPENSE_EXAMPLE =
	'{"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}, {"id": 2}]}';

/**
 * Whether a value is the `{"id": n}` object the expense endpoints expect.
 *
 * @param value - Candidate from the command payload
 */
function isUserRef(value: unknown): boolean {
	return typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number';
}

/**
 * Parses a JSON command payload, raising a readable error for bad input.
 *
 * @param value - Value to publish
 * @param what - Name of the command, used in the error message
 */
export function parseJsonPayload(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new Error(`${what} expects a JSON object as a string`);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${what} received a value that is not valid JSON`);
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(`${what} expects a JSON object`);
	}
	return parsed as Record<string, unknown>;
}

/**
 * Reads the value written to an `addItemByName` state.
 *
 * Plain text is taken as the item name. A JSON object is accepted as well, so
 * that the free-text description KitchenOwl keeps the amount in can be set in
 * the same write: `{"name": "Milk", "description": "2 L"}`.
 *
 * @param value - The value written to the state
 */
export function parseItemInput(value: ioBroker.StateValue): { name: string; description?: string } {
	const text = String(value ?? '').trim();
	if (!text.startsWith('{')) {
		return { name: text };
	}

	const payload = parseJsonPayload(text, 'Adding an item');
	if (typeof payload.name !== 'string') {
		throw new Error('Adding an item as JSON needs a "name" string');
	}
	return {
		name: payload.name.trim(),
		description: typeof payload.description === 'string' ? payload.description : undefined,
	};
}

/**
 * Executes a write command against KitchenOwl.
 *
 * Resolving the planner day back to a recipe id needs the current plan, so the
 * caller supplies a lookup rather than this module re-reading it.
 *
 * @param context - Client and logger
 * @param command - Parsed command
 * @param value - The value written to the state
 * @param plannedOnDay - Resolves a weekday to the meal planned on it, if any
 */
export async function runCommand(
	context: CommandContext,
	command: ParsedCommand,
	value: ioBroker.StateValue,
	plannedOnDay: (householdId: number, day: number) => PlannedMeal | undefined,
): Promise<unknown> {
	const { client } = context;

	switch (command.kind) {
		case 'shoppingList.addItemByName': {
			const { name, description } = parseItemInput(value);
			if (!name) {
				throw new Error('Adding an item needs a non-empty name');
			}
			return client.addShoppingListItemByName(command.shoppingListId!, name, description);
		}

		case 'shoppingList.clear':
			return client.clearShoppingList(command.shoppingListId!);

		case 'shoppingList.item.remove':
			return client.removeShoppingListItem(command.shoppingListId!, command.itemId!);

		case 'shoppingList.item.description':
			return client.updateShoppingListItemDescription(
				command.shoppingListId!,
				command.itemId!,
				String(value ?? ''),
			);

		case 'expenses.add': {
			const payload = parseJsonPayload(value, 'Adding an expense');

			// The server rejects anything short of these four, and a user id alone
			// is not enough: both sides of the booking are nested objects.
			const missing: string[] = [];
			if (typeof payload.name !== 'string' || payload.name.trim() === '') {
				missing.push('"name" (string)');
			}
			if (typeof payload.amount !== 'number') {
				missing.push('"amount" (number)');
			}
			if (!isUserRef(payload.paid_by)) {
				missing.push('"paid_by" ({"id": <user id>})');
			}
			if (
				!Array.isArray(payload.paid_for) ||
				payload.paid_for.length === 0 ||
				!payload.paid_for.every(isUserRef)
			) {
				missing.push('"paid_for" (a non-empty list of {"id": <user id>})');
			}
			if (missing.length > 0) {
				throw new Error(`Adding an expense needs ${missing.join(', ')}. For example: ${EXPENSE_EXAMPLE}`);
			}
			return client.addExpense(command.householdId, payload);
		}

		case 'expenses.recalculateBalances':
			return client.recalculateBalances(command.householdId);

		case 'planner.addRecipe': {
			const payload = parseJsonPayload(value, 'Planning a recipe');
			if (typeof payload.recipe_id !== 'number') {
				throw new Error('Planning a recipe needs a "recipe_id" number');
			}
			return client.addPlannedRecipe(command.householdId, payload);
		}

		case 'planner.day.remove': {
			const planned = plannedOnDay(command.householdId, command.day!);
			if (!planned) {
				// Pressing remove on a day with no meal is a no-op, not a failure.
				context.log.debug(`Nothing is planned for day ${command.day}, so there is nothing to remove`);
				return undefined;
			}
			return client.removePlannedRecipe(command.householdId, planned.recipeId, planned.cookingDate);
		}

		case 'recipes.scrapeUrl': {
			const url = String(value ?? '').trim();
			if (!/^https?:\/\/.+/.test(url)) {
				throw new Error('Importing a recipe needs an http or https URL');
			}
			return client.scrapeRecipe(command.householdId, url);
		}
	}
}
