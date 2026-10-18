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
var i18n_exports = {};
__export(i18n_exports, {
  I18N_ROOT: () => I18N_ROOT,
  initNames: () => initNames,
  localize: () => localize
});
module.exports = __toCommonJS(i18n_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
const I18N_ROOT = "admin";
let words = null;
function initNames(rootDir) {
  var _a;
  const dir = (0, import_node_path.join)(rootDir, "i18n");
  const loaded = {};
  for (const file of (0, import_node_fs.readdirSync)(dir)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    const language = file.slice(0, -".json".length);
    const entries = JSON.parse((0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, file), "utf8"));
    for (const [key, value] of Object.entries(entries)) {
      (_a = loaded[key]) != null ? _a : loaded[key] = {};
      loaded[key][language] = value;
    }
  }
  words = loaded;
}
function localize(name) {
  const translated = name && words ? words[name] : void 0;
  return translated ? { ...translated } : name;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  I18N_ROOT,
  initNames,
  localize
});
//# sourceMappingURL=i18n.js.map
