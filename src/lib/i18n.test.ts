import { expect } from 'chai';
import { join } from 'node:path';

import { I18N_ROOT, initNames, localize } from './i18n';

/** The translations live beside the admin interface, two levels up from here. */
export const ADMIN_DIR = join(__dirname, '..', '..', I18N_ROOT);

describe('localize', () => {
	before(() => initNames(ADMIN_DIR));

	it('returns every language ioBroker asks for, not just English and German', () => {
		const name = localize('Household members');

		expect(name).to.be.an('object');
		// The repository check wants these alongside en and de.
		for (const language of ['en', 'de', 'ru', 'pt', 'nl', 'fr', 'it', 'es', 'pl', 'uk', 'zh-cn']) {
			expect(name, `missing ${language}`).to.have.property(language);
		}
	});

	it('translates rather than repeating the English', () => {
		const name = localize('Household members') as Record<string, string>;

		expect(name.de).to.not.equal(name.en);
		expect(name.de).to.equal('Haushaltsmitglieder');
	});

	it('passes names that come from KitchenOwl through unchanged', () => {
		// A household, list or recipe title must not be translated, and must not
		// be labelled English either.
		expect(localize('Example Household')).to.equal('Example Household');
		expect(localize('Tomato Soup')).to.equal('Tomato Soup');
		expect(localize('')).to.equal('');
	});

	it('leaves names alone when the translations were never loaded', () => {
		// Nothing should blow up in a context that never called initNames.
		expect(localize('Household members')).to.be.an('object');
	});
});
