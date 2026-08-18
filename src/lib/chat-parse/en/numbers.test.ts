import { describe, expect, test } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import { readEnglishNumber } from './numbers'
import ducklingFixture from '../../../../test-fixtures/goat/duckling-en-amounts.json'
import msFixture from '../../../../test-fixtures/goat/ms-currency-model.json'

/** Scans left to right and returns the first non-null hit — mirrors how a
 * real caller (parsers/amount.ts, Task 6) would use readEnglishNumber: it
 * doesn't know in advance which token starts the number, e.g. fixture text
 * "about 5" or "around 42 bucks" has a non-numeric word first. */
function firstHit(text: string) {
  const tokens = tokenize(text)
  for (let i = 0; i < tokens.length; i++) {
    const hit = readEnglishNumber(tokens, i)
    if (hit) return hit
  }
  return null
}

describe('readEnglishNumber — fixed table (brief)', () => {
  test('forty five -> 45', () => {
    const hit = firstHit('forty five')
    expect(hit?.value).toBe(45n)
    expect(hit?.scale).toBe(0)
  })

  test('1.2k -> 1200 (digit + glued magnitude suffix)', () => {
    const hit = firstHit('1.2k')
    expect(hit?.value).toBe(1200n)
    expect(hit?.scale).toBe(0)
  })

  test('a grand -> 1000 (article + magnitude idiom)', () => {
    const hit = firstHit('a grand')
    expect(hit?.value).toBe(1000n)
    expect(hit?.scale).toBe(0)
  })

  test('one hundred and five -> 105 (joiner bridges hundred-section to trailing ones)', () => {
    const hit = firstHit('one hundred and five')
    expect(hit?.value).toBe(105n)
    expect(hit?.scale).toBe(0)
  })

  test('ten point five -> value 105, scale 1 (real value 10.5, money uses minor units)', () => {
    const hit = firstHit('ten point five')
    expect(hit?.value).toBe(105n)
    expect(hit?.scale).toBe(1)
  })

  test('fifteen hundred -> 1500 (teen coefficient * hundred)', () => {
    const hit = firstHit('fifteen hundred')
    expect(hit?.value).toBe(1500n)
    expect(hit?.scale).toBe(0)
  })
})

describe('readEnglishNumber — additional structural cases', () => {
  test('plain digits token: 45 -> 45', () => {
    const hit = firstHit('45')
    expect(hit?.value).toBe(45n)
    expect(hit?.scale).toBe(0)
  })

  test('45.60 -> value 456, scale 1 (decimal digits token, exact — no float, trailing zero normalized)', () => {
    const hit = firstHit('45.60')
    expect(hit?.value).toBe(456n)
    expect(hit?.scale).toBe(1)
  })

  test('45,000 -> 45000 (comma thousands separator stripped)', () => {
    const hit = firstHit('45,000')
    expect(hit?.value).toBe(45000n)
    expect(hit?.scale).toBe(0)
  })

  test('twenty three -> 23 (ten + ones composition)', () => {
    const hit = firstHit('twenty three')
    expect(hit?.value).toBe(23n)
  })

  test('two hundred -> 200 (bare small-unit multiply)', () => {
    const hit = firstHit('two hundred')
    expect(hit?.value).toBe(200n)
  })

  test('two thousand three hundred -> 2300 (descending tiers, no joiner)', () => {
    const hit = firstHit('two thousand three hundred')
    expect(hit?.value).toBe(2300n)
  })

  test('three million two hundred thousand -> 3200000 (descending big-unit tiers)', () => {
    const hit = firstHit('three million two hundred thousand')
    expect(hit?.value).toBe(3_200_000n)
  })

  test('one thousand and five -> 1005 (joiner bridges from a CLOSED big-unit tier, not just a hundred-section)', () => {
    const hit = firstHit('one thousand and five')
    expect(hit?.value).toBe(1005n)
  })

  test('one hundred and five thousand -> 105000 (joiner-bridged coefficient still folds into a later big-unit multiply)', () => {
    const hit = firstHit('one hundred and five thousand')
    expect(hit?.value).toBe(105_000n)
  })

  test('48.2 million -> 48200000 (decimal coefficient + trailing big unit)', () => {
    const hit = firstHit('48.2 million')
    expect(hit?.value).toBe(48_200_000n)
    expect(hit?.scale).toBe(0)
  })

  test('a hundred -> 100 (article + magnitude, same mechanism as "a grand")', () => {
    const hit = firstHit('a hundred')
    expect(hit?.value).toBe(100n)
  })

  test('45k -> 45000 (no decimal point before suffix)', () => {
    const hit = firstHit('45k')
    expect(hit?.value).toBe(45000n)
  })

  test('a book -> null (bare "a" is never a standalone number — false-positive guard)', () => {
    expect(firstHit('a book')).toBeNull()
  })

  test('twenty twenty -> stops at the first coefficient (two bare coefficients cannot chain)', () => {
    const hit = firstHit('twenty twenty')
    expect(hit?.value).toBe(20n)
    expect('twenty twenty'.slice(hit!.start, hit!.end)).toBe('twenty')
  })

  test('exactly dollars -> null (no digits, no number word anywhere)', () => {
    expect(firstHit('exactly dollars')).toBeNull()
  })

  test('hundred thousand -> 100000 (bare magnitude word, no leading coefficient, implied-1)', () => {
    const hit = firstHit('hundred thousand')
    expect(hit?.value).toBe(100_000n)
  })
})

