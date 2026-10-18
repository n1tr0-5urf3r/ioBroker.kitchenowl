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
var photos_exports = {};
__export(photos_exports, {
  PHOTO_DIR: () => PHOTO_DIR,
  PhotoCache: () => PhotoCache
});
module.exports = __toCommonJS(photos_exports);
var import_i18n = require("./i18n");
const PHOTO_DIR = "photos";
class PhotoCache {
  /**
   * @param adapter - Adapter instance whose file storage the copies live in
   * @param client - Client the photos are downloaded through
   */
  constructor(adapter, client) {
    this.adapter = adapter;
    this.client = client;
  }
  /**
   * Polls a photo that could not be fetched is left alone for.
   *
   * Long enough that a server which will never hand it over is not asked on
   * every poll, short enough that a photo lost to one timeout comes back
   * without restarting the adapter.
   */
  static RETRY_AFTER_POLLS = 10;
  /** Filenames known to be stored, so a poll costs no file system calls. */
  stored = /* @__PURE__ */ new Set();
  /** Filenames that could not be fetched, each with the polls left before another try. */
  waiting = /* @__PURE__ */ new Map();
  /** Filenames that failed at least once, so the repeat is logged more quietly. */
  everFailed = /* @__PURE__ */ new Set();
  initialised = false;
  /**
   * The path a visualisation can load a photo from, relative to the ioBroker host.
   *
   * @param namespace - Adapter namespace, e.g. `kitchenowl.0`
   */
  static urlBase(namespace) {
    return `/${namespace}/${PHOTO_DIR}/`;
  }
  /** Reads back what previous runs already downloaded. */
  async init() {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    try {
      await this.adapter.setForeignObjectNotExistsAsync(this.adapter.namespace, {
        type: "meta",
        common: { name: (0, import_i18n.localize)("Cached KitchenOwl photos"), type: "meta.user" },
        native: {}
      });
    } catch (error) {
      this.adapter.log.warn(`Could not prepare the photo storage: ${error.message}`);
    }
    try {
      const entries = await this.adapter.readDirAsync(this.adapter.namespace, PHOTO_DIR);
      for (const entry of entries) {
        if (!entry.isDir) {
          this.stored.add(entry.file);
        }
      }
    } catch {
    }
  }
  /**
   * Downloads the photos that are not stored yet.
   *
   * A photo that cannot be fetched is left alone for a while rather than
   * retried on every poll, which for a picture the server will never hand
   * over would warn once a poll interval for as long as the adapter runs.
   * The wait expires on its own, so a photo lost to one timeout returns
   * without a restart, and only the first failure is a warning.
   *
   * @param filenames - Photos referenced by this poll
   */
  async store(filenames) {
    await this.init();
    for (const [filename, polls] of this.waiting) {
      if (polls <= 1) {
        this.waiting.delete(filename);
      } else {
        this.waiting.set(filename, polls - 1);
      }
    }
    for (const filename of new Set(filenames)) {
      if (this.stored.has(filename) || this.waiting.has(filename)) {
        continue;
      }
      try {
        const bytes = await this.client.fetchPhoto(filename);
        await this.adapter.writeFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`, bytes);
        this.stored.add(filename);
        this.waiting.delete(filename);
        this.everFailed.delete(filename);
        this.adapter.log.debug(`Cached photo ${filename} (${bytes.length} bytes)`);
      } catch (error) {
        this.waiting.set(filename, PhotoCache.RETRY_AFTER_POLLS);
        const message = `Could not cache photo ${filename}, and will try again in ${PhotoCache.RETRY_AFTER_POLLS} polls: ${error.message}`;
        if (this.everFailed.has(filename)) {
          this.adapter.log.debug(message);
        } else {
          this.everFailed.add(filename);
          this.adapter.log.warn(message);
        }
      }
    }
  }
  /**
   * Deletes stored photos that nothing refers to any more.
   *
   * Only safe when the caller read everything that can carry a photo, which
   * a tiered poll does not always do.
   *
   * @param referenced - Every photo this poll saw
   */
  async prune(referenced) {
    await this.init();
    const keep = new Set(referenced);
    let deleted = 0;
    for (const filename of [...this.stored]) {
      if (keep.has(filename)) {
        continue;
      }
      try {
        await this.adapter.delFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`);
        this.stored.delete(filename);
        deleted++;
      } catch (error) {
        this.adapter.log.warn(`Could not remove photo ${filename}: ${error.message}`);
      }
    }
    return deleted;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PHOTO_DIR,
  PhotoCache
});
//# sourceMappingURL=photos.js.map
