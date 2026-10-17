import { expect } from 'chai';

import { memberId, memberIds, round2, toId, toTimestamp } from './ids';

describe('ids', () => {
	describe('toId', () => {
		it('keeps plain names unchanged', () => {
			expect(toId('Groceries')).to.equal('Groceries');
		});

		it('replaces characters ioBroker forbids in object ids', () => {
			expect(toId('a b')).to.equal('a_b');
			expect(toId('a.b')).to.equal('a_b');
			expect(toId("we'll [do] this")).to.equal('we_ll_do_this');
		});

		it('folds diacritics instead of dropping them', () => {
			expect(toId('Müsli')).to.equal('Musli');
			expect(toId('Crème')).to.equal('Creme');
		});

		it('collapses and trims runs of replacement characters', () => {
			expect(toId('  spaced   out  ')).to.equal('spaced_out');
		});

		it('falls back when nothing printable survives', () => {
			expect(toId('🌮', 'item_7')).to.equal('item_7');
			expect(toId('')).to.equal('unknown');
		});
	});

	describe('memberId', () => {
		it('prefers the username', () => {
			expect(memberId({ id: 1, username: 'alice', name: 'Alice Example' })).to.equal('alice');
		});

		it('falls back to the display name, then to the user id', () => {
			expect(memberId({ id: 2, name: 'Bob Example' })).to.equal('Bob_Example');
			expect(memberId({ id: 3 })).to.equal('user_3');
		});
	});

	describe('round2', () => {
		it('tames the floats the balance endpoint returns', () => {
			expect(round2(-220.1999999999914)).to.equal(-220.2);
			expect(round2(12.3399999999999)).to.equal(12.34);
			expect(round2(0)).to.equal(0);
		});
	});

	describe('toTimestamp', () => {
		it('passes finite numbers through', () => {
			expect(toTimestamp(1700000000000)).to.equal(1700000000000);
		});

		it('rejects anything that is not a usable timestamp', () => {
			expect(toTimestamp(null)).to.equal(null);
			expect(toTimestamp(undefined)).to.equal(null);
			expect(toTimestamp(Number.NaN)).to.equal(null);
		});
	});
});

describe('memberIds', () => {
	it('keeps the readable segment when nothing collides', () => {
		const segments = memberIds([
			{ id: 1, username: 'alice' },
			{ id: 2, username: 'bob' },
		]);

		expect(segments.get(1)).to.equal('alice');
		expect(segments.get(2)).to.equal('bob');
	});

	it('separates members whose usernames fold onto the same segment', () => {
		// Both would become "a_b", and the second would take over the first's branch.
		const segments = memberIds([
			{ id: 4, username: 'a.b' },
			{ id: 7, username: 'a b' },
		]);

		expect(segments.get(4)).to.equal('a_b_4');
		expect(segments.get(7)).to.equal('a_b_7');
		expect(segments.get(4)).to.not.equal(segments.get(7));
	});

	it('falls back to the user id for a name with nothing printable in it', () => {
		const segments = memberIds([{ id: 3, username: '🥕', name: '🥕' }]);

		expect(segments.get(3)).to.equal('user_3');
	});

	it('steps aside for a state the branch writes itself', () => {
		// A member called "count" would otherwise land on members.count, the
		// state holding how many members there are.
		const segments = memberIds([{ id: 5, username: 'count' }], ['count', 'balancesJson']);

		expect(segments.get(5)).to.equal('count_5');
	});

	it('leaves a name alone when it is not one of the reserved ids', () => {
		const segments = memberIds([{ id: 5, username: 'counter' }], ['count']);

		expect(segments.get(5)).to.equal('counter');
	});
});
