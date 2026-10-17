import type { KitchenOwlClient } from './api';
import { itemEmoji } from './icons';
import { memberIds, round2, toId, toTimestamp } from './ids';
import type { ObjectWriter } from './objects';
import {
	type Category,
	type Expense,
	type ExpenseCategory,
	type ExpenseFrame,
	type ExpenseOverview,
	type ExpenseView,
	type Household,
	type Item,
	type PlannerEntry,
	type Recipe,
	RecipeVisibility,
	type ShoppingList,
	type Tag,
} from './types';

/** The parts of the adapter configuration the sync functions care about. */
export interface SyncConfig {
	syncMembers: boolean;
	syncShoppingLists: boolean;
	syncRecipes: boolean;
	syncPlanner: boolean;
	syncExpenses: boolean;
	syncCatalog: boolean;
	createRecipeObjects: boolean;
	createShoppingItemObjects: boolean;
	enableWrite: boolean;
	expenseOverviewFrame: ExpenseFrame;
	expenseOverviewSteps: number;
	expenseView: ExpenseView;
	expensePages: number;
}

/** Weekday names used for the planner's `days.<n>` channels. */
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Builds the absolute photo URL for a filename, or null when there is no photo.
 *
 * @param client - Connected KitchenOwl client
 * @param filename - Photo filename as returned by the API, if any
 */
function photo(client: KitchenOwlClient, filename: string | null | undefined): string | null {
	return filename ? client.photoUrl(filename) : null;
}

/**
 * An item reduced to the fields that are useful inside ioBroker.
 *
 * The API repeats the whole category object on every single item and adds
 * bookkeeping the adapter already knows or does not need: household_id is
 * implied by the position in the tree, created_at and updated_at belong to the
 * catalog entry rather than to this list or recipe, and support, ordering,
 * default and default_key are internal to KitchenOwl. Passing all of it
 * through made the catalog state alone around 290 kB per household.
 */
export interface SlimItem {
	id: number;
	name: string;
	/** Free text, which is where KitchenOwl keeps the amount. */
	description?: string;
	/** Only present on recipe ingredients. */
	optional?: boolean;
	category: string | null;
	/** An emoji, not KitchenOwl's icon key: the key names artwork nothing serves. */
	icon: string;
}

/**
 * Converts KitchenOwl's ARGB integer colour into a CSS hex string.
 *
 * The app stores colours as a signed 32 bit ARGB value, which is meaningless
 * to anything reading the state. The alpha channel is dropped because ioBroker
 * colour roles expect #RRGGBB.
 *
 * @param argb - Colour as the API returns it, if set
 */
