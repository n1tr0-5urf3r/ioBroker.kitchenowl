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
var commands_exports = {};
__export(commands_exports, {
  EXPENSE_EXAMPLE: () => EXPENSE_EXAMPLE,
  parseCommand: () => parseCommand,
  parseItemInput: () => parseItemInput,
  parseJsonPayload: () => parseJsonPayload,
  runCommand: () => runCommand
});
module.exports = __toCommonJS(commands_exports);
function parseCommand(relativeId) {
  const parts = relativeId.split(".");
  if (parts[0] !== "households" || parts.length < 3) {
    return null;
  }
  const householdId = Number(parts[1]);
  if (!Number.isFinite(householdId)) {
    return null;
  }
  const [, , branch, ...rest] = parts;
  if (branch === "shoppingLists") {
    const shoppingListId = Number(rest[0]);
    if (!Number.isFinite(shoppingListId)) {
      return null;
    }
    if (rest[1] === "addItemByName") {
      return { householdId, kind: "shoppingList.addItemByName", shoppingListId };
    }
    if (rest[1] === "clear") {
      return { householdId, kind: "shoppingList.clear", shoppingListId };
    }
    if (rest[1] === "items" && rest.length === 4) {
      const itemId = Number(rest[2]);
      if (!Number.isFinite(itemId)) {
        return null;
      }
      if (rest[3] === "remove") {
        return { householdId, kind: "shoppingList.item.remove", shoppingListId, itemId };
      }
      if (rest[3] === "description") {
        return { householdId, kind: "shoppingList.item.description", shoppingListId, itemId };
      }
    }
    return null;
  }
  if (branch === "expenses") {
    if (rest[0] === "add") {
      return { householdId, kind: "expenses.add" };
    }
    if (rest[0] === "recalculateBalances") {
      return { householdId, kind: "expenses.recalculateBalances" };
    }
    return null;
  }
  if (branch === "planner") {
    if (rest[0] === "addRecipe") {
      return { householdId, kind: "planner.addRecipe" };
    }
    if (rest[0] === "days" && rest[2] === "remove") {
      const day = Number(rest[1]);
      return Number.isFinite(day) ? { householdId, kind: "planner.day.remove", day } : null;
    }
    return null;
  }
  if (branch === "recipes" && rest[0] === "scrapeUrl") {
    return { householdId, kind: "recipes.scrapeUrl" };
  }
  return null;
}
const EXPENSE_EXAMPLE = '{"name": "Groceries", "amount": 12.5, "paid_by": {"id": 1}, "paid_for": [{"id": 1}, {"id": 2}]}';
function isUserRef(value) {
  return typeof value === "object" && value !== null && typeof value.id === "number";
}
function parseJsonPayload(value, what) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${what} expects a JSON object as a string`);
  }
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${what} received a value that is not valid JSON`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${what} expects a JSON object`);
  }
  return parsed;
}
function parseItemInput(value) {
  const text = String(value != null ? value : "").trim();
  if (!text.startsWith("{")) {
    return { name: text };
  }
  const payload = parseJsonPayload(text, "Adding an item");
  if (typeof payload.name !== "string") {
    throw new Error('Adding an item as JSON needs a "name" string');
  }
  return {
    name: payload.name.trim(),
    description: typeof payload.description === "string" ? payload.description : void 0
  };
}
async function runCommand(context, command, value, plannedOnDay) {
  const { client } = context;
  switch (command.kind) {
    case "shoppingList.addItemByName": {
      const { name, description } = parseItemInput(value);
      if (!name) {
        throw new Error("Adding an item needs a non-empty name");
      }
      return client.addShoppingListItemByName(command.shoppingListId, name, description);
    }
    case "shoppingList.clear":
      return client.clearShoppingList(command.shoppingListId);
    case "shoppingList.item.remove":
      return client.removeShoppingListItem(command.shoppingListId, command.itemId);
    case "shoppingList.item.description":
      return client.updateShoppingListItemDescription(
        command.shoppingListId,
        command.itemId,
        String(value != null ? value : "")
      );
    case "expenses.add": {
      const payload = parseJsonPayload(value, "Adding an expense");
      const missing = [];
      if (typeof payload.name !== "string" || payload.name.trim() === "") {
        missing.push('"name" (string)');
      }
      if (typeof payload.amount !== "number") {
        missing.push('"amount" (number)');
      }
      if (!isUserRef(payload.paid_by)) {
        missing.push('"paid_by" ({"id": <user id>})');
      }
      if (!Array.isArray(payload.paid_for) || payload.paid_for.length === 0 || !payload.paid_for.every(isUserRef)) {
        missing.push('"paid_for" (a non-empty list of {"id": <user id>})');
      }
      if (missing.length > 0) {
        throw new Error(`Adding an expense needs ${missing.join(", ")}. For example: ${EXPENSE_EXAMPLE}`);
      }
      return client.addExpense(command.householdId, payload);
    }
    case "expenses.recalculateBalances":
      return client.recalculateBalances(command.householdId);
    case "planner.addRecipe": {
      const payload = parseJsonPayload(value, "Planning a recipe");
      if (typeof payload.recipe_id !== "number") {
        throw new Error('Planning a recipe needs a "recipe_id" number');
      }
      return client.addPlannedRecipe(command.householdId, payload);
    }
    case "planner.day.remove": {
      const planned = plannedOnDay(command.householdId, command.day);
      if (!planned) {
        context.log.debug(`Nothing is planned for day ${command.day}, so there is nothing to remove`);
        return void 0;
      }
      return client.removePlannedRecipe(command.householdId, planned.recipeId, planned.cookingDate);
    }
    case "recipes.scrapeUrl": {
      const url = String(value != null ? value : "").trim();
      if (!/^https?:\/\/.+/.test(url)) {
        throw new Error("Importing a recipe needs an http or https URL");
      }
      return client.scrapeRecipe(command.householdId, url);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EXPENSE_EXAMPLE,
  parseCommand,
  parseItemInput,
  parseJsonPayload,
  runCommand
});
//# sourceMappingURL=commands.js.map
