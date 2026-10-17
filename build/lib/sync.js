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
var sync_exports = {};
__export(sync_exports, {
  householdBase: () => householdBase,
  syncCatalog: () => syncCatalog,
  syncExpenses: () => syncExpenses,
  syncHousehold: () => syncHousehold,
  syncMembers: () => syncMembers,
  syncPlanner: () => syncPlanner,
  syncRecipes: () => syncRecipes,
  syncShoppingLists: () => syncShoppingLists
});
module.exports = __toCommonJS(sync_exports);
var import_ids = require("./ids");
var import_types = require("./types");
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
function photo(client, filename) {
  return filename ? client.photoUrl(filename) : null;
}
function argbToHex(argb) {
  if (typeof argb !== "number" || !Number.isFinite(argb)) {
    return "";
  }
  return `#${(argb & 16777215).toString(16).padStart(6, "0")}`;
}
function slimItem(item) {
  var _a, _b, _c;
  const slim = {
    id: item.id,
    name: item.name,
    category: (_b = (_a = item.category) == null ? void 0 : _a.name) != null ? _b : null,
    icon: (_c = item.icon) != null ? _c : null
  };
  if (item.description !== void 0) {
    slim.description = item.description;
  }
  if (item.optional !== void 0) {
    slim.optional = item.optional;
  }
  return slim;
}
function syncHousehold(writer, client, base, household) {
  var _a, _b, _c, _d, _e, _f;
  writer.serverChannel(base, household.name, "device");
  writer.value(`${base}.name`, "Name", "string", "text", household.name);
  writer.value(`${base}.description`, "Description", "string", "text", (_a = household.description) != null ? _a : "");
  writer.value(`${base}.language`, "Language", "string", "text", (_b = household.language) != null ? _b : "");
  writer.value(`${base}.photoUrl`, "Photo URL", "string", "text.url", (_c = photo(client, household.photo)) != null ? _c : "");
  writer.value(
    `${base}.expensesFeature`,
    "Expenses feature enabled",
    "boolean",
    "indicator",
    !!household.expenses_feature
  );
  writer.value(
    `${base}.plannerFeature`,
    "Planner feature enabled",
    "boolean",
    "indicator",
    !!household.planner_feature
  );
  writer.value(
    `${base}.defaultShoppingListId`,
    "Default shopping list ID",
    "number",
    "value",
    (_e = (_d = household.default_shopping_list) == null ? void 0 : _d.id) != null ? _e : 0
  );
  writer.json(`${base}.viewOrdering`, "Configured view order", (_f = household.view_ordering) != null ? _f : []);
}
function syncMembers(writer, client, base, household) {
  var _a, _b, _c;
  const members = (_a = household.member) != null ? _a : [];
  const root = `${base}.members`;
  writer.channel(root, "Household members");
  writer.value(`${root}.count`, "Number of members", "number", "value", members.length);
  writer.json(
    `${root}.balancesJson`,
    "Expense balance per member",
    Object.fromEntries(members.map((member) => {
      var _a2;
      return [member.username, (0, import_ids.round2)((_a2 = member.expense_balance) != null ? _a2 : 0)];
    }))
  );
  const segments = (0, import_ids.memberIds)(members);
  for (const member of members) {
    const id = `${root}.${segments.get(member.id)}`;
    writer.serverChannel(id, member.name);
    writer.value(`${id}.id`, "User ID", "number", "value", member.id);
    writer.value(`${id}.name`, "Display name", "string", "text", member.name);
    writer.value(`${id}.username`, "Username", "string", "text", member.username);
    writer.value(`${id}.balance`, "Expense balance", "number", "value", (0, import_ids.round2)((_b = member.expense_balance) != null ? _b : 0));
    writer.value(`${id}.isHouseholdAdmin`, "Household administrator", "boolean", "indicator", !!member.admin);
    writer.value(`${id}.isOwner`, "Household owner", "boolean", "indicator", !!member.owner);
    writer.value(`${id}.lastSeen`, "Last seen", "number", "value.time", (0, import_ids.toTimestamp)(member.last_seen));
    writer.value(`${id}.photoUrl`, "Photo URL", "string", "text.url", (_c = photo(client, member.photo)) != null ? _c : "");
  }
}
function syncShoppingLists(writer, base, lists, config) {
  var _a, _b, _c, _d, _e, _f, _g;
  const root = `${base}.shoppingLists`;
  writer.channel(root, "Shopping lists");
  writer.value(`${root}.count`, "Number of lists", "number", "value", lists.length);
  writer.json(
    `${root}.json`,
    "All shopping lists",
    lists.map((list) => {
      var _a2, _b2;
      return { id: list.id, name: list.name, itemCount: (_b2 = (_a2 = list.items) == null ? void 0 : _a2.length) != null ? _b2 : 0 };
    })
  );
  for (const list of lists) {
    const id = `${root}.${list.id}`;
    const items = (_a = list.items) != null ? _a : [];
    writer.serverChannel(id, list.name);
    writer.value(`${id}.name`, "Name", "string", "text", list.name);
    writer.value(`${id}.itemCount`, "Number of items", "number", "value", items.length);
    writer.value(`${id}.itemNames`, "Items as text", "string", "text", items.map((item) => item.name).join(", "));
    writer.json(`${id}.json`, "All items on the list", items.map(slimItem));
    writer.json(`${id}.recentItemsJson`, "Recently removed items", ((_b = list.recentItems) != null ? _b : []).map(slimItem));
    if (config.enableWrite) {
      writer.state({
        id: `${id}.addItemByName`,
        name: 'Add an item by name, or as JSON: {"name": "Milk", "description": "2 L"}',
        type: "string",
        role: "text",
        read: false,
        write: true
      });
      writer.button(`${id}.clear`, "Remove all items from the list");
    }
    if (!config.createShoppingItemObjects) {
      continue;
    }
    const itemsRoot = `${id}.items`;
    writer.channel(itemsRoot, "Items");
    for (const item of items) {
      const itemId = `${itemsRoot}.${item.id}`;
      writer.serverChannel(itemId, item.name);
      writer.value(`${itemId}.name`, "Name", "string", "text", item.name);
      writer.value(`${itemId}.category`, "Category", "string", "text", (_d = (_c = item.category) == null ? void 0 : _c.name) != null ? _d : "");
      writer.value(`${itemId}.icon`, "Icon key", "string", "text", (_e = item.icon) != null ? _e : "");
      if (config.enableWrite) {
        writer.state({
          id: `${itemId}.description`,
          name: "Description, for example the amount",
          type: "string",
          role: "text",
          value: (_f = item.description) != null ? _f : "",
          read: true,
          write: true
        });
        writer.button(`${itemId}.remove`, "Remove this item from the list");
      } else {
        writer.value(`${itemId}.description`, "Description", "string", "text", (_g = item.description) != null ? _g : "");
      }
    }
  }
}
function syncRecipes(writer, client, base, recipes, config) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
  const root = `${base}.recipes`;
  writer.channel(root, "Recipes");
  writer.value(`${root}.count`, "Number of recipes", "number", "value", recipes.length);
  writer.json(
    `${root}.json`,
    "Recipe overview",
    recipes.map((recipe) => {
      var _a2, _b2, _c2;
      return {
        id: recipe.id,
        name: recipe.name,
        time: (_a2 = recipe.time) != null ? _a2 : 0,
        yields: (_b2 = recipe.yields) != null ? _b2 : null,
        planned: !!recipe.planned,
        tags: ((_c2 = recipe.tags) != null ? _c2 : []).map((tag) => tag.name)
      };
    })
  );
  if (config.enableWrite) {
    writer.state({
      id: `${root}.scrapeUrl`,
      name: "Import a recipe from a URL",
      type: "string",
      role: "text.url",
      read: false,
      write: true
    });
    writer.state({
      id: `${root}.scrapeResult`,
      name: "Result of the last import",
      type: "string",
      role: "json",
      read: true,
      write: false
    });
  }
  if (!config.createRecipeObjects) {
    return;
  }
  for (const recipe of recipes) {
    const id = `${root}.${recipe.id}`;
    writer.serverChannel(id, recipe.name);
    writer.value(`${id}.name`, "Name", "string", "text", recipe.name);
    writer.value(`${id}.description`, "Description", "string", "text", (_a = recipe.description) != null ? _a : "");
    writer.value(`${id}.time`, "Total time", "number", "value", (_b = recipe.time) != null ? _b : 0, "min");
    writer.value(`${id}.prepTime`, "Preparation time", "number", "value", (_c = recipe.prep_time) != null ? _c : 0, "min");
    writer.value(`${id}.cookTime`, "Cooking time", "number", "value", (_d = recipe.cook_time) != null ? _d : 0, "min");
    writer.value(`${id}.yields`, "Servings", "number", "value", (_e = recipe.yields) != null ? _e : 0);
    writer.value(`${id}.source`, "Source", "string", "text.url", (_f = recipe.source) != null ? _f : "");
    writer.value(`${id}.photoUrl`, "Photo URL", "string", "text.url", (_g = photo(client, recipe.photo)) != null ? _g : "");
    writer.value(
      `${id}.tags`,
      "Tags as text",
      "string",
      "text",
      ((_h = recipe.tags) != null ? _h : []).map((tag) => tag.name).join(", ")
    );
    writer.value(`${id}.planned`, "Currently planned", "boolean", "indicator", !!recipe.planned);
    writer.json(`${id}.plannedDays`, "Planned weekdays", (_i = recipe.planned_days) != null ? _i : []);
    writer.state({
      id: `${id}.visibility`,
      name: "Visibility",
      type: "number",
      role: "value",
      value: (_j = recipe.visibility) != null ? _j : import_types.RecipeVisibility.Private,
      // Without these the admin UI shows a bare 0, 1 or 2.
      states: { 0: "private", 1: "link", 2: "public" }
    });
    writer.json(`${id}.itemsJson`, "Ingredients", ((_k = recipe.items) != null ? _k : []).map(slimItem));
  }
}
function syncPlanner(writer, base, entries, config, now = Date.now()) {
  var _a, _b, _c, _d, _e, _f, _g;
  const root = `${base}.planner`;
  writer.channel(root, "Meal planner");
  writer.value(`${root}.count`, "Number of planned meals", "number", "value", entries.length);
  writer.json(
    `${root}.json`,
    "Planned meals",
    entries.map((entry) => {
      var _a2, _b2, _c2, _d2;
      return {
        recipeId: entry.recipe_id,
        recipeName: (_b2 = (_a2 = entry.recipe) == null ? void 0 : _a2.name) != null ? _b2 : "",
        day: (_c2 = entry.day) != null ? _c2 : -1,
        cookingDate: (0, import_ids.toTimestamp)(entry.cooking_date),
        yields: (_d2 = entry.yields) != null ? _d2 : null
      };
    })
  );
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const upcoming = entries.filter((entry) => {
    const date = (0, import_ids.toTimestamp)(entry.cooking_date);
    return date !== null && date >= today.getTime();
  }).sort((a, b) => {
    var _a2, _b2;
    return ((_a2 = a.cooking_date) != null ? _a2 : 0) - ((_b2 = b.cooking_date) != null ? _b2 : 0);
  })[0];
  writer.value(`${root}.nextRecipeName`, "Next planned meal", "string", "text", (_b = (_a = upcoming == null ? void 0 : upcoming.recipe) == null ? void 0 : _a.name) != null ? _b : "");
  writer.value(`${root}.nextRecipeId`, "Next planned recipe ID", "number", "value", (_c = upcoming == null ? void 0 : upcoming.recipe_id) != null ? _c : 0);
  writer.value(
    `${root}.nextCookingDate`,
    "Next cooking date",
    "number",
    "value.time",
    (0, import_ids.toTimestamp)(upcoming == null ? void 0 : upcoming.cooking_date)
  );
  if (config.enableWrite) {
    writer.state({
      id: `${root}.addRecipe`,
      name: 'Plan a recipe, as JSON: {"recipe_id": 1, "cooking_date": 1700000000000}',
      type: "string",
      role: "json",
      read: false,
      write: true
    });
  }
  const daysRoot = `${root}.days`;
  writer.channel(daysRoot, "Planned meals by weekday");
  for (let day = 0; day < WEEKDAYS.length; day++) {
    const id = `${daysRoot}.${day}`;
    const entry = entries.find((candidate) => candidate.day === day);
    writer.channel(id, WEEKDAYS[day]);
    writer.value(`${id}.recipeId`, "Recipe ID", "number", "value", (_d = entry == null ? void 0 : entry.recipe_id) != null ? _d : 0);
    writer.value(`${id}.recipeName`, "Recipe name", "string", "text", (_f = (_e = entry == null ? void 0 : entry.recipe) == null ? void 0 : _e.name) != null ? _f : "");
    writer.value(`${id}.yields`, "Servings", "number", "value", (_g = entry == null ? void 0 : entry.yields) != null ? _g : 0);
    writer.value(`${id}.date`, "Cooking date", "number", "value.time", (0, import_ids.toTimestamp)(entry == null ? void 0 : entry.cooking_date));
    if (config.enableWrite) {
      writer.button(`${id}.remove`, "Remove this meal from the plan");
    }
  }
}
function syncExpenses(writer, base, expenses, categories, overview, config, memberNames = /* @__PURE__ */ new Map()) {
  var _a, _b, _c, _d;
  const payer = (userId) => {
    var _a2;
    return userId === void 0 ? "" : (_a2 = memberNames.get(userId)) != null ? _a2 : `#${userId}`;
  };
  const root = `${base}.expenses`;
  const newest = expenses[0];
  const currentPeriod = overview["0"];
  writer.channel(root, "Expenses");
  writer.value(`${root}.count`, "Number of expenses read", "number", "value", expenses.length);
  writer.json(
    `${root}.recentJson`,
    "Recent expenses",
    expenses.map((expense) => {
      var _a2, _b2;
      return {
        id: expense.id,
        name: expense.name,
        amount: (0, import_ids.round2)(expense.amount),
        date: (0, import_ids.toTimestamp)(expense.date),
        paidBy: payer(expense.paid_by_id),
        category: (_b2 = (_a2 = expense.category) == null ? void 0 : _a2.name) != null ? _b2 : null
      };
    })
  );
  writer.json(`${root}.overviewJson`, "Spending overview by period", overview);
  const currentTotal = currentPeriod ? (0, import_ids.round2)(Object.values(currentPeriod.by_category).reduce((sum, value) => sum + value, 0)) : 0;
  writer.value(`${root}.currentPeriodTotal`, "Total spent in the current period", "number", "value", currentTotal);
  writer.value(`${root}.newestName`, "Newest expense", "string", "text", (_a = newest == null ? void 0 : newest.name) != null ? _a : "");
  writer.value(`${root}.newestAmount`, "Newest expense amount", "number", "value", (0, import_ids.round2)((_b = newest == null ? void 0 : newest.amount) != null ? _b : 0));
  writer.value(`${root}.newestDate`, "Newest expense date", "number", "value.time", (0, import_ids.toTimestamp)(newest == null ? void 0 : newest.date));
  writer.value(`${root}.newestPaidBy`, "Newest expense paid by", "string", "text", payer(newest == null ? void 0 : newest.paid_by_id));
  if (config.enableWrite) {
    writer.state({
      id: `${root}.add`,
      name: 'Add an expense, as JSON: {"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}]}',
      type: "string",
      role: "json",
      read: false,
      write: true
    });
    writer.button(`${root}.recalculateBalances`, "Recalculate member balances");
  }
  const categoriesRoot = `${root}.categories`;
  writer.channel(categoriesRoot, "Expense categories");
  for (const category of categories) {
    const id = `${categoriesRoot}.${category.id}`;
    writer.serverChannel(id, category.name);
    writer.value(`${id}.name`, "Name", "string", "text", category.name);
    writer.value(`${id}.budget`, "Budget", "number", "value", (_c = category.budget) != null ? _c : 0);
    writer.value(`${id}.color`, "Colour", "string", "level.color.rgb", argbToHex(category.color));
    writer.value(
      `${id}.currentPeriodSum`,
      "Spent in the current period",
      "number",
      "value",
      (0, import_ids.round2)((_d = currentPeriod == null ? void 0 : currentPeriod.by_category[String(category.id)]) != null ? _d : 0)
    );
  }
  const uncategorized = currentPeriod == null ? void 0 : currentPeriod.by_category["-1"];
  if (uncategorized !== void 0) {
    const id = `${categoriesRoot}.uncategorized`;
    writer.channel(id, "Uncategorised");
    writer.value(`${id}.currentPeriodSum`, "Spent in the current period", "number", "value", (0, import_ids.round2)(uncategorized));
  }
}
function syncCatalog(writer, base, items, categories, tags) {
  const root = `${base}.catalog`;
  writer.channel(root, "Item catalog");
  writer.value(`${root}.itemCount`, "Number of known items", "number", "value", items.length);
  writer.json(`${root}.itemsJson`, "All known items", items.map(slimItem));
  writer.value(`${root}.categoryCount`, "Number of categories", "number", "value", categories.length);
  writer.json(
    `${root}.categoriesJson`,
    "All item categories",
    categories.map((category) => {
      var _a;
      return { id: category.id, name: category.name, ordering: (_a = category.ordering) != null ? _a : 0 };
    })
  );
  writer.value(`${root}.tagCount`, "Number of tags", "number", "value", tags.length);
  writer.json(
    `${root}.tagsJson`,
    "All recipe tags",
    tags.map((tag) => ({ id: tag.id, name: tag.name }))
  );
}
function householdBase(household) {
  return `households.${(0, import_ids.toId)(String(household.id))}`;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  householdBase,
  syncCatalog,
  syncExpenses,
  syncHousehold,
  syncMembers,
  syncPlanner,
  syncRecipes,
  syncShoppingLists
});
//# sourceMappingURL=sync.js.map
