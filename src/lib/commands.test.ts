import { expect } from 'chai';

import { parseCommand, parseItemInput, parseJsonPayload, runCommand } from './commands';
import type { KitchenOwlClient } from './api';

describe('commands', () => {
	describe('parseCommand', () => {
		it('recognises every shopping list command', () => {
			expect(parseCommand('households.1.shoppingLists.2.addItemByName')).to.deep.equal({
				householdId: 1,
				kind: 'shoppingList.addItemByName',
				shoppingListId: 2,
			});
			expect(parseCommand('households.1.shoppingLists.2.clear')).to.deep.equal({
				householdId: 1,
				kind: 'shoppingList.clear',
				shoppingListId: 2,
			});
			expect(parseCommand('households.1.shoppingLists.2.items.10.remove')).to.deep.equal({
				householdId: 1,
				kind: 'shoppingList.item.remove',
				shoppingListId: 2,
				itemId: 10,
			});
			expect(parseCommand('households.1.shoppingLists.2.items.10.description')).to.deep.equal({
				householdId: 1,
				kind: 'shoppingList.item.description',
				shoppingListId: 2,
				itemId: 10,
			});
		});

		it('recognises the expense, planner and recipe commands', () => {
			expect(parseCommand('households.3.expenses.add')?.kind).to.equal('expenses.add');
			expect(parseCommand('households.3.expenses.recalculateBalances')?.kind).to.equal(
				'expenses.recalculateBalances',
			);
			expect(parseCommand('households.3.planner.addRecipe')?.kind).to.equal('planner.addRecipe');
			expect(parseCommand('households.3.planner.days.4.removeAll')).to.deep.equal({
				householdId: 3,
				kind: 'planner.day.removeAll',
				day: 4,
			});
			expect(parseCommand('households.3.recipes.scrapeUrl')?.kind).to.equal('recipes.scrapeUrl');
		});

		it('ignores read-only states and anything outside the households branch', () => {
			expect(parseCommand('info.connection')).to.equal(null);
			expect(parseCommand('commands.refresh')).to.equal(null);
			expect(parseCommand('households.1.name')).to.equal(null);
			expect(parseCommand('households.1.shoppingLists.2.itemCount')).to.equal(null);
			expect(parseCommand('households.1.members.alice.balance')).to.equal(null);
			expect(parseCommand('households')).to.equal(null);
		});

		it('rejects ids whose numeric segments are not numbers', () => {
			expect(parseCommand('households.abc.expenses.add')).to.equal(null);
			expect(parseCommand('households.1.shoppingLists.xyz.clear')).to.equal(null);
			expect(parseCommand('households.1.shoppingLists.2.items.xyz.remove')).to.equal(null);
		});
	});

	describe('parseJsonPayload', () => {
		it('accepts a JSON object', () => {
			expect(parseJsonPayload('{"a":1}', 'Test')).to.deep.equal({ a: 1 });
		});

		it('rejects empty input, invalid JSON, arrays and scalars', () => {
			expect(() => parseJsonPayload('', 'Test')).to.throw('JSON object as a string');
			expect(() => parseJsonPayload(42, 'Test')).to.throw('JSON object as a string');
			expect(() => parseJsonPayload('{nope}', 'Test')).to.throw('not valid JSON');
			expect(() => parseJsonPayload('[1,2]', 'Test')).to.throw('expects a JSON object');
			expect(() => parseJsonPayload('"text"', 'Test')).to.throw('expects a JSON object');
		});
	});

	describe('parseItemInput', () => {
		it('takes plain text as the item name', () => {
			expect(parseItemInput('  Bread  ')).to.deep.equal({ name: 'Bread' });
		});

		it('takes a name and a description from a JSON object', () => {
			expect(parseItemInput('{"name": " Milk ", "description": "2 L"}')).to.deep.equal({
				name: 'Milk',
				description: '2 L',
			});
		});

		it('leaves out a description that is not text', () => {
			expect(parseItemInput('{"name": "Milk", "description": 2}')).to.deep.equal({
				name: 'Milk',
				description: undefined,
			});
		});

		it('explains itself when the JSON names no item', () => {
			expect(() => parseItemInput('{"description": "2 L"}')).to.throw('"name" string');
			expect(() => parseItemInput('{not json')).to.throw('not valid JSON');
		});

		it('does not mistake a name that merely mentions a brace', () => {
			expect(parseItemInput('Bread {large}')).to.deep.equal({ name: 'Bread {large}' });
		});
	});

	describe('runCommand', () => {
		/** Records which client method a command reached, without any network. */
		const spyClient = (): { calls: unknown[][]; client: KitchenOwlClient } => {
			const calls: unknown[][] = [];
			const record =
				(name: string) =>
				(...args: unknown[]): Promise<unknown> => {
					calls.push([name, ...args]);
					return Promise.resolve(undefined);
				};

			const client = {
				addShoppingListItemByName: record('addShoppingListItemByName'),
				removeShoppingListItem: record('removeShoppingListItem'),
				clearShoppingList: record('clearShoppingList'),
				updateShoppingListItemDescription: record('updateShoppingListItemDescription'),
				addExpense: record('addExpense'),
				recalculateBalances: record('recalculateBalances'),
				addPlannedRecipe: record('addPlannedRecipe'),
				removePlannedRecipe: record('removePlannedRecipe'),
				scrapeRecipe: record('scrapeRecipe'),
			} as unknown as KitchenOwlClient;

			return { calls, client };
		};

		const context = (client: KitchenOwlClient): { client: KitchenOwlClient; log: ioBroker.Logger } => ({
			client,
			log: { silly() {}, debug() {}, info() {}, warn() {}, error() {}, level: 'info' },
		});

		const noPlan = (): [] => [];

		it('adds a shopping list item', async () => {
			const { calls, client } = spyClient();
			await runCommand(
				context(client),
				parseCommand('households.1.shoppingLists.2.addItemByName')!,
				'Bread',
				noPlan,
			);

			expect(calls).to.deep.equal([['addShoppingListItemByName', 2, 'Bread', undefined]]);
		});

		it('takes a description alongside the name when given JSON', async () => {
			const { calls, client } = spyClient();
			await runCommand(
				context(client),
				parseCommand('households.1.shoppingLists.2.addItemByName')!,
				'{"name": "Milk", "description": "2 L"}',
				noPlan,
			);

			expect(calls).to.deep.equal([['addShoppingListItemByName', 2, 'Milk', '2 L']]);
		});

		it('refuses to add an item with a blank name', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.shoppingLists.2.addItemByName')!;

			await expect(runCommand(context(client), command, '   ', noPlan)).to.be.rejectedWith('non-empty name');
			expect(calls).to.be.empty;
		});

		it('requires every field the expense endpoint insists on', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.expenses.add')!;

			// The server needs both sides of the booking as nested objects; a name
			// and an amount alone come back as a validation error.
			await expect(
				runCommand(context(client), command, '{"name":"Shop","amount":9.5}', noPlan),
			).to.be.rejectedWith('"paid_by"');
			expect(calls).to.be.empty;

			await expect(
				runCommand(context(client), command, '{"name":"Shop","amount":9.5,"paid_by":{"id":1}}', noPlan),
			).to.be.rejectedWith('"paid_for"');

			// A bare user id is the mistake the old example invited.
			await expect(
				runCommand(context(client), command, '{"name":"Shop","amount":9.5,"paid_by":1,"paid_for":[1]}', noPlan),
			).to.be.rejectedWith('"paid_by"');

			expect(calls).to.be.empty;
		});

		it('passes a complete expense through untouched', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.expenses.add')!;
			const payload = { name: 'Shop', amount: 9.5, paid_by: { id: 1 }, paid_for: [{ id: 1 }, { id: 2 }] };

			await runCommand(context(client), command, JSON.stringify(payload), noPlan);

			expect(calls).to.deep.equal([['addExpense', 1, payload]]);
		});

		it('requires a recipe id when planning a meal', async () => {
			const { client } = spyClient();
			const command = parseCommand('households.1.planner.addRecipe')!;

			await expect(runCommand(context(client), command, '{"cooking_date":1}', noPlan)).to.be.rejectedWith(
				'"recipe_id" number',
			);
		});

		it('removes the exact planning the day refers to', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.planner.days.2.removeAll')!;

			await runCommand(context(client), command, true, (householdId, day) =>
				householdId === 1 && day === 2 ? [{ recipeId: 20, cookingDate: 1792368000000 }] : [],
			);

			// The same recipe can sit on the plan twice, so the date has to go
			// along or the server removes the wrong entry, or none at all.
			expect(calls).to.deep.equal([['removePlannedRecipe', 1, 20, 1792368000000]]);
		});

		it('passes no date for a planning that has none', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.planner.days.2.removeAll')!;

			await runCommand(context(client), command, true, () => [{ recipeId: 20, cookingDate: null }]);

			expect(calls).to.deep.equal([['removePlannedRecipe', 1, 20, null]]);
		});

		it('removes every meal when a day holds more than one', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.planner.days.2.removeAll')!;

			// One button per day cannot say which meal to drop, so it drops all
			// of them; the state is named removeAll for exactly that reason.
			await runCommand(context(client), command, true, () => [
				{ recipeId: 20, cookingDate: 1792368000000 },
				{ recipeId: 21, cookingDate: 1792368000000 },
			]);

			expect(calls).to.deep.equal([
				['removePlannedRecipe', 1, 20, 1792368000000],
				['removePlannedRecipe', 1, 21, 1792368000000],
			]);
		});

		it('does nothing, and does not fail, when the day is empty', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.planner.days.5.removeAll')!;

			// A dashboard button on an empty day must not log an error every time
			// it is pressed.
			await runCommand(context(client), command, true, noPlan);

			expect(calls).to.be.empty;
		});

		it('only imports recipes from http URLs', async () => {
			const { calls, client } = spyClient();
			const command = parseCommand('households.1.recipes.scrapeUrl')!;

			await expect(runCommand(context(client), command, 'not-a-url', noPlan)).to.be.rejectedWith(
				'http or https URL',
			);

			await runCommand(context(client), command, 'https://example.invalid/r', noPlan);
			expect(calls).to.deep.equal([['scrapeRecipe', 1, 'https://example.invalid/r']]);
		});
	});
});
