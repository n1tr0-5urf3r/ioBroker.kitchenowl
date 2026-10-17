/**
 * Everything outside this set becomes an underscore.
 *
 * ioBroker's own blocklist is narrower, but an allowlist keeps ids predictable:
 * KitchenOwl names routinely contain emoji, and a category named with one
 * should not produce an object id that is awkward to type in a script.
 */
const ALLOWED_CHARS = /[^A-Za-z0-9_-]/g;

/** Combining marks left behind by the NFKD decomposition. */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Turns arbitrary text into a safe ioBroker object id segment.
 *
 * Diacritics are folded rather than dropped, so a name like "Muesli" spelled
 * with an umlaut keeps all of its letters, and the fallback keeps the result
 * non-empty for names made entirely of emoji or punctuation.
 *
 * @param value - Text to convert
 * @param fallback - Used when nothing printable survives
 */
export function toId(value: string, fallback = 'unknown'): string {
	const normalized = value
		.normalize('NFKD')
		.replace(COMBINING_MARKS, '')
		.replace(ALLOWED_CHARS, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '');

	return normalized.length > 0 ? normalized : fallback;
}

/** The parts of a member that identify it; satisfied by the full Member type. */
export interface IdentifiableMember {
	id: number;
	username?: string;
	name?: string;
}

/**
 * Id segment for a household member, preferring the stable username.
 *
 * @param member - Member to build an id for
 */
export function memberId(member: IdentifiableMember): string {
	return toId(member.username || member.name || '', `user_${member.id}`);
}

/**
 * Id segments for a group of members, keyed by user id.
 *
 * Two usernames can collapse onto the same segment: "a.b" and "a b" both come
 * out as "a_b", and the two members would then share one branch, the second
 * quietly overwriting the first. Where that happens the user id is appended to
 * every member of the group, so the names stay readable for everyone else.
 *
 * A segment can also collide with a state the branch writes itself: a member
 * called "count" would land on the very id holding the number of members, and
 * the two would then fight over one object. Those names are handled the same
 * way, by appending the user id.
 *
 * @param members - Members of one household
 * @param reserved - Ids the branch already uses for states of its own
 */
export function memberIds(members: IdentifiableMember[], reserved: readonly string[] = []): Map<number, string> {
	const taken = new Set(reserved);
	const occurrences = new Map<string, number>();
	for (const member of members) {
		const segment = memberId(member);
		occurrences.set(segment, (occurrences.get(segment) ?? 0) + 1);
	}

	const segments = new Map<number, string>();
	for (const member of members) {
		const segment = memberId(member);
		const unique = occurrences.get(segment) === 1 && !taken.has(segment);
		segments.set(member.id, unique ? segment : `${segment}_${member.id}`);
	}
	return segments;
}

/**
 * Rounds a float to two decimals, for the balances the API returns unrounded.
 *
 * @param value - Value to publish
 */
export function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/**
 * Converts the API's epoch-millisecond timestamps into something safe to store.
 *
 * @param value - Timestamp from the API
 */
export function toTimestamp(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