function argbToHex(argb: number | null | undefined): string {
	if (typeof argb !== 'number' || !Number.isFinite(argb)) {
		return '';
	}
	return `#${(argb & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Reduces an item to the fields worth storing.
 *
 * @param item - Item as the API returned it
 */
function slimItem(item: Item & { description?: string; optional?: boolean }): SlimItem {
	const slim: SlimItem = {
		id: item.id,
		name: item.name,
		category: item.category?.name ?? null,
		icon: itemEmoji(item.icon, item.category?.name),
	};
	if (item.description !== undefined) {
		slim.description = item.description;
	}
	if (item.optional !== undefined) {
		slim.optional = item.optional;
	}
	return slim;
}

/**
 * Writes the household's own attributes.
 *
 * @param writer - Collector the states are added to
 * @param client - Connected KitchenOwl client
 * @param base - Namespace-relative id of the household branch
 * @param household - Household being written
 */
export function syncHousehold(
	writer: ObjectWriter,
	client: KitchenOwlClient,
	base: string,
	household: Household,
): void {
	writer.serverChannel(base, household.name, 'device');

	writer.value(`${base}.name`, 'Name', 'string', 'text', household.name);
	writer.value(`${base}.description`, 'Description', 'string', 'text', household.description ?? '');
	writer.value(`${base}.language`, 'Language', 'string', 'text', household.language ?? '');
	writer.value(`${base}.photoUrl`, 'Photo URL', 'string', 'text.url', photo(client, household.photo) ?? '');
	writer.value(
		`${base}.expensesFeature`,
		'Expenses feature enabled',
		'boolean',
		'indicator',
		!!household.expenses_feature,
	);
	writer.value(
		`${base}.plannerFeature`,
		'Planner feature enabled',
		'boolean',
		'indicator',
		!!household.planner_feature,
	);
	writer.value(
		`${base}.defaultShoppingListId`,
		'Default shopping list ID',
		'number',
		'value',
		household.default_shopping_list?.id ?? 0,
	);
	writer.json(`${base}.viewOrdering`, 'Configured view order', household.view_ordering ?? []);
}

/**
 * Writes one channel per member, plus the balance summary.
 *
 * @param writer - Collector the states are added to
 * @param client - Connected KitchenOwl client
 * @param base - Namespace-relative id of the household branch
 * @param household - Household being written
 */
export function syncMembers(writer: ObjectWriter, client: KitchenOwlClient, base: string, household: Household): void {
	const members = household.member ?? [];
	const root = `${base}.members`;

	writer.channel(root, 'Household members');
	writer.value(`${root}.count`, 'Number of members', 'number', 'value', members.length);
	writer.json(
		`${root}.balancesJson`,
		'Expense balance per member',
		Object.fromEntries(members.map(member => [member.username, round2(member.expense_balance ?? 0)])),
	);

	const segments = memberIds(members);

	for (const member of members) {
		const id = `${root}.${segments.get(member.id)}`;
		writer.serverChannel(id, member.name);

		writer.value(`${id}.id`, 'User ID', 'number', 'value', member.id);
		writer.value(`${id}.name`, 'Display name', 'string', 'text', member.name);
		writer.value(`${id}.username`, 'Username', 'string', 'text', member.username);
		// The API returns balances as raw floats such as -220.1999999999914.
		writer.value(`${id}.balance`, 'Expense balance', 'number', 'value', round2(member.expense_balance ?? 0));
		writer.value(`${id}.isHouseholdAdmin`, 'Household administrator', 'boolean', 'indicator', !!member.admin);
		writer.value(`${id}.isOwner`, 'Household owner', 'boolean', 'indicator', !!member.owner);
		writer.value(`${id}.lastSeen`, 'Last seen', 'number', 'value.time', toTimestamp(member.last_seen));
		writer.value(`${id}.photoUrl`, 'Photo URL', 'string', 'text.url', photo(client, member.photo) ?? '');
	}
}

/**
 * Writes every shopping list with its items, and the write commands when enabled.
 *
 * @param writer - Collector the states are added to
 * @param base - Namespace-relative id of the household branch
 * @param lists - Shopping lists including their items
 * @param config - Which branches and granularity the user enabled
 */
export function syncShoppingLists(writer: ObjectWriter, base: string, lists: ShoppingList[], config: SyncConfig): void {
	const root = `${base}.shoppingLists`;

	writer.channel(root, 'Shopping lists');
	writer.value(`${root}.count`, 'Number of lists', 'number', 'value', lists.length);
	writer.json(
		`${root}.json`,
		'All shopping lists',
		lists.map(list => ({ id: list.id, name: list.name, itemCount: list.items?.length ?? 0 })),
	);

	for (const list of lists) {
		const id = `${root}.${list.id}`;
		const items = list.items ?? [];

		writer.serverChannel(id, list.name);
		writer.value(`${id}.name`, 'Name', 'string', 'text', list.name);
		writer.value(`${id}.itemCount`, 'Number of items', 'number', 'value', items.length);
		writer.value(`${id}.itemNames`, 'Items as text', 'string', 'text', items.map(item => item.name).join(', '));
		writer.json(`${id}.json`, 'All items on the list', items.map(slimItem));
		writer.json(`${id}.recentItemsJson`, 'Recently removed items', (list.recentItems ?? []).map(slimItem));

		if (config.enableWrite) {
			writer.state({
				id: `${id}.addItemByName`,
				name: 'Add an item by name, or as JSON: {"name": "Milk", "description": "2 L"}',
				type: 'string',
				role: 'text',
				read: false,
				write: true,
			});
			writer.button(`${id}.clear`, 'Remove all items from the list');
		}

		if (!config.createShoppingItemObjects) {
			continue;
		}

		const itemsRoot = `${id}.items`;
		writer.channel(itemsRoot, 'Items');

		for (const item of items) {
			const itemId = `${itemsRoot}.${item.id}`;
			writer.serverChannel(itemId, item.name);

			writer.value(`${itemId}.name`, 'Name', 'string', 'text', item.name);
			writer.value(`${itemId}.category`, 'Category', 'string', 'text', item.category?.name ?? '');
			writer.value(`${itemId}.icon`, 'Icon', 'string', 'text', itemEmoji(item.icon, item.category?.name));

			if (config.enableWrite) {
				writer.state({
					id: `${itemId}.description`,
					name: 'Description, for example the amount',
					type: 'string',
					role: 'text',
					value: item.description ?? '',
					read: true,
					write: true,
				});
				writer.button(`${itemId}.remove`, 'Remove this item from the list');
			} else {
				writer.value(`${itemId}.description`, 'Description', 'string', 'text', item.description ?? '');
			}
		}
	}
}

/**
 * Writes the recipe collection, optionally one channel per recipe.
 *
 * @param writer - Collector the states are added to
 * @param client - Connected KitchenOwl client
 * @param base - Namespace-relative id of the household branch
 * @param recipes - Recipes of the household
 * @param config - Which branches and granularity the user enabled
 */
export function syncRecipes(
	writer: ObjectWriter,
	client: KitchenOwlClient,
	base: string,
	recipes: Recipe[],
	config: SyncConfig,
): void {
	const root = `${base}.recipes`;

	writer.channel(root, 'Recipes');
	writer.value(`${root}.count`, 'Number of recipes', 'number', 'value', recipes.length);
	writer.json(
		`${root}.json`,
		'Recipe overview',
		recipes.map(recipe => ({
			id: recipe.id,
			name: recipe.name,
			time: recipe.time ?? 0,
			yields: recipe.yields ?? null,
			planned: !!recipe.planned,
			tags: (recipe.tags ?? []).map(tag => tag.name),
		})),
	);

	if (config.enableWrite) {
		writer.state({
			id: `${root}.scrapeUrl`,
			name: 'Import a recipe from a URL',
			type: 'string',
			role: 'text.url',
			read: false,
			write: true,
		});
		// Declared without a value on purpose: the import command fills this in,
		// and a poll that published its own value would wipe the result seconds
		// after the import that produced it.
		writer.state({
			id: `${root}.scrapeResult`,
			name: 'Result of the last import',
			type: 'string',
			role: 'json',
			read: true,
			write: false,
		});
	}

	if (!config.createRecipeObjects) {
		return;
	}

	for (const recipe of recipes) {
		const id = `${root}.${recipe.id}`;
		writer.serverChannel(id, recipe.name);

		writer.value(`${id}.name`, 'Name', 'string', 'text', recipe.name);
		writer.value(`${id}.description`, 'Description', 'string', 'text', recipe.description ?? '');
		writer.value(`${id}.time`, 'Total time', 'number', 'value', recipe.time ?? 0, 'min');
		writer.value(`${id}.prepTime`, 'Preparation time', 'number', 'value', recipe.prep_time ?? 0, 'min');
		writer.value(`${id}.cookTime`, 'Cooking time', 'number', 'value', recipe.cook_time ?? 0, 'min');
		writer.value(`${id}.yields`, 'Servings', 'number', 'value', recipe.yields ?? 0);
		writer.value(`${id}.source`, 'Source', 'string', 'text.url', recipe.source ?? '');
		writer.value(`${id}.photoUrl`, 'Photo URL', 'string', 'text.url', photo(client, recipe.photo) ?? '');
		writer.value(
			`${id}.tags`,
			'Tags as text',
			'string',
			'text',
			(recipe.tags ?? []).map(tag => tag.name).join(', '),
		);
		writer.value(`${id}.planned`, 'Currently planned', 'boolean', 'indicator', !!recipe.planned);
		writer.json(`${id}.plannedDays`, 'Planned weekdays', recipe.planned_days ?? []);
		writer.state({
			id: `${id}.visibility`,
			name: 'Visibility',
			type: 'number',
			role: 'value',
			value: recipe.visibility ?? RecipeVisibility.Private,
			// Without these the admin UI shows a bare 0, 1 or 2.
			states: { 0: 'private', 1: 'link', 2: 'public' },
		});
		writer.json(`${id}.itemsJson`, 'Ingredients', (recipe.items ?? []).map(slimItem));
	}
}

/**
 * Writes the meal plan, one channel per weekday plus the next planned meal.
 *
 * @param writer - Collector the states are added to
 * @param base - Namespace-relative id of the household branch
 * @param entries - Planner entries of the household
 * @param config - Which branches and granularity the user enabled
 * @param now - Clock reading used to decide which meals are still ahead
 */
export function syncPlanner(
	writer: ObjectWriter,
	base: string,
	entries: PlannerEntry[],
	config: SyncConfig,
	now: number = Date.now(),
): void {
	const root = `${base}.planner`;

	writer.channel(root, 'Meal planner');
	writer.value(`${root}.count`, 'Number of planned meals', 'number', 'value', entries.length);
	writer.json(
		`${root}.json`,
		'Planned meals',
		entries.map(entry => ({
			recipeId: entry.recipe_id,
			recipeName: entry.recipe?.name ?? '',
			day: entry.day ?? -1,
			cookingDate: toTimestamp(entry.cooking_date),
			yields: entry.yields ?? null,
		})),
	);

	// The soonest entry that is still ahead, so a script can show "what's next".
	// A meal is counted for the whole of its cooking day: KitchenOwl stores the
	// date at midnight, and a meal planned for tonight is still the next one.
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const upcoming = entries
		.filter(entry => {
			const date = toTimestamp(entry.cooking_date);
			return date !== null && date >= today.getTime();
		})
		.sort((a, b) => (a.cooking_date ?? 0) - (b.cooking_date ?? 0))[0];

	writer.value(`${root}.nextRecipeName`, 'Next planned meal', 'string', 'text', upcoming?.recipe?.name ?? '');
	writer.value(`${root}.nextRecipeId`, 'Next planned recipe ID', 'number', 'value', upcoming?.recipe_id ?? 0);
	writer.value(
		`${root}.nextCookingDate`,
		'Next cooking date',
		'number',
		'value.time',
		toTimestamp(upcoming?.cooking_date),
	);

	if (config.enableWrite) {
		writer.state({
			id: `${root}.addRecipe`,
			name: 'Plan a recipe, as JSON: {"recipe_id": 1, "cooking_date": 1700000000000}',
			type: 'string',
			role: 'json',
			read: false,
			write: true,
		});
	}

	const daysRoot = `${root}.days`;
	writer.channel(daysRoot, 'Planned meals by weekday');

	for (let day = 0; day < WEEKDAYS.length; day++) {
		const id = `${daysRoot}.${day}`;
		// A planner entry's `day` is -1 when it falls outside the coming week,
		// and a day can carry more than one meal.
		const onThisDay = entries.filter(candidate => candidate.day === day);

		writer.channel(id, WEEKDAYS[day]);
		writer.value(`${id}.count`, 'Meals on this day', 'number', 'value', onThisDay.length);
		// Every meal of the day, so nothing is hidden. There is deliberately no
		// singular recipeName beside this: it could only ever describe the first
		// meal, which is quietly wrong on a day that holds two.
		writer.value(
			`${id}.recipeNames`,
			'Recipe names',
			'string',
			'text',
			onThisDay.map(entry => entry.recipe?.name ?? '').join(', '),
		);
		writer.json(
			`${id}.json`,
			'Meals planned on this day',
			onThisDay.map(entry => ({
				recipeId: entry.recipe_id,
				recipeName: entry.recipe?.name ?? '',
				yields: entry.yields ?? null,
				cookingDate: toTimestamp(entry.cooking_date),
			})),
		);
		// Every meal on a weekday shares its date, so this one stays singular.
		writer.value(`${id}.date`, 'Cooking date', 'number', 'value.time', toTimestamp(onThisDay[0]?.cooking_date));

		if (config.enableWrite) {
			// Named for what it does: one button per day cannot say which of
			// several meals to drop, so it drops all of them.
			writer.button(`${id}.removeAll`, 'Remove every meal planned on this day');
		}
	}
}

/**
 * Writes recent expenses, the statistics overview and the expense categories.
 *
 * @param writer - Collector the states are added to
 * @param base - Namespace-relative id of the household branch
 * @param expenses - Recent expenses, newest first
 * @param categories - Expense or item categories of the household
 * @param overview - Spending totals grouped by period
 * @param config - Which branches and granularity the user enabled
 * @param memberNames - Display name of every member, keyed by user id
 */
export function syncExpenses(
	writer: ObjectWriter,
	base: string,
	expenses: Expense[],
	categories: ExpenseCategory[],
	overview: ExpenseOverview,
	config: SyncConfig,
	memberNames: Map<number, string> = new Map(),
): void {
	/**
	 * Falls back to the raw id when the payer is no longer a member.
	 *
	 * @param userId - Id of the member who paid, if the expense names one
	 */
	const payer = (userId: number | undefined): string =>
		userId === undefined ? '' : (memberNames.get(userId) ?? `#${userId}`);

	const root = `${base}.expenses`;
	const newest = expenses[0];
	// Period "0" of the overview is the current one.
	const currentPeriod = overview['0'];

	writer.channel(root, 'Expenses');
	writer.value(`${root}.count`, 'Number of expenses read', 'number', 'value', expenses.length);
	writer.json(
		`${root}.recentJson`,
		'Recent expenses',
		expenses.map(expense => ({
			id: expense.id,
			name: expense.name,
			amount: round2(expense.amount),
			date: toTimestamp(expense.date),
			paidBy: payer(expense.paid_by_id),
			category: expense.category?.name ?? null,
		})),
	);
	writer.json(`${root}.overviewJson`, 'Spending overview by period', overview);

	const currentTotal = currentPeriod
		? round2(Object.values(currentPeriod.by_category).reduce((sum, value) => sum + value, 0))
		: 0;
	writer.value(`${root}.currentPeriodTotal`, 'Total spent in the current period', 'number', 'value', currentTotal);

	writer.value(`${root}.newestName`, 'Newest expense', 'string', 'text', newest?.name ?? '');
	writer.value(`${root}.newestAmount`, 'Newest expense amount', 'number', 'value', round2(newest?.amount ?? 0));
	writer.value(`${root}.newestDate`, 'Newest expense date', 'number', 'value.time', toTimestamp(newest?.date));
	writer.value(`${root}.newestPaidBy`, 'Newest expense paid by', 'string', 'text', payer(newest?.paid_by_id));

	if (config.enableWrite) {
		writer.state({
			id: `${root}.add`,
			name: 'Add an expense, as JSON: {"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}]}',
			type: 'string',
			role: 'json',
			read: false,
			write: true,
		});
		writer.button(`${root}.recalculateBalances`, 'Recalculate member balances');
	}

	const categoriesRoot = `${root}.categories`;
	writer.channel(categoriesRoot, 'Expense categories');

	for (const category of categories) {
		const id = `${categoriesRoot}.${category.id}`;
		writer.serverChannel(id, category.name);

		writer.value(`${id}.name`, 'Name', 'string', 'text', category.name);
		writer.value(`${id}.budget`, 'Budget', 'number', 'value', category.budget ?? 0);
		writer.value(`${id}.color`, 'Colour', 'string', 'level.color.rgb', argbToHex(category.color));
		writer.value(
			`${id}.currentPeriodSum`,
			'Spent in the current period',
			'number',
			'value',
			round2(currentPeriod?.by_category[String(category.id)] ?? 0),
		);
	}

	// The overview reports uncategorised spending under the key -1.
	const uncategorized = currentPeriod?.by_category['-1'];
	if (uncategorized !== undefined) {
		const id = `${categoriesRoot}.uncategorized`;
		writer.channel(id, 'Uncategorised');
		writer.value(`${id}.currentPeriodSum`, 'Spent in the current period', 'number', 'value', round2(uncategorized));
	}
}