describe('readEnglishNumber — review round 1 fixes', () => {
  // CRITICAL 1: readDecimalTail used to advance its cursor to the NEXT
  // token before validating it, so a trailing magnitude word or currency
  // noun right after a word-spelled decimal got folded into `endIndex`
  // even though it was never actually consumed as a digit.
  test('two point five million -> 2500000 (trailing-magnitude path now fires correctly)', () => {
    const hit = firstHit('two point five million')
    expect(hit?.value).toBe(2_500_000n)
    expect(hit?.scale).toBe(0)
  })

  test('ten point five dollars -> value 105 scale 1 (10.5), span ends BEFORE "dollars"', () => {
    const text = 'ten point five dollars'
    const hit = firstHit(text)
    expect(hit?.value).toBe(105n)
    expect(hit?.scale).toBe(1)
    expect(text.slice(hit!.start, hit!.end)).toBe('ten point five')
  })

  // CRITICAL 2: a digits token with more than one decimal point (the
  // tokenizer happily produces these — every "." is digit-flanked) used to
  // reach BigInt() with a non-digit string and throw. Also covers "1,5" —
  // a comma group must be exactly 3 digits; a short group is a malformed/
  // ambiguous shape, not silently reinterpreted as "15".
  test.each([['1.2.3'], ['version 1.2.3'], ['12.25.2024'], ['3.14.15'], ['1,5']])(
    '%j -> null, no crash (malformed digits shape)',
    (text) => {
      expect(() => firstHit(text)).not.toThrow()
      expect(firstHit(text)).toBeNull()
    },
  )

  test('1.2 -> value 12 scale 1 (plain decimal digits token regression)', () => {
    const hit = firstHit('1.2')
    expect(hit?.value).toBe(12n)
    expect(hit?.scale).toBe(1)
  })

  // IMPORTANT 1: `word in MAP` on a plain object literal walks the
  // prototype chain — "constructor" (and anything else Object.prototype
  // carries) used to look like a hit with a bigint value, but actually
  // returned the inherited Object constructor FUNCTION as `value`.
  test.each([['constructor'], ['a constructor']])('%j -> null (prototype-chain leak guard)', (text) => {
    expect(firstHit(text)).toBeNull()
  })

  // "1.2constructor" no longer crashes (the actual Critical property) —
  // Object.hasOwn now correctly rejects "constructor" as a k/K/m/M magnitude
  // suffix AND as a trailing big-unit word. What's left once the crash is
  // gone is a plain decimal digits token ("1.2") with an unrecognized
  // trailing word, which — same as "45.60usd" -> 45.6 (existing, deliberate
  // behavior a few tests up) — reads as 1.2 with "constructor" simply left
  // unconsumed, not suppressed to null: there is nothing structurally
  // different about this trailing word that should make the number itself
  // wrong or unreadable.
  test('1.2constructor -> value 12 scale 1, no crash (not null — same "leave the trailing word" rule as 45.60usd)', () => {
    expect(() => firstHit('1.2constructor')).not.toThrow()
    const hit = firstHit('1.2constructor')
    expect(hit?.value).toBe(12n)
    expect(hit?.scale).toBe(1)
  })

  // IMPORTANT 2: this reader does not implement fractional "half"
  // arithmetic — "half a million"/"one and a half" must not silently
  // resolve to an exactly-2x-wrong plausible-looking integer.
  test('half a million -> null (safe miss, not a confidently 2x-wrong 1000000)', () => {
    expect(firstHit('half a million')).toBeNull()
  })

  test('one and a half -> null (safe miss, not a confidently wrong 1)', () => {
    expect(firstHit('one and a half')).toBeNull()
  })

  test('a million -> 1000000 (regression: unrelated "a X" idiom reads unaffected by the half guard)', () => {
    const hit = firstHit('a million')
    expect(hit?.value).toBe(1_000_000n)
  })

  // Review round 2: two residuals of the SAME half-suppression defect
  // class round 1's fix didn't fully close.
  test('half-a-million -> null (hyphenated form — backward walk must cross "-" the same way skipSeparator does forward)', () => {
    expect(firstHit('half-a-million')).toBeNull()
  })

  test('half a hundred -> null (SMALL_UNIT re-entry: bare "hundred" after the suppressed "a hundred" must also be caught)', () => {
    expect(firstHit('half a hundred')).toBeNull()
  })

  test('half two hundred -> null (same re-entry, via a coefficient instead of the article "a")', () => {
    expect(firstHit('half two hundred')).toBeNull()
  })

  test('twenty-five -> 25 (regression: hyphenated ten+ones composition unaffected)', () => {
    const hit = firstHit('twenty-five')
    expect(hit?.value).toBe(25n)
  })

  test('paid a million -> 1000000 (regression: an unrelated word before "a million" must not trigger suppression)', () => {
    const hit = firstHit('paid a million')
    expect(hit?.value).toBe(1_000_000n)
  })

  test('three hundred thousand -> 300000 (regression: bare SMALL_UNIT re-entry guard must not misfire with no "half" anywhere)', () => {
    const hit = firstHit('three hundred thousand')
    expect(hit?.value).toBe(300_000n)
  })

  // IMPORTANT 3: "a buck"/"a dollar" article-before-slang-unit-noun
  // coefficient (brief Step 1) — value 1, with the unit noun left
  // UNCONSUMED so Task 6 can bind it as the currency (mirrors "100
  // dollars" already leaving "dollars" untouched).
  test('a buck -> 1, span ends before "buck"', () => {
    const text = 'a buck'
    const hit = firstHit(text)
    expect(hit?.value).toBe(1n)
    expect(text.slice(hit!.start, hit!.end)).toBe('a')
  })

  test('a dollar -> 1, span ends before "dollar"', () => {
    const text = 'a dollar'
    const hit = firstHit(text)
    expect(hit?.value).toBe(1n)
    expect(text.slice(hit!.start, hit!.end)).toBe('a')
  })

  test('paid a buck fifty -> "a buck" reads as 1 (span excludes "buck"); "fifty" is a SEPARATE, unrelated hit, not composed with it — "buck fifty" ($1.50 slang) is Task 6/Duckling territory, not implemented here', () => {
    const text = 'paid a buck fifty'
    const tokens = tokenize(text)
    const aIndex = tokens.findIndex((t) => t.kind === 'latin' && t.text === 'a')
    const hit = readEnglishNumber(tokens, aIndex)
    expect(hit?.value).toBe(1n)
    expect(text.slice(hit!.start, hit!.end)).toBe('a')
    const fiftyIndex = tokens.findIndex((t) => t.kind === 'latin' && t.text === 'fifty')
    const fiftyHit = readEnglishNumber(tokens, fiftyIndex)
    expect(fiftyHit?.value).toBe(50n)
  })
})

