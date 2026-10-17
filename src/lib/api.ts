import { setTimeout as delay } from 'node:timers/promises';

import { Agent, fetch, type RequestInit } from 'undici';

import {
	type Category,
	type Expense,
	type ExpenseCategory,
	ExpenseFrame,
	type ExpenseOverview,
	type ExpenseView,
	type Health,
	type Household,
	type Item,
	type PlannerEntry,
	type Recipe,
	type ShoppingList,
	type ShoppingListItem,
	type Tag,
} from './types';

/**
 * The health endpoint lives behind a fixed obfuscated path segment upstream, so
 * that it is not trivially discoverable. It is hard-coded in the KitchenOwl
 * backend and is the same on every instance.
 *
 * @see https://github.com/TomBursch/kitchenowl backend/app/api/register_controller.py
 */
export const HEALTH_PATH = '/api/health/8M4F88S8ooi4sMbLBfkkV7ctWwgibW6V';

/** The server returns at most this many expenses per request; paging uses `startAfterId`. */
export const EXPENSE_PAGE_SIZE = 30;

/**
 * Client errors worth another attempt: a rate limit and a request timeout both
 * pass on their own, unlike the 401 or 404 that the retry loop gives up on.
 */
const RETRYABLE_CLIENT_ERRORS = new Set([408, 429]);

/** Per-request options used internally by the transport. */
interface RequestOptions {
	/** JSON body to send; omit for requests without one. */
	body?: unknown;
	/** Set to false for the health endpoint, which takes no token. */
	auth?: boolean;
}

/** Everything needed to talk to one KitchenOwl instance. */
export interface KitchenOwlClientOptions {
	url: string;
	token: string;
	/** Per-request timeout in milliseconds. */
	timeout?: number;
	/** How often a failed request is retried before giving up. */
	retries?: number;
	/** Base delay between retries in milliseconds; grows linearly with the attempt number. */
	retryDelay?: number;
	/** Set to false to accept self-signed certificates. */
	rejectUnauthorized?: boolean;
	/** Optional sink for debug messages, usually `adapter.log.debug`. */
	log?: (message: string) => void;
	/**
	 * Where photos are published, when the adapter caches them locally.
	 *
	 * Photo URLs are presentation rather than API surface: the upload endpoint
	 * needs the token, which a browser never sends, so a cached copy is what a
	 * visualisation can actually load.
	 */
	photoBase?: string;
}

/** An HTTP error carrying the status code, so callers can treat 401 and 404 differently. */
export class KitchenOwlApiError extends Error {
	/**
	 * @param message - Error message
	 * @param status - HTTP status code returned by the server
	 * @param path - Path the request was sent to
	 */
	public constructor(
		message: string,
		public readonly status: number,
		public readonly path: string,
	) {
		super(message);
		this.name = 'KitchenOwlApiError';
	}

	/** True when the token is missing, revoked or not allowed to see the resource. */
	public get isAuthError(): boolean {
		return this.status === 401 || this.status === 403;
	}
}

/**
 * Thin typed wrapper around the KitchenOwl REST API.
 *
 * Every call authenticates with a long-lived bearer token. Long-lived tokens are
 * bound to a user rather than a household, so one token covers every household
 * that user belongs to.
 */
