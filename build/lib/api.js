"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var api_exports = {};
__export(api_exports, {
  EXPENSE_PAGE_SIZE: () => EXPENSE_PAGE_SIZE,
  HEALTH_PATH: () => HEALTH_PATH,
  KitchenOwlApiError: () => KitchenOwlApiError,
  KitchenOwlClient: () => KitchenOwlClient
});
module.exports = __toCommonJS(api_exports);
var import_promises = require("node:timers/promises");
var import_undici = require("undici");
var import_types = require("./types");
const HEALTH_PATH = "/api/health/8M4F88S8ooi4sMbLBfkkV7ctWwgibW6V";
const EXPENSE_PAGE_SIZE = 30;
const RETRYABLE_CLIENT_ERRORS = /* @__PURE__ */ new Set([408, 429]);
class KitchenOwlApiError extends Error {
  /**
   * @param message - Error message
   * @param status - HTTP status code returned by the server
   * @param path - Path the request was sent to
   */
  constructor(message, status, path) {
    super(message);
    this.status = status;
    this.path = path;
    this.name = "KitchenOwlApiError";
  }
  /** True when the token is missing, revoked or not allowed to see the resource. */
  get isAuthError() {
    return this.status === 401 || this.status === 403;
  }
}
class KitchenOwlClient {
  baseUrl;
  token;
  timeout;
  retries;
  retryDelay;
  log;
  dispatcher;
  abortController = new AbortController();
  destroyed = false;
  /**
   * @param options - Connection details, timeouts and retry behaviour
   */
  constructor(options) {
    var _a, _b, _c;
    this.baseUrl = options.url.trim().replace(/\/+$/, "").replace(/\/api$/i, "");
    this.token = options.token.trim();
    this.timeout = (_a = options.timeout) != null ? _a : 1e4;
    this.retries = (_b = options.retries) != null ? _b : 2;
    this.retryDelay = (_c = options.retryDelay) != null ? _c : 2e3;
    this.log = options.log;
    if (options.rejectUnauthorized === false) {
      this.dispatcher = new import_undici.Agent({ connect: { rejectUnauthorized: false } });
    }
  }
  /** Aborts every in-flight request and blocks further ones. Called from `onUnload`. */
  async destroy() {
    var _a;
    this.destroyed = true;
    this.abortController.abort();
    await ((_a = this.dispatcher) == null ? void 0 : _a.close());
  }
  /**
   * Absolute URL of an uploaded photo, for use in a VIS widget or a browser.
   *
   * @param filename - Photo filename as returned by the API, if any
   */
  photoUrl(filename) {
    return `${this.baseUrl}/api/upload/${encodeURIComponent(filename)}`;
  }
  // --- reads -------------------------------------------------------------
  /** Server version and feature flags. This endpoint needs no authentication. */
  health() {
    return this.request("GET", HEALTH_PATH, { auth: false });
  }
  /** Every household the token's user is a member of. */
  households() {
    return this.request("GET", "/api/household");
  }
  /**
   * A single household including its members and their expense balances.
   *
   * @param householdId - Household to act on
   */
  household(householdId) {
    return this.request("GET", `/api/household/${householdId}`);
  }
  /**
   * All shopping lists of a household, each with its items and recent items
   * inline, so one call covers every list.
   *
   * @param householdId - Household to read
   * @param recentLimit - How many recent items to include per list (1-120)
   */
  shoppingLists(householdId, recentLimit = 9) {
    return this.request(
      "GET",
      `/api/household/${householdId}/shoppinglist?recent_limit=${recentLimit}`
    );
  }
  /**
   * The items currently on one shopping list.
   *
   * @param shoppingListId - Shopping list to read
   */
  shoppingListItems(shoppingListId) {
    return this.request("GET", `/api/shoppinglist/${shoppingListId}/items`);
  }
  /**
   * Items the server suggests adding, based on past purchases.
   *
   * @param shoppingListId - Shopping list to act on
   */
  suggestedItems(shoppingListId) {
    return this.request("GET", `/api/shoppinglist/${shoppingListId}/suggested-items`);
  }
  /**
   * Every item in the household catalog.
   *
   * @param householdId - Household to act on
   */
  items(householdId) {
    return this.request("GET", `/api/household/${householdId}/item`);
  }
  /**
   * Item categories of the household.
   *
   * @param householdId - Household to act on
   */
  categories(householdId) {
    return this.request("GET", `/api/household/${householdId}/category`);
  }
  /**
   * Recipe tags of the household.
   *
   * @param householdId - Household to act on
   */
  tags(householdId) {
    return this.request("GET", `/api/household/${householdId}/tag`);
  }
  /**
   * Every recipe of the household, with ingredients and tags.
   *
   * @param householdId - Household to act on
   */
  recipes(householdId) {
    return this.request("GET", `/api/household/${householdId}/recipe`);
  }
  /**
   * The current meal plan.
   *
   * @param householdId - Household to act on
   */
  planner(householdId) {
    return this.request("GET", `/api/household/${householdId}/planner`);
  }
  /**
   * Expense categories of the household.
   *
   * @param householdId - Household to act on
   */
  expenseCategories(householdId) {
    return this.request("GET", `/api/household/${householdId}/expense/categories`);
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
  async expenses(householdId, view, pages = 1) {
    const collected = [];
    let startAfterId;
    for (let page = 0; page < Math.max(1, pages); page++) {
      const query = new URLSearchParams({ view: String(view) });
      if (startAfterId !== void 0) {
        query.set("startAfterId", String(startAfterId));
      }
      const batch = await this.request(
        "GET",
        `/api/household/${householdId}/expense?${query.toString()}`
      );
      collected.push(...batch);
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
  expenseOverview(householdId, frame, steps, view) {
    const safeFrame = frame >= import_types.ExpenseFrame.Daily && frame <= import_types.ExpenseFrame.Yearly ? frame : import_types.ExpenseFrame.Monthly;
    const query = new URLSearchParams({
      frame: String(safeFrame),
      steps: String(steps),
      view: String(view)
    });
    return this.request(
      "GET",
      `/api/household/${householdId}/expense/overview?${query.toString()}`
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
  addShoppingListItemByName(shoppingListId, name, description) {
    return this.request("POST", `/api/shoppinglist/${shoppingListId}/add-item-by-name`, {
      body: { name, description: description != null ? description : "" }
    });
  }
  /**
   * Takes one item off a shopping list.
   *
   * @param shoppingListId - Shopping list to act on
   * @param itemId - Item to act on
   */
  removeShoppingListItem(shoppingListId, itemId) {
    return this.request("DELETE", `/api/shoppinglist/${shoppingListId}/item`, {
      body: { item_id: itemId }
    });
  }
  /**
   * Takes every item off a shopping list.
   *
   * @param shoppingListId - Shopping list to act on
   */
  async clearShoppingList(shoppingListId) {
    const items = await this.shoppingListItems(shoppingListId);
    if (items.length === 0) {
      return void 0;
    }
    return this.request("DELETE", `/api/shoppinglist/${shoppingListId}/items`, {
      body: { items: items.map((item) => ({ item_id: item.id })) }
    });
  }
  /**
   * Changes an item's description on a list, typically the amount.
   *
   * @param shoppingListId - Shopping list to act on
   * @param itemId - Item to act on
   * @param description - Free-text description, for example the amount
   */
  updateShoppingListItemDescription(shoppingListId, itemId, description) {
    return this.request("POST", `/api/shoppinglist/${shoppingListId}/item/${itemId}`, {
      body: { description }
    });
  }
  /**
   * Books a new expense.
   *
   * @param householdId - Household to act on
   * @param expense - Expense payload accepted by the API
   */
  addExpense(householdId, expense) {
    return this.request("POST", `/api/household/${householdId}/expense`, { body: expense });
  }
  /**
   * Deletes an expense.
   *
   * @param expenseId - Expense to delete
   */
  deleteExpense(expenseId) {
    return this.request("DELETE", `/api/expense/${expenseId}`, { body: {} });
  }
  /**
   * Asks the server to recompute every member balance.
   *
   * @param householdId - Household to act on
   */
  recalculateBalances(householdId) {
    return this.request("GET", `/api/household/${householdId}/expense/recalculate-balances`);
  }
  /**
   * Puts a recipe on the meal plan.
   *
   * @param householdId - Household to act on
   * @param entry - Planner entry payload accepted by the API
   */
  addPlannedRecipe(householdId, entry) {
    return this.request("POST", `/api/household/${householdId}/planner/recipe`, { body: entry });
  }
  /**
   * Takes a recipe off the meal plan.
   *
   * @param householdId - Household to act on
   * @param recipeId - Recipe to act on
   * @param cookingDate
   */
  removePlannedRecipe(householdId, recipeId, cookingDate) {
    const body = typeof cookingDate === "number" ? { cooking_date: cookingDate } : {};
    return this.request("DELETE", `/api/household/${householdId}/planner/recipe/${recipeId}`, { body });
  }
  /**
   * Imports a recipe from a public URL.
   *
   * @param householdId - Household to act on
   * @param url - Public recipe URL to import
   */
  scrapeRecipe(householdId, url) {
    const query = new URLSearchParams({ url });
    return this.request("GET", `/api/household/${householdId}/recipe/scrape?${query.toString()}`);
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
  async request(method, path, options = {}) {
    var _a;
    if (this.destroyed) {
      throw new Error("Client has been destroyed");
    }
    let lastError = new Error(`Request to ${path} never ran`);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        await this.sleep(this.retryDelay * attempt);
        if (this.destroyed) {
          throw new Error("Client has been destroyed");
        }
      }
      try {
        return await this.perform(method, path, options);
      } catch (error) {
        lastError = error;
        if (error instanceof KitchenOwlApiError && error.status >= 400 && error.status < 500 && !RETRYABLE_CLIENT_ERRORS.has(error.status)) {
          throw error;
        }
        if (this.destroyed) {
          throw error;
        }
        (_a = this.log) == null ? void 0 : _a.call(this, `${method} ${path} failed (attempt ${attempt + 1}): ${lastError.message}`);
      }
    }
    throw lastError;
  }
  async perform(method, path, options) {
    const headers = { Accept: "application/json" };
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (options.body !== void 0) {
      headers["Content-Type"] = "application/json";
    }
    const timeout = AbortSignal.timeout(this.timeout);
    const init = {
      method,
      headers,
      // Fail the request on timeout, and also when the adapter is unloading.
      signal: AbortSignal.any([timeout, this.abortController.signal])
    };
    if (options.body !== void 0) {
      init.body = JSON.stringify(options.body);
    }
    if (this.dispatcher) {
      init.dispatcher = this.dispatcher;
    }
    let response;
    try {
      response = await (0, import_undici.fetch)(`${this.baseUrl}${path}`, init);
    } catch (error) {
      if (timeout.aborted) {
        throw new Error(`${method} ${path} timed out after ${this.timeout} ms`);
      }
      throw error;
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).trim().slice(0, 200);
      throw new KitchenOwlApiError(
        `${method} ${path} returned ${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`,
        response.status,
        path
      );
    }
    const text = await response.text();
    if (!text) {
      return void 0;
    }
    try {
      return JSON.parse(text);
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
  async sleep(ms) {
    try {
      await (0, import_promises.setTimeout)(ms, void 0, { signal: this.abortController.signal });
    } catch {
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPENSE_PAGE_SIZE,
  HEALTH_PATH,
  KitchenOwlApiError,
  KitchenOwlClient
});
//# sourceMappingURL=api.js.map