// --- fixture-driven -------------------------------------------------------
//
// Duckling AmountOfMoney/EN Corpus.hs rows tagged `Unnamed` (no specific
// currency recognized) are this task's plain-number fixture material — see
// scripts/lang/convert-en-fixtures.mjs's doc-comment on why "42 bucks" still
// qualifies (readEnglishNumber only has to read the leading "42" correctly
// and stop; the trailing word is simply never consumed).
//
// MS CurrencyModel.json contributes ZERO rows to this filter by
// construction: it is a *currency* corpus, so every positive row has a
// currency unit attached, and the "negative" (no-currency) rows are about
// currency absence, not number absence (several — "All 70 of us." — contain
// a real number). Iterating it here is still correct: the filter simply,
// honestly, yields nothing from that source for a NUMBER-only reader.
interface FixtureRow {
  text: string
  value: { digits: string; scale: number } | null
  currency: string | null
  negative: boolean
}

const duckling = ducklingFixture.rows as FixtureRow[]
const ms = msFixture.rows as FixtureRow[]

const plainNumberRows = [...duckling, ...ms].filter((r) => r.currency === null && !r.negative && r.value !== null)

describe('readEnglishNumber — fixture-driven (Duckling + MS, plain-number rows)', () => {
  test.each(plainNumberRows.map((r) => [r.text, r.value!.digits, r.value!.scale] as const))(
    '%j -> digits=%s scale=%i',
    (text, digits, scale) => {
      const hit = firstHit(text)
      expect(hit).not.toBeNull()
      expect(hit!.value).toBe(BigInt(digits))
      expect(hit!.scale).toBe(scale)
    },
  )

  // Duckling's negativeCorpus is a genuine "not a number/amount at all"
  // corpus (the one row here, "exactly dollars", has no digit and no
  // number word) — parser must return null everywhere in it. Unlike MS's
  // no-currency rows, this assertion is safe for every row in the set.
  const ducklingNegative = duckling.filter((r) => r.negative)
  test.each(ducklingNegative.map((r) => [r.text] as const))('Duckling negative corpus: %j -> null', (text) => {
    expect(firstHit(text)).toBeNull()
  })
})