/**
 * Writes the item catalog, item categories and tags as JSON states.
 *
 * @param writer - Collector the states are added to
 * @param base - Namespace-relative id of the household branch
 * @param items - Items of the household catalog
 * @param categories - Expense or item categories of the household
 * @param tags - Recipe tags of the household
 */
export function syncCatalog(
	writer: ObjectWriter,
	base: string,
	items: Item[],
	categories: Category[],
	tags: Tag[],
): void {
	const root = `${base}.catalog`;

	writer.channel(root, 'Item catalog');
	writer.value(`${root}.itemCount`, 'Number of known items', 'number', 'value', items.length);
	writer.json(`${root}.itemsJson`, 'All known items', items.map(slimItem));
	writer.value(`${root}.categoryCount`, 'Number of categories', 'number', 'value', categories.length);
	writer.json(
		`${root}.categoriesJson`,
		'All item categories',
		categories.map(category => ({ id: category.id, name: category.name, ordering: category.ordering ?? 0 })),
	);
	writer.value(`${root}.tagCount`, 'Number of tags', 'number', 'value', tags.length);
	writer.json(
		`${root}.tagsJson`,
		'All recipe tags',
		tags.map(tag => ({ id: tag.id, name: tag.name })),
	);
}

/**
 * Namespace-relative base id of a household branch.
 *
 * @param household - Household being written
 */
export function householdBase(household: Household): string {
	return `households.${toId(String(household.id))}`;
}
