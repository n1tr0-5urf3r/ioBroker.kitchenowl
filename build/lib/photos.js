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
const PHOTO_DIR = "photos";
class PhotoCache {
  constructor(adapter, client) {
    this.adapter = adapter;
    this.client = client;
  }
  /** Filenames known to be stored, so a poll costs no file system calls. */
  stored = /* @__PURE__ */ new Set();
  /** Filenames that could not be fetched, so one bad photo is not retried forever. */
  failed = /* @__PURE__ */ new Set();
  initialised = false;
  /**
   * The path a visualisation can load a photo from, relative to the ioBroker host.
   *
   * @param namespace
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
   * A photo that cannot be fetched is logged once and then left alone. Polls
   * repeat for as long as the adapter runs, and retrying a photo the server
   * will never hand over would warn on every one of them. Restarting the
   * adapter tries again.
   *
   * @param filenames - Photos referenced by this poll
   */
  async store(filenames) {
    await this.init();
    for (const filename of new Set(filenames)) {
      if (this.stored.has(filename) || this.failed.has(filename)) {
        continue;
      }
      try {
        const bytes = await this.client.fetchPhoto(filename);
        await this.adapter.writeFileAsync(this.adapter.namespace, `${PHOTO_DIR}/${filename}`, bytes);
        this.stored.add(filename);
        this.adapter.log.debug(`Cached photo ${filename} (${bytes.length} bytes)`);
      } catch (error) {
        this.failed.add(filename);
        this.adapter.log.warn(
          `Could not cache photo ${filename}, and will not try again until the adapter restarts: ${error.message}`
        );
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