export class KitchenOwlClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly timeout: number;
	private readonly retries: number;
	private readonly retryDelay: number;
	private readonly log?: (message: string) => void;
	private readonly photoBase?: string;
	private readonly dispatcher?: Agent;
	private readonly abortController = new AbortController();
	private destroyed = false;

	/**
	 * @param options - Connection details, timeouts and retry behaviour
	 */
	public constructor(options: KitchenOwlClientOptions) {
		// KitchenOwl serves its API below the instance root, so a URL that already
		// ends in /api would otherwise produce /api/api/... and a puzzling 404.
		this.baseUrl = options.url
			.trim()
			.replace(/\/+$/, '')
			.replace(/\/api$/i, '');
		this.token = options.token.trim();
		this.timeout = options.timeout ?? 10000;
		this.retries = options.retries ?? 2;
		this.retryDelay = options.retryDelay ?? 2000;
		this.log = options.log;
		this.photoBase = options.photoBase;

		if (options.rejectUnauthorized === false) {
			this.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
		}
	}

	/** Aborts every in-flight request and blocks further ones. Called from `onUnload`. */
	public async destroy(): Promise<void> {
		this.destroyed = true;
		this.abortController.abort();
		await this.dispatcher?.close();
	}

	/**
	 * Absolute URL of an uploaded photo, for use in a VIS widget or a browser.
	 *
	 * @param filename - Photo filename as returned by the API, if any
	 */
	public photoUrl(filename: string): string {
		if (this.photoBase) {
			return `${this.photoBase}${encodeURIComponent(filename)}`;
		}
		return `${this.baseUrl}/api/upload/${encodeURIComponent(filename)}`;
	}

	/**
	 * Downloads one photo.
	 *
	 * @param filename - Photo filename as the API reports it
	 */
	public async fetchPhoto(filename: string): Promise<Buffer> {
		if (this.destroyed) {
			throw new Error('Client has been destroyed');
		}

		const response = await fetch(`${this.baseUrl}/api/upload/${encodeURIComponent(filename)}`, {
			headers: { Authorization: `Bearer ${this.token}` },
			signal: AbortSignal.any([AbortSignal.timeout(this.timeout), this.abortController.signal]),
			...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
		});

		if (!response.ok) {
			throw new KitchenOwlApiError(
				`Downloading ${filename} returned ${response.status} ${response.statusText}`,
				response.status,
				`/api/upload/${filename}`,
			);
		}
		return Buffer.from(await response.arrayBuffer());
	}

	// --- reads -------------------------------------------------------------

	/** Server version and feature flags. This endpoint needs no authentication. */
	public health(): Promise<Health> {
		return this.request<Health>('GET', HEALTH_PATH, { auth: false });
	}

	/** Every household the token's user is a member of. */
	public households(): Promise<Household[]> {
		return this.request<Household[]>('GET', '/api/household');
	}

	/**
	 * A single household including its members and their expense balances.
	 *
	 * @param householdId - Household to act on
	 */
	public household(householdId: number): Promise<Household> {
		return this.request<Household>('GET', `/api/household/${householdId}`);
	}

	/**
	 * All shopping lists of a household, each with its items and recent items
	 * inline, so one call covers every list.
	 *
	 * @param householdId - Household to read
	 * @param recentLimit - How many recent items to include per list (1-120)
	 */
	public shoppingLists(householdId: number, recentLimit = 9): Promise<ShoppingList[]> {
		return this.request<ShoppingList[]>(
			'GET',
			`/api/household/${householdId}/shoppinglist?recent_limit=${recentLimit}`,
		);
	}

	/**
	 * The items currently on one shopping list.
	 *
	 * @param shoppingListId - Shopping list to read
	 */
	public shoppingListItems(shoppingListId: number): Promise<ShoppingListItem[]> {
		return this.request<ShoppingListItem[]>('GET', `/api/shoppinglist/${shoppingListId}/items`);
	}

	/**
	 * Items the server suggests adding, based on past purchases.
	 *
	 * @param shoppingListId - Shopping list to act on
	 */
	public suggestedItems(shoppingListId: number): Promise<ShoppingListItem[]> {
		return this.request<ShoppingListItem[]>('GET', `/api/shoppinglist/${shoppingListId}/suggested-items`);
	}

	/**
	 * Every item in the household catalog.
	 *
	 * @param householdId - Household to act on
	 */
	public items(householdId: number): Promise<Item[]> {
		return this.request<Item[]>('GET', `/api/household/${householdId}/item`);
	}

	/**
	 * Item categories of the household.
	 *
	 * @param householdId - Household to act on
	 */
	public categories(householdId: number): Promise<Category[]> {
		return this.request<Category[]>('GET', `/api/household/${householdId}/category`);
	}

	/**
	 * Recipe tags of the household.
	 *
	 * @param householdId - Household to act on
	 */
	public tags(householdId: number): Promise<Tag[]> {
		return this.request<Tag[]>('GET', `/api/household/${householdId}/tag`);
	}

	/**
	 * Every recipe of the household, with ingredients and tags.
	 *
	 * @param householdId - Household to act on
	 */
	public recipes(householdId: number): Promise<Recipe[]> {
		return this.request<Recipe[]>('GET', `/api/household/${householdId}/recipe`);
	}

	/**
	 * The current meal plan.
	 *
	 * @param householdId - Household to act on
	 */
	public planner(householdId: number): Promise<PlannerEntry[]> {
		return this.request<PlannerEntry[]>('GET', `/api/household/${householdId}/planner`);
	}

	/**
	 * Expense categories of the household.
	 *
	 * @param householdId - Household to act on
	 */
	public expenseCategories(householdId: number): Promise<ExpenseCategory[]> {
		return this.request<ExpenseCategory[]>('GET', `/api/household/${householdId}/expense/categories`);
	}

	/**
	 * Recent expenses, newest first.
	 *
	 * The server caps every response at 30 entries, so more than one page is
	 * fetched by passing the last id of the previous page as a cursor.
	 *
	 * @param householdId - Household to read
	 * @param view - Whole-household or personal-share amounts
	 * @param pages - How many pages of 30 to fetch
	 */
	public async expenses(householdId: number, view: ExpenseView, pages = 1): Promise<Expense[]> {
		const collected: Expense[] = [];
		let startAfterId: number | undefined;

		for (let page = 0; page < Math.max(1, pages); page++) {
			const query = new URLSearchParams({ view: String(view) });
			if (startAfterId !== undefined) {
				query.set('startAfterId', String(startAfterId));
			}

			const batch = await this.request<Expense[]>(
				'GET',
				`/api/household/${householdId}/expense?${query.toString()}`,
			);
			collected.push(...batch);

			// A short page means the server has nothing left to give.
			if (batch.length < EXPENSE_PAGE_SIZE) {
				break;
			}
			startAfterId = batch[batch.length - 1].id;
		}

		return collected;
	}

	/**
	 * Spending totals grouped by category and by sub-period.
	 *
	 * @param householdId - Household to read
	 * @param frame - Daily, weekly, monthly or yearly buckets
	 * @param steps - How many periods to return, including the current one
	 * @param view - Whole-household or personal-share amounts
	 */
	public expenseOverview(
		householdId: number,
		frame: ExpenseFrame,
		steps: number,
		view: ExpenseView,
	): Promise<ExpenseOverview> {
		// Frames above Yearly make the backend return a 500, so clamp defensively.
		const safeFrame = frame >= ExpenseFrame.Daily && frame <= ExpenseFrame.Yearly ? frame : ExpenseFrame.Monthly;
		const query = new URLSearchParams({
			frame: String(safeFrame),
			steps: String(steps),
			view: String(view),
		});
		return this.request<ExpenseOverview>(
			'GET',
			`/api/household/${householdId}/expense/overview?${query.toString()}`,
		);
	}

	// --- writes ------------------------------------------------------------

	/**
	 * Adds an item to a shopping list, creating the catalog entry if needed.
	 *
	 * @param shoppingListId - Shopping list to act on
	 * @param name - Name of the item to add
	 * @param description - Free-text description, for example the amount
	 */
	public addShoppingListItemByName(shoppingListId: number, name: string, description?: string): Promise<unknown> {
		return this.request('POST', `/api/shoppinglist/${shoppingListId}/add-item-by-name`, {
			body: { name, description: description ?? '' },
		});
	}

	/**
	 * Takes one item off a shopping list.
	 *
	 * @param shoppingListId - Shopping list to act on
	 * @param itemId - Item to act on
	 */
	public removeShoppingListItem(shoppingListId: number, itemId: number): Promise<unknown> {
		return this.request('DELETE', `/api/shoppinglist/${shoppingListId}/item`, {
			body: { item_id: itemId },
		});
	}

	/**
	 * Takes every item off a shopping list.
	 *
	 * @param shoppingListId - Shopping list to act on
	 */
	public async clearShoppingList(shoppingListId: number): Promise<unknown> {
		// The endpoint removes the items it is handed rather than emptying the
		// list, and its handler reads that list without checking it is there, so
		// calling it with no body answers 500.
		const items = await this.shoppingListItems(shoppingListId);
		if (items.length === 0) {
			return undefined;
		}

		return this.request('DELETE', `/api/shoppinglist/${shoppingListId}/items`, {
			body: { items: items.map(item => ({ item_id: item.id })) },
		});
	}

	/**
	 * Changes an item's description on a list, typically the amount.
	 *
	 * @param shoppingListId - Shopping list to act on
	 * @param itemId - Item to act on
	 * @param description - Free-text description, for example the amount
	 */
	public updateShoppingListItemDescription(
		shoppingListId: number,
		itemId: number,
		description: string,
	): Promise<unknown> {
		return this.request('POST', `/api/shoppinglist/${shoppingListId}/item/${itemId}`, {
			body: { description },
		});
	}

	/**
	 * Books a new expense.
	 *
	 * @param householdId - Household to act on
	 * @param expense - Expense payload accepted by the API
	 */
	public addExpense(householdId: number, expense: Record<string, unknown>): Promise<Expense> {
		return this.request<Expense>('POST', `/api/household/${householdId}/expense`, { body: expense });
	}

	/**
	 * Deletes an expense.
	 *
	 * @param expenseId - Expense to delete
	 */
	public deleteExpense(expenseId: number): Promise<unknown> {
		// An empty body would make the server's argument validation blow up.
		return this.request('DELETE', `/api/expense/${expenseId}`, { body: {} });
	}

	/**
	 * Asks the server to recompute every member balance.
	 *
	 * @param householdId - Household to act on
	 */
	public recalculateBalances(householdId: number): Promise<unknown> {
		return this.request('GET', `/api/household/${householdId}/expense/recalculate-balances`);
	}

	/**
	 * Puts a recipe on the meal plan.
	 *
	 * @param householdId - Household to act on
	 * @param entry - Planner entry payload accepted by the API
	 */
	public addPlannedRecipe(householdId: number, entry: Record<string, unknown>): Promise<unknown> {
		return this.request('POST', `/api/household/${householdId}/planner/recipe`, { body: entry });
	}

	/**
	 * Takes a recipe off the meal plan.
	 *
	 * @param householdId - Household to act on
	 * @param recipeId - Recipe to act on
	 * @param cookingDate
	 */
	public removePlannedRecipe(householdId: number, recipeId: number, cookingDate?: number | null): Promise<unknown> {
		// Everything but GET is validated against the request body, and the
		// server parses that body without checking it is there, so a bodyless
		// DELETE answers 500. The date belongs in it too: a recipe can sit on
		// the plan more than once, and without it the server looks for an
		// unscheduled entry instead.
		const body = typeof cookingDate === 'number' ? { cooking_date: cookingDate } : {};
		return this.request('DELETE', `/api/household/${householdId}/planner/recipe/${recipeId}`, { body });
	}

	/**
	 * Imports a recipe from a public URL.
	 *
	 * @param householdId - Household to act on
	 * @param url - Public recipe URL to import
	 */
	public scrapeRecipe(householdId: number, url: string): Promise<unknown> {
		const query = new URLSearchParams({ url });
		return this.request('GET', `/api/household/${householdId}/recipe/scrape?${query.toString()}`);
	}

	// --- transport ---------------------------------------------------------

	/**
	 * Performs one API call, retrying transient failures.
	 *
	 * Authentication and client errors are not retried: a 401 will not fix
	 * itself, and hammering the server with it only delays the real error.
	 *
	 * @param method - HTTP method
	 * @param path - Path beginning with a slash, including any query string
	 * @param options - Request body and whether to send the bearer token
	 * @param options.body - JSON body to send
	 * @param options.auth - Set to false for endpoints that take no token
	 */
	private async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
		if (this.destroyed) {
			throw new Error('Client has been destroyed');
		}

		let lastError: Error = new Error(`Request to ${path} never ran`);

		for (let attempt = 0; attempt <= this.retries; attempt++) {
			if (attempt > 0) {
				await this.sleep(this.retryDelay * attempt);
				if (this.destroyed) {
					throw new Error('Client has been destroyed');
				}
			}

			try {
				return await this.perform<T>(method, path, options);
			} catch (error) {
				lastError = error as Error;

				if (
					error instanceof KitchenOwlApiError &&
					error.status >= 400 &&
					error.status < 500 &&
					!RETRYABLE_CLIENT_ERRORS.has(error.status)
				) {
					throw error;
				}
				if (this.destroyed) {
					throw error;
				}
				this.log?.(`${method} ${path} failed (attempt ${attempt + 1}): ${lastError.message}`);
			}
		}

		throw lastError;
	}

	private async perform<T>(method: string, path: string, options: { body?: unknown; auth?: boolean }): Promise<T> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		if (options.auth !== false) {
			headers.Authorization = `Bearer ${this.token}`;
		}
		if (options.body !== undefined) {
			headers['Content-Type'] = 'application/json';
		}

		const timeout = AbortSignal.timeout(this.timeout);
		const init: RequestInit = {
			method,
			headers,
			// Fail the request on timeout, and also when the adapter is unloading.
			signal: AbortSignal.any([timeout, this.abortController.signal]),
		};
		if (options.body !== undefined) {
			init.body = JSON.stringify(options.body);
		}
		if (this.dispatcher) {
			init.dispatcher = this.dispatcher;
		}

		let response;
		try {
			response = await fetch(`${this.baseUrl}${path}`, init);
		} catch (error) {
			// "This operation was aborted" says nothing to someone reading
			// info.lastError, so name the timeout that actually fired.
			if (timeout.aborted) {
				throw new Error(`${method} ${path} timed out after ${this.timeout} ms`);
			}
			throw error;
		}

		if (!response.ok) {
			// KitchenOwl answers errors with a short plain-text body.
			const detail = (await response.text().catch(() => '')).trim().slice(0, 200);
			throw new KitchenOwlApiError(
				`${method} ${path} returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`,
				response.status,
				path,
			);
		}

		const text = await response.text();
		if (!text) {
			return undefined as T;
		}

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(`${method} ${path} returned a body that is not valid JSON`);
		}
	}

	/**
	 * Waits between retry attempts, abortable so that a pending backoff does not
	 * outlive the adapter. A bare timer here would keep running after unload.
	 *
	 * @param ms - Delay in milliseconds
	 */
	private async sleep(ms: number): Promise<void> {
		try {
			await delay(ms, undefined, { signal: this.abortController.signal });
		} catch {
			// Aborted during shutdown; the caller checks `destroyed` next.
		}
	}
}
