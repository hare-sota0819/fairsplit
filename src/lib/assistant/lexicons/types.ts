/**
 * Shared types for the assistant lexicon data files (spec §5.1, §5.4).
 *
 * Every lexicon entry carries a `tier`: `'main'` for spec §3's primary
 * attested-corpus rows, `'exp'` for a table's `확장 후보` (extension
 * candidate) rows. Extension rows are implemented but may be pruned without
 * ceremony if they collide with a higher-confidence row (spec §3 preamble) —
 * keeping the tier as data, not a separate list, is what makes that prune
 * data-only later.
 */

/** Message locale — selects which half of a bilingual table applies. */
export type Locale = 'ko' | 'en'

/** `main` = spec §3 primary table row. `exp` = spec's `확장 후보` table row. */
export type Tier = 'main' | 'exp'

/** The research corpus's own frequency rating: 상/중/하 = high/mid/low. */
export type Freq = '상' | '중' | '하'
