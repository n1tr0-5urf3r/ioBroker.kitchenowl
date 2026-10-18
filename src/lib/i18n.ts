import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directory holding the translations, relative to the compiled `build` folder.
 *
 * They are the same files the admin interface uses, so a name is translated
 * once and `npm run translate` keeps every language in step.
 */
export const I18N_ROOT = 'admin';

/** Every known name, keyed by its English text, then by language. */
let words: Record<string, Record<string, string>> | null = null;

/**
 * Loads the translations the object names are built from.
 *
 * Reads the files directly rather than going through adapter-core's I18n,
 * which pulls in the whole controller and cannot be loaded from a test.
 *
 * @param rootDir - Directory holding the `i18n` folder
 */
export function initNames(rootDir: string): void {
	const dir = join(rootDir, 'i18n');
	const loaded: Record<string, Record<string, string>> = {};

	for (const file of readdirSync(dir)) {
		if (!file.endsWith('.json')) {
			continue;
		}
		const language = file.slice(0, -'.json'.length);
		const entries = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Record<string, string>;

		for (const [key, value] of Object.entries(entries)) {
			loaded[key] ??= {};
			loaded[key][language] = value;
		}
	}
	words = loaded;
}

/**
 * Turns an English name into the multilingual form ioBroker stores.
 *
 * ioBroker asks for every language it knows, not only English and German, so
 * the names come from the translation files rather than a table in here. A
 * name with no entry, which is every name KitchenOwl supplies itself, comes
 * back exactly as it went in rather than being labelled English.
 *
 * @param name - English name of the state or channel
 */
export function localize(name: string): ioBroker.StringOrTranslated {
	const translated = name && words ? words[name] : undefined;
	return translated ? ({ ...translated } as ioBroker.StringOrTranslated) : name;
}
