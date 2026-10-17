"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_api = require("./lib/api");
var import_commands = require("./lib/commands");
var import_instance = require("./lib/instance");
var import_objects = require("./lib/objects");
var import_photos = require("./lib/photos");
var import_sync = require("./lib/sync");
class Kitchenowl extends utils.Adapter {
  client;
  pollTimer;
  refreshTimer;
  unloading = false;
  /** True while a poll runs, so a manual refresh cannot start a second one. */
  polling = false;
  /** Set when a refresh arrives mid-poll, so the request is served afterwards. */
  pollAgain = false;
  /**
   * Object definitions already applied, kept across polls. Only a definition
   * that actually changed costs an object database round trip.
   */
  objectCache = /* @__PURE__ */ new Map();
  /** Last known meal plan per household, so `days.<n>.remove` can find its recipe. */
  plannerCache = /* @__PURE__ */ new Map();
  /** Counts polls, so the slow branches can sit most of them out. */
  pollCount = 0;
  photos;
  /** Photos seen this poll, so unreferenced copies can be cleaned up. */
  photosSeen = /* @__PURE__ */ new Set();
  constructor(options = {}) {
    super({
      ...options,
      name: "kitchenowl"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("stateChange", this.onStateChange.bind(this));
    this.on("message", this.onMessage.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    var _a, _b;
    await this.setState("info.connection", false, true);
    const url = ((_a = this.config.url) != null ? _a : "").trim();
    const token = ((_b = this.config.token) != null ? _b : "").trim();
    if (!url || !token) {
      this.log.error("Please configure the server URL and an API token in the instance settings.");
      await this.setState("info.lastError", "Server URL or API token is missing", true);
      return;
    }
    this.client = new import_api.KitchenOwlClient({
      url,
      token,
      // With caching on, photo URLs point at our own copy, which needs no token.
      photoBase: this.config.cachePhotos ? import_photos.PhotoCache.urlBase(this.namespace) : void 0,
      timeout: this.config.requestTimeout,
      retries: this.config.retries,
      retryDelay: this.config.retryDelay,
      rejectUnauthorized: this.config.rejectUnauthorized,
      log: (message) => this.log.debug(message)
    });
    await this.subscribeStatesAsync("commands.refresh");
    if (this.config.enableWrite) {
      await this.subscribeStatesAsync("households.*");
      this.log.info("Write access is enabled: writable states will change data in KitchenOwl.");
    }
    await this.poll();
  }
  /** Reads everything that is enabled and writes it into the object tree. */
  async poll() {
    if (!this.client || this.unloading) {
      return;
    }
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    try {
      const health = await this.client.health();
      await this.setStateChangedAsync("info.serverVersion", { val: health.version, ack: true });
      await this.setStateChangedAsync("info.minFrontendVersion", {
        val: health.min_frontend_version,
        ack: true
      });
      const households = await this.householdsToSync();
      if (households.length === 0) {
        this.log.warn("No matching household was found for the configured token.");
      }
      const factor = Math.max(1, this.config.slowPollFactor || 1);
      const withSlow = this.pollCount % factor === 0;
      this.pollCount++;
      const writer = new import_objects.ObjectWriter(this, this.objectCache);
      writer.channel("households", "Households", "folder");
      this.photosSeen = /* @__PURE__ */ new Set();
      let failed = 0;
      let lastHouseholdError = "";
      for (const household of households) {
        try {
          await this.syncOneHousehold(writer, household, withSlow);
        } catch (error) {
          if (error instanceof import_api.KitchenOwlApiError && error.isAuthError) {
            throw error;
          }
          failed++;
          lastHouseholdError = `Household ${household.name} (${household.id}) could not be read: ${error.message}`;
          this.log.warn(lastHouseholdError);
        }
      }
      if (failed > 0 && failed === households.length) {
        throw new Error(lastHouseholdError);
      }
      await writer.flush();
      if (this.photos) {
        await this.photos.store(this.photosSeen);
        if (withSlow && failed === 0) {
          await this.photos.prune(this.photosSeen);
        }
      }
      if (this.config.deleteStaleObjects) {
        if (failed > 0) {
          this.log.debug("Skipping the cleanup of stale objects: a household could not be read");
        } else {
          const deleted = await writer.prune(["households"]);
          if (deleted > 0) {
            this.log.debug(`Removed ${deleted} object(s) that no longer exist in KitchenOwl`);
          }
        }
      }
      await this.setState("info.connection", true, true);
      await this.setState("info.lastUpdate", Date.now(), true);
      await this.setStateChangedAsync("info.lastError", { val: lastHouseholdError, ack: true });
      this.log.debug(`Poll finished for ${households.length - failed} of ${households.length} household(s)`);
    } catch (error) {
      const message = error.message;
      await this.setState("info.connection", false, true);
      await this.setStateChangedAsync("info.lastError", { val: message, ack: true });
      if (error instanceof import_api.KitchenOwlApiError && error.isAuthError) {
        this.log.error(`The API token was rejected by the server: ${message}`);
      } else {
        this.log.error(`Poll failed: ${message}`);
      }
    } finally {
      this.polling = false;
      if (this.pollAgain && !this.unloading) {
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
   * @param withSlow
   */
  async syncOneHousehold(writer, household, withSlow) {
    var _a, _b;
    const client = this.client;
    const base = (0, import_sync.householdBase)(household);
    const config = this.syncConfig();
    this.rememberPhoto(household.photo);
    for (const member of (_a = household.member) != null ? _a : []) {
      this.rememberPhoto(member.photo);
    }
    (0, import_sync.syncHousehold)(writer, client, base, household);
    if (config.syncMembers) {
      (0, import_sync.syncMembers)(writer, client, base, household);
    }
    if (config.syncShoppingLists) {
      (0, import_sync.syncShoppingLists)(writer, base, await client.shoppingLists(household.id), config);
    }
    if (config.syncRecipes) {
      if (withSlow) {
        const recipes = await client.recipes(household.id);
        for (const recipe of recipes) {
          this.rememberPhoto(recipe.photo);
        }
        (0, import_sync.syncRecipes)(writer, client, base, recipes, config);
      } else {
        writer.keepTree(`${base}.recipes`);
      }
    }
    if (config.syncPlanner && household.planner_feature) {
      const entries = await client.planner(household.id);
      this.plannerCache.set(household.id, entries);
      (0, import_sync.syncPlanner)(writer, base, entries, config);
    }
    if (config.syncExpenses && household.expenses_feature) {
      const memberNames = new Map(((_b = household.member) != null ? _b : []).map((member) => [member.id, member.name]));
      const [expenses, categories, overview] = await Promise.all([
        client.expenses(household.id, config.expenseView, config.expensePages),
        client.expenseCategories(household.id),
        client.expenseOverview(
          household.id,
          config.expenseOverviewFrame,
          config.expenseOverviewSteps,
          config.expenseView
        )
      ]);
      for (const expense of expenses) {
        this.rememberPhoto(expense.photo);
      }
      (0, import_sync.syncExpenses)(writer, base, expenses, categories, overview, config, memberNames);
    }
    if (config.syncCatalog) {
      if (withSlow) {
        const [items, categories, tags] = await Promise.all([
          client.items(household.id),
          client.categories(household.id),
          client.tags(household.id)
        ]);
        (0, import_sync.syncCatalog)(writer, base, items, categories, tags);
      } else {
        writer.keepTree(`${base}.catalog`);
      }
    }
  }
  /**
   * Notes a photo this poll referred to, so it can be fetched and kept.
   *
   * @param filename - Photo filename from the API, if the object has one
   */
  rememberPhoto(filename) {
    if (this.photos && filename) {
      this.photosSeen.add(filename);
    }
  }
  /** The households to synchronise, filtered by the instance configuration. */
  async householdsToSync() {
    const { selected, missing } = (0, import_instance.selectHouseholds)(await this.client.households(), this.config.householdIds);
    for (const id of missing) {
      this.log.warn(`Configured household ${id} is not visible to this token and will be skipped.`);
    }
    return selected;
  }
  syncConfig() {
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
      expensePages: this.config.expensePages
    };
  }
  /** Arms the next poll, unless the adapter is shutting down. */
  schedulePoll() {
    if (this.unloading) {
      return;
    }
    const interval = Math.max(30, this.config.pollInterval || 300) * 1e3;
    this.pollTimer = this.setTimeout(() => {
      this.pollTimer = void 0;
      void this.poll();
    }, interval);
  }
  /**
   * Is called if a subscribed state changes
   *
   * @param id - State ID
   * @param state - State object
   */
  onStateChange(id, state) {
    if (!state || state.ack) {
      return;
    }
    const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
    if (relativeId === "commands.refresh") {
      this.log.info("Manual refresh requested");
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
  async handleWrite(relativeId, state) {
    if (!this.config.enableWrite || !this.client) {
      return;
    }
    const command = (0, import_commands.parseCommand)(relativeId);
    if (!command) {
      return;
    }
    try {
      const result = await (0, import_commands.runCommand)(
        { client: this.client, log: this.log },
        command,
        state.val,
        (householdId, day) => {
          var _a;
          return ((_a = this.plannerCache.get(householdId)) != null ? _a : []).filter((entry) => entry.day === day).map((entry) => {
            var _a2;
            return { recipeId: entry.recipe_id, cookingDate: (_a2 = entry.cooking_date) != null ? _a2 : null };
          });
        }
      );
      this.log.info(`Command ${command.kind} succeeded for household ${command.householdId}`);
      if (command.kind === "recipes.scrapeUrl") {
        await this.setState(`households.${command.householdId}.recipes.scrapeResult`, {
          val: JSON.stringify(result != null ? result : null),
          ack: true
        });
      }
      await this.setState(relativeId, { val: state.val, ack: true });
      this.scheduleRefresh();
    } catch (error) {
      this.log.error(`Command ${command.kind} failed: ${error.message}`);
      await this.setStateChangedAsync("info.lastError", { val: error.message, ack: true });
    }
  }
  /** Re-reads the server shortly after a write, so the tree catches up. */
  scheduleRefresh() {
    var _a;
    if (this.unloading || this.refreshTimer) {
      return;
    }
    const delay = Math.max(0, (_a = this.config.writeRefreshDelay) != null ? _a : 1500);
    this.refreshTimer = this.setTimeout(() => {
      this.refreshTimer = void 0;
      void this.refreshNow();
    }, delay);
  }
  /**
   * Cancels the pending poll and runs one immediately.
   *
   * Returns what happened, so that a caller waiting on the message box is not
   * told the data is current when the poll has yet to start.
   */
  async refreshNow() {
    if (this.polling) {
      this.pollAgain = true;
      return "A poll is already running; another one follows right after it";
    }
    if (this.pollTimer) {
      this.clearTimeout(this.pollTimer);
      this.pollTimer = void 0;
    }
    await this.poll();
    return "Refresh finished";
  }
  /**
   * Some message was sent to this instance over message box.
   * Requires "common.messagebox" to be true in io-package.json.
   *
   * @param obj - The incoming message
   */
  async onMessage(obj) {
    if (typeof obj !== "object" || !obj.command) {
      return;
    }
    const respond = (payload) => {
      if (obj.callback) {
        this.sendTo(obj.from, obj.command, payload, obj.callback);
      }
    };
    try {
      switch (obj.command) {
        case "getHouseholds": {
          const client = this.clientFromMessage(obj.message);
          try {
            const households = await client.households();
            respond(
              households.map((household) => ({
                value: String(household.id),
                label: household.name
              }))
            );
          } finally {
            await client.destroy();
          }
          return;
        }
        case "testConnection": {
          const client = this.clientFromMessage(obj.message);
          try {
            const health = await client.health();
            const households = await client.households();
            respond({
              result: `Connected. Server version ${health.version}, ${households.length} household(s) available: ${households.map((household) => household.name).join(", ")}`
            });
          } finally {
            await client.destroy();
          }
          return;
        }
        case "refresh":
          respond({ result: await this.refreshNow() });
          return;
        default:
          respond({ error: `Unknown command: ${obj.command}` });
      }
    } catch (error) {
      this.log.warn(`Message ${obj.command} failed: ${error.message}`);
      respond({ error: error.message });
    }
  }
  /**
   * Builds a client from a message payload, falling back to the saved config.
   *
   * @param message - Payload sent with the message
   */
  clientFromMessage(message) {
    const options = (0, import_instance.connectionOptions)(message, this.config);
    return new import_api.KitchenOwlClient({
      ...options,
      // One attempt is enough while someone waits in front of the admin UI.
      retries: 0,
      log: (text) => this.log.debug(text)
    });
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   *
   * @param callback - Callback function
   */
  onUnload(callback) {
    var _a;
    try {
      this.unloading = true;
      if (this.pollTimer) {
        this.clearTimeout(this.pollTimer);
        this.pollTimer = void 0;
      }
      if (this.refreshTimer) {
        this.clearTimeout(this.refreshTimer);
        this.refreshTimer = void 0;
      }
      void ((_a = this.client) == null ? void 0 : _a.destroy());
      this.client = void 0;
      callback();
    } catch (error) {
      this.log.error(`Error during unloading: ${error.message}`);
      callback();
    }
  }
}
if (require.main !== module) {
  module.exports = (options) => new Kitchenowl(options);
} else {
  (() => new Kitchenowl())();
}
//# sourceMappingURL=main.js.map
