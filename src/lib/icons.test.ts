import { expect } from 'chai';

import { itemEmoji } from './icons';

describe('itemEmoji', () => {
	it('turns an icon key into something that renders', () => {
		expect(itemEmoji('honey')).to.equal('🍯');
		expect(itemEmoji('apple')).to.equal('🍎');
		expect(itemEmoji('toilet_paper')).to.equal('🧻');
	});

	it('accepts the hyphenated spelling the upstream files use', () => {
		// The API says antiseptic_cream, the icon file is antiseptic-cream.
		expect(itemEmoji('antiseptic-cream')).to.equal(itemEmoji('antiseptic_cream'));
		expect(itemEmoji('ANTISEPTIC-CREAM')).to.equal(itemEmoji('antiseptic_cream'));
	});

	it('falls back to the emoji the user put on the category', () => {
		// Two thirds of items have an icon; the rest lean on their category,
		// whose name in KitchenOwl almost always starts with an emoji.
		expect(itemEmoji(null, '🥬 Obst & Gemüse')).to.equal('🥬');
		expect(itemEmoji('a_key_that_does_not_exist', '🧀 Käse')).to.equal('🧀');
	});

	it('returns nothing rather than a placeholder when there is nothing to show', () => {
		// An empty string renders as empty; a stand-in glyph would be a lie.
		expect(itemEmoji(null, null)).to.equal('');
		expect(itemEmoji(undefined, undefined)).to.equal('');
		expect(itemEmoji('unknown', 'Category with no emoji')).to.equal('');
	});

	it('handles a multi-codepoint emoji on a category', () => {
		expect(itemEmoji(null, '👨‍👩‍👧 Familie')).to.equal('👨‍👩‍👧');
	});

	it('keeps a skin tone and the sequence it belongs to', () => {
		// Taking only the first code point leaves 👩, which is a different
		// picture: no cook, and not the skin tone the user picked.
		expect(itemEmoji(null, '👩🏽‍🍳 Kochen')).to.equal('👩🏽‍🍳');
		expect(itemEmoji(null, '🧑🏿‍🌾 Hof')).to.equal('🧑🏿‍🌾');
	});

	it('handles a flag and a keycap, which are sequences too', () => {
		expect(itemEmoji(null, '🇩🇪 Deutsch')).to.equal('🇩🇪');
		expect(itemEmoji(null, '1️⃣ Erste Wahl')).to.equal('1️⃣');
	});
});
