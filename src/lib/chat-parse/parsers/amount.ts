import {
  CLOSED_END_SUFFIX,
  CURRENCY_TOKEN,
  HANGUL_DIGIT_CHARS,
  HANGUL_UNIT_CHARS,
  hasPlaceValueUnit,
} from '../../assistant/hangul-number'
import {
  CURRENCY_WORDS_EN,
  FUNDING_WORDS_EN,
  MONEY_UNITS_EN,
  PRICE_BINDERS_EN,
  SPLIT_EN,
  TOTAL_WORDS_EN,
} from '../en/lexicon'
import { readEnglishNumber } from '../en/numbers'
import type { ParseHit } from '../engine/hits'
import type { Token } from '../engine/tokens'
import { isHangulCodePoint, tokenize } from '../engine/tokenizer'
import { detachJosa } from '../ko/josa'
import { readKoreanNumber } from '../ko/numbers'

/**
 * Amount + currency parser over `Token[]` — the integration point of the
 * parser rebuild.
 *
 * It owns NO numeral arithmetic of its own. Every value comes out of one of
 * the two readers (`readKoreanNumber`, `readEnglishNumber`); this file only
 *  - drives them across a sentence,
 *  - COMPOSES adjacent reads into one span when Korean writes one amount as
 *    several segments ("삼만 오천원"),
 *  - binds a currency to the number from the text around it, and
 *  - decides whether a number is money at all.
 *
 * That "one grammar" rule is the branch's hardest-won lesson (docs/SOLVED.md
 * [2026-08-13]): a second place that multiplies a coefficient by a unit is a
 * second place to be wrong. The two compositions below (a Korean segment
 * chain, and a decimal coefficient in front of a unit-led read) are
 * deliberately expressed as arithmetic ON READER RESULTS — `v1 + v2`,
 * `v * unitValue` where `unitValue` is itself a reader's reading of the bare
 * unit word — never as a re-implementation of either reader's tier walk.
 */

/** What a hit carries. `amount` is the decimal string `parseAmountToMinor`
 * expects ("35000", "45.60") — never a float, never rounded here. */
export interface AmountValue {
  amount: string
  currency: string
  /**
   * True when the TEXT marks this number as money — a currency symbol/word
   * ("$45", "8500원", "fifty bucks"), a slang money unit ("a grand"), or a
   * Korean place-value compound (3만/5천, which is a money reading by
   * itself; see `KOREAN_COMPOUND_IS_MONEY` below). False for a bare number
   * that only takes the group's default currency ("점심 12000").
   *
   * `parse()`'s `amountMentions` multi-amount guard counts MARKED hits only,
   * so an item quantity ("3개") can never inflate the count.
   */
  marked: boolean
}

// --- currency lexicon -------------------------------------------------------
//
// The repo's existing table (`CURRENCY_TOKEN`, still owned by
// assistant/hangul-number.ts, still read by `readAmountFragment`) plus this
// branch's additions, so the shared entries can't drift into two copies.
// Task 7 moved the English WORDS out to en/lexicon.ts (where the rest of the
// English vocabulary lives); this stays the assembly point that joins them to
// the repo's symbol/Korean table.

interface CurrencyEntry {
  token: string
  /** ISO 4217 code, or null for a money marker with no currency of its own. */
  code: string | null
  /** Multiplies the number it attaches to — "5 grand" = 5 * 1000. */
  multiplier: bigint
  /** May appear BEFORE the number ("USD3.14"); false = suffix position only. */
  prefix: boolean
}

/**
 * Added on this branch, on top of `CURRENCY_TOKEN`:
 *  - `£` (the symbol table had no GBP) and `gbp`, needed by `quid`.
 *  - `불` — the Korean colloquial word for a dollar (task brief).
 *  - every English currency WORD, taken from `CURRENCY_WORDS_EN`
 *    (en/lexicon.ts) rather than re-listed here — bucks/buck → USD, quid →
 *    GBP, euro(s) → EUR, dollar(s) → USD, won → KRW, yen → JPY. That module
 *    is the one place the English money vocabulary is written down, which is
 *    what this comment's earlier draft promised ("Task 7 may relocate the
 *    whole lexicon") and what keeps the two files from drifting apart.
 *  - `MONEY_UNITS_EN` (`grand`) — a MONEY marker that names no currency: "5
 *    grand" is 5000 of whatever currency is in play, so its code is null and
 *    the group's default is used (which resolves to USD exactly when the
 *    default IS USD — the brief's two branches, both asserted in the tests),
 *    and its multiplier comes from that same table.
 *
 * Deliberately NOT included: `pound`/`pounds` (a weight at least as often as
 * money in expense chat) — `quid` carries GBP unambiguously and is what the
 * brief asked for.
 */
// Exported for assistant/classify.ts's guard 2 (T3 fix round 4): the "does the
// text name this currency" check must cover every token `parse()` can bind
// from, and this table is that vocabulary's single owner alongside
// CURRENCY_TOKEN.
export const EXTRA_CURRENCY_TOKENS: ReadonlyArray<{ token: string; code: string | null }> = [
  { token: '£', code: 'GBP' },
  { token: '불', code: 'USD' },
  { token: 'gbp', code: 'GBP' },
  ...[...CURRENCY_WORDS_EN].map(([token, code]) => ({ token, code })),
  ...[...MONEY_UNITS_EN.keys()].map((token) => ({ token, code: null })),
]

/** ISO 4217 codes may lead the number ("USD3.14"); currency WORDS and slang
 * units never do ("bucks 45" is not English). */
const PREFIX_CAPABLE = new Set(['usd', 'krw', 'jpy', 'eur', 'gbp'])

function buildLexicon(): {
  symbols: Map<string, CurrencyEntry>
  koWords: CurrencyEntry[]
  latinWords: Map<string, CurrencyEntry>
} {
  const symbols = new Map<string, CurrencyEntry>()
  const koWords: CurrencyEntry[] = []
  const latinWords = new Map<string, CurrencyEntry>()
  const all = [
    ...CURRENCY_TOKEN.map((c) => ({ token: c.token, code: c.code as string | null })),
    ...EXTRA_CURRENCY_TOKENS,
  ]
  for (const { token, code } of all) {
    const entry: CurrencyEntry = {
      token,
      code,
      multiplier: MONEY_UNITS_EN.get(token.toLowerCase()) ?? 1n,
      prefix: PREFIX_CAPABLE.has(token.toLowerCase()),
    }
    const firstCp = token.codePointAt(0) as number
    if (isHangulCodePoint(firstCp)) koWords.push(entry)
    else if (/^[a-z]+$/i.test(token)) latinWords.set(token.toLowerCase(), entry)
    else symbols.set(token, entry)
  }
  // Longest-first: 달러 must win over a hypothetical shorter prefix, and the
  // match below is a plain `startsWith` on the text after the number.
  koWords.sort((a, b) => b.token.length - a.token.length)
  return { symbols, koWords, latinWords }
}

const { symbols: SYMBOL_CURRENCY, koWords: KO_CURRENCY_WORDS, latinWords: LATIN_CURRENCY_WORDS } =
  buildLexicon()

/** Trailing quantity markers that legitimately close a numeral without
 * naming a currency (원 is a currency word and lives in the lexicon above).
 * `CLOSED_END_SUFFIX` is the repo's existing list; 어치 is ko/numbers.ts's
 * own addition to the same class. */
const CLOSED_SUFFIXES: readonly string[] = [...CLOSED_END_SUFFIX, '어치']

/** Sino-Korean digit syllables and place-value units — the vocabulary a
 * numeral is built from. Used only to tell "the reader declined a numeral
 * character" from "the reader stopped at ordinary text" (see
 * `isKoreanEndBoundaryOk`). Imported rather than retyped; 조 (10^12, which
 * ko/numbers.ts reads but the older char tables never listed) is the one
 * addition. */
const KO_NUMERAL_CHARS = HANGUL_DIGIT_CHARS + HANGUL_UNIT_CHARS + '조'

function isKoNumeralChar(ch: string | undefined): boolean {
  return ch !== undefined && KO_NUMERAL_CHARS.includes(ch)
}

// --- numeral reads ----------------------------------------------------------

interface NumeralRead {
  /** exact decimal string of the numeral ALONE (before any slang multiplier) */
  amount: string
  value: bigint
  /** real value = value * 10^-scale */
  scale: number
  start: number
  end: number
  firstTokenIndex: number
  /** last token the read touched (it may be only partially consumed) */
  lastTokenIndex: number
  source: 'ko' | 'en'
  /** the span carries 십/백/천/만/억 — a Korean money reading on its own */
  placeValue: boolean
  /** the span carries an Arabic digit or a Sino-Korean digit syllable */
  anyDigit: boolean
  arabicDigit: boolean
  /** the whole read is exactly one `digits` token, consumed entirely */
  singleDigitsToken: boolean
}

/** Trims trailing fractional zeros so 700.00 prints as "700"; an integer
 * prints with no point at all. The raw-token path below bypasses this on
 * purpose (a user who typed "45.60" gets "45.60" back — see `readFrom`). */
function formatDecimal(value: bigint, scale: number): string {
  if (scale <= 0) return value.toString()
  const digits = value.toString().padStart(scale + 1, '0')
  const intPart = digits.slice(0, digits.length - scale)
  const fracPart = digits.slice(digits.length - scale).replace(/0+$/, '')
  return fracPart === '' ? intPart : `${intPart}.${fracPart}`
}

function describeSpan(
  input: string,
  start: number,
  end: number,
): { placeValue: boolean; anyDigit: boolean; arabicDigit: boolean } {
  const span = input.slice(start, end)
  const arabicDigit = /[0-9]/.test(span)
  return {
    placeValue: hasPlaceValueUnit(span),
    arabicDigit,
    anyDigit: arabicDigit || Array.from(span).some((ch) => HANGUL_DIGIT_CHARS.includes(ch)),
  }
}

function makeRead(
  input: string,
  tokens: Token[],
  source: 'ko' | 'en',
  firstTokenIndex: number,
  lastTokenIndex: number,
  start: number,
  end: number,
  value: bigint,
  scale: number,
): NumeralRead {
  const only = tokens[firstTokenIndex]
  const singleDigitsToken =
    firstTokenIndex === lastTokenIndex && only.kind === 'digits' && start === only.start && end === only.end
  return {
    // A single digits token keeps its own text (minus thousands separators)
    // instead of being re-printed from `value`: "45.60" must round-trip as
    // "45.60", not as the numerically equal "45.6" — the reader normalizes
    // trailing zeros away, the user's own spelling is what parseAmountToMinor
    // should see.
    amount: singleDigitsToken ? only.text.replace(/,/g, '') : formatDecimal(value, scale),
    value,
    scale,
    start,
    end,
    firstTokenIndex,
    lastTokenIndex,
    source,
    singleDigitsToken,
    ...describeSpan(input, start, end),
  }
}

/** True when `text` ends at a money marker — a currency word or a closed
 * quantity suffix. Marks a position where an amount plausibly ENDS, which is
 * what makes it a retry cut point below. */
function endsWithMoneyMarker(text: string): boolean {
  for (const entry of KO_CURRENCY_WORDS) {
    if (text.endsWith(entry.token)) return true
  }
  return CLOSED_SUFFIXES.some((suffix) => text.endsWith(suffix))
}

/**
 * Input offsets a Korean read may be retried at, longest first.
 *
 * Two kinds, both "a position where an amount plausibly ends":
 *  - the start of a following SPACE token (never mid-run), and
 *  - a position INSIDE a Hangul token right after a currency word or closed
 *    quantity suffix ("3만원|쯤", "오만원|쯤").
 *
 * Cutting only at those two kinds is what keeps "3만5천으로"/"3만5천에" null:
 * neither offers a cut, so a failed compound is never salvaged into a
 * truncated number.
 */
function candidateCuts(tokens: Token[], i: number): number[] {
  const cuts = new Set<number>()
  for (let k = i + 1; k < tokens.length; k++) {
    if (tokens[k].kind === 'space') cuts.add(tokens[k].start)
  }
  for (let k = i; k < tokens.length; k++) {
    const tok = tokens[k]
    if (tok.kind !== 'hangul') continue
    for (let p = 1; p < tok.text.length; p++) {
      if (endsWithMoneyMarker(tok.text.slice(0, p))) cuts.add(tok.start + p)
    }
  }
  return [...cuts].filter((cut) => cut > tokens[i].start).sort((a, b) => b - a)
}

/** `readKoreanNumber` over the tokens up to `cut`, with the token straddling
 * the cut truncated — the reader sees a shorter sentence, nothing else. */
function readKoreanWithin(tokens: Token[], i: number, cut: number): ReturnType<typeof readKoreanNumber> {
  const window: Token[] = []
  for (const tok of tokens) {
    if (tok.start >= cut) break
    window.push(tok.end <= cut ? tok : { ...tok, text: tok.text.slice(0, cut - tok.start), end: cut })
  }
  return readKoreanNumber(window, i)
}

/**
 * `readKoreanNumber`, retried on shorter sentences when the full read fails.
 *
 * The reader walks forward past the amount, so text AFTER a complete amount
 * can null it: "5만 천천히 줄게" walks 5만 → 천(천히) and rejects the whole
 * read on the 천천히 decoy; "3만원쯤"/"3만원했어" reject because 쯤/했어 is
 * not a continuation the reader recognises after 만원. An amount that is
 * already closed must not be lost to what follows it, so the read is retried
 * at each plausible amount end (see `candidateCuts`), longest first.
 */
function readKoreanSegment(tokens: Token[], i: number): ReturnType<typeof readKoreanNumber> {
  const direct = readKoreanNumber(tokens, i)
  if (direct) return direct
  const tok = tokens[i]
  // Retry only where a Sino-Korean/Arabic numeral could START — otherwise
  // every ordinary word in the sentence pays for a full cut search. A native
  // reading (열/스물/…) is deliberately not retried: it carries no
  // place-value unit, so it could never qualify as an amount anyway.
  if (!tok) return null
  if (tok.kind !== 'digits' && !(tok.kind === 'hangul' && isKoNumeralChar(tok.text[0]))) return null
  for (const cut of candidateCuts(tokens, i)) {
    const hit = readKoreanWithin(tokens, i, cut)
    if (hit) return hit
  }
  return null
}

/** 10^(trailing zeros of `value`) — the magnitude of the lowest place the
 * value actually fills. "삼만" (30000) fills the 만 place, so anything below
 * 10000 can still be appended to it; "오천" (5000) only admits < 1000. This
 * is the same strictly-decreasing property `applyAtom` enforces WITHIN a
 * reader, applied here BETWEEN two reads. */
function trailingMagnitude(value: bigint): bigint {
  let magnitude = 1n
  while (value > 0n && value % (magnitude * 10n) === 0n) magnitude *= 10n
  return magnitude
}

/** A currency word or a closed quantity suffix starts at `at`. */
function isMoneyMarkerAt(input: string, at: number, limit: number): boolean {
  return koMarkerAt(input, at, limit, true) !== null || foldSuffix(input, at) !== at
}

/** The tokens from `from` to `to` with the spaces between them removed, plus
 * a map from each joined-text index back to its original input offset. */
function joinTokens(tokens: Token[], from: number, to: number): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  for (let k = from; k <= to; k++) {
    const tok = tokens[k]
    if (tok.kind === 'space') continue
    for (let c = 0; c < tok.text.length; c++) {
      text += tok.text[c]
      map.push(tok.start + c)
    }
  }
  return { text, map }
}

/**
 * Reads a Korean number at `i`, composing consecutive space-separated
 * segments into ONE number.
 *
 * `readKoreanNumber` already walks across spaces when the read is
 * Arabic-anchored ("3만 오천원" = 35000), but a Hangul-led read stops at its
 * own token ("삼만" then stops). The composition is NOT arithmetic here:
 * Korean writes the same number with or without the spaces, so the segments
 * are JOINED and handed back to the SAME reader — "삼만" + "오천원" is read
 * as "삼만오천원", by the one grammar that already knows how tiers combine.
 * That is what makes the mandated equality hold, for two segments and for
 * three alike: "3만 오천원" === "삼만 오천원" === "삼만오천원" === 35000, and
 * "삼만 오천 오백원" === 35500.
 *
 * Joining loses the space, and the space carries information the reader uses
 * (its own crossed-space guard stops "5천 5만" at 5000 rather than reading
 * one 50,050,000 compound), so a joined reading is only accepted when it
 * EXTENDS the shorter reading into strictly lower places: it must consume
 * more, be larger, and add less than the running value's lowest filled place
 * (`trailingMagnitude`). "5천 5만" fails that test and stays 5000; "3만 5명"
 * never even consumes past 3만.
 */
function readKoreanCompound(tokens: Token[], input: string, i: number): NumeralRead | null {
  const first = readKoreanSegment(tokens, i)
  if (!first || first.value <= 0n) return null

  let value = first.value
  let end = first.end
  let lastTokenIndex = i + first.tokenCount - 1

  while (true) {
    if (end !== tokens[lastTokenIndex].end) break // ended mid-token; nothing to join across
    if (tokens[lastTokenIndex + 1]?.kind !== 'space') break
    const nextIndex = lastTokenIndex + 2
    const next = tokens[nextIndex]
    if (!next || (next.kind !== 'hangul' && next.kind !== 'digits')) break
    // The whole next SEGMENT is joined, not just its first token: "5천 5만"
    // has to be offered to the reader as "5천5만" (which it rejects as a
    // 50,050,000 compound below), never as the truncated "5천5" — a partial
    // segment reads as a different, smaller number that would sail through
    // the extension test.
    let segmentEnd = nextIndex
    while (
      segmentEnd + 1 < tokens.length &&
      (tokens[segmentEnd + 1].kind === 'hangul' || tokens[segmentEnd + 1].kind === 'digits')
    ) {
      segmentEnd++
    }

    const joined = joinTokens(tokens, i, segmentEnd)
    const hit = readKoreanNumber(tokenize(joined.text), 0)
    if (!hit || hit.end === 0) break
    const joinedEnd = joined.map[hit.end - 1] + 1
    if (joinedEnd <= end) break // the joined reading does not reach the new segment
    // Stopping PART WAY through the joined segment means the reader took a
    // few characters of an ordinary word, not a numeral: "5만 천천히" joins to
    // "5만천천히" and reads 51000 off "5만천". Only a segment consumed whole,
    // or one left off at a money marker ("삼만오천|원"), is a real second
    // segment.
    if (joinedEnd < tokens[segmentEnd].end && !isMoneyMarkerAt(input, joinedEnd, tokens[segmentEnd].end)) {
      break
    }
    if (hit.value <= value || hit.value - value >= trailingMagnitude(value)) break

    value = hit.value
    end = joinedEnd
    lastTokenIndex = nextIndex
    while (lastTokenIndex < segmentEnd && tokens[lastTokenIndex].end < end) lastTokenIndex++
  }

  return makeRead(input, tokens, 'ko', i, lastTokenIndex, first.start, end, value, 0)
}

/**
 * A decimal coefficient in front of a unit-led Korean reading: "0.07만원" =
 * 700, "1.5억" = 150,000,000.
 *
 * `readKoreanNumber` rejects a digits token with a decimal point outright
 * (it is an integer reader), so the coefficient comes from the ENGLISH
 * reader (which reads "0.07" exactly as value 7, scale 2) and the unit's
 * value comes from the KOREAN reader reading the bare unit word ("만" =
 * 10000, "천만" = 10,000,000 — its own implied-1 rule). Composing the two
 * results is the only arithmetic here; neither reader's tier walk is
 * duplicated.
 *
 * Requires the following read to START at a place-value unit character —
 * "0.07 5만원" is two numbers, not a coefficient times 50000.
 */
function readDecimalCoefficient(tokens: Token[], input: string, i: number): NumeralRead | null {
  const coefficient = readEnglishNumber(tokens, i)
  if (!coefficient || coefficient.scale === 0) return null
  const unitIndex = coefficient.tokenCount + i
  const afterSpace = tokens[unitIndex]?.kind === 'space' ? unitIndex + 1 : unitIndex
  const unit = readKoreanSegment(tokens, afterSpace)
  if (!unit || unit.value <= 0n) return null
  if (!isKoNumeralChar(input[unit.start]) || /[0-9]/.test(input.slice(unit.start, unit.end))) return null
  if (!hasPlaceValueUnit(input.slice(unit.start, unit.end))) return null
  const lastTokenIndex = afterSpace + unit.tokenCount - 1
  return makeRead(
    input,
    tokens,
    'ko',
    i,
    lastTokenIndex,
    coefficient.start,
    unit.end,
    coefficient.value * unit.value,
    coefficient.scale,
  )
}

function readEnglish(tokens: Token[], input: string, i: number): NumeralRead | null {
  const hit = readEnglishNumber(tokens, i)
  if (!hit || hit.value <= 0n) return null
  return makeRead(input, tokens, 'en', i, i + hit.tokenCount - 1, hit.start, hit.end, hit.value, hit.scale)
}

// --- currency binding -------------------------------------------------------

interface Marker {
  code: string | null
  multiplier: bigint
  /** span the marker itself occupies, folded into the hit */
  start: number
  end: number
}

/** Index just past a trailing 원/씩/정도/쯤/짜리/가량/어치 (and one optional
 * josa after it), so a caller stripping the hit's span never leaves a
 * dangling quantity marker behind. Same job as hangul-number.ts's
 * `foldClosedSuffix`, over the token text instead of the whole string. */
function foldSuffix(input: string, at: number): number {
  for (const suffix of CLOSED_SUFFIXES) {
    if (input.startsWith(suffix, at)) return at + suffix.length
  }
  return at
}

/** `foldSuffix`, but skipping whitespace first — a spaced quantity marker
 * ("3만원 정도") belongs to the amount's span just as much as a glued one, or
 * it is left behind in the description. Mirrors the old
 * `foldClosedSuffix`'s whitespace skip. */
function foldSuffixAcrossSpace(input: string, at: number): number {
  let afterSpace = at
  while (afterSpace < input.length && /\s/.test(input[afterSpace])) afterSpace++
  const folded = foldSuffix(input, afterSpace)
  return folded === afterSpace ? at : folded
}

/**
 * Whether a Korean currency word matched at `rest` really ends there.
 *
 * A currency word GLUED to the number is trusted as-is ("12000원이야",
 * "8,500원" — the tokenizer already proved it is attached to the numeral,
 * and enumerating every verb ending that may follow 원 is the exact mistake
 * docs/SOLVED.md logs). A SPACED one has to end cleanly — at end of text, at
 * a non-Hangul character, at a legal josa (`detachJosa`, the mined
 * inventory), or at a closed quantity suffix — so "3만 엔진 고장" stays
 * 30000 KRW instead of reading 엔(JPY) out of "엔진".
 */
function koCurrencyEndsCleanly(rest: string, word: string, glued: boolean): boolean {
  if (glued) return true
  const after = rest.slice(word.length)
  if (after === '') return true
  const firstCp = after.codePointAt(0)
  if (firstCp === undefined || !isHangulCodePoint(firstCp)) return true
  if (foldSuffix(after, 0) !== 0) return true
  return detachJosa(word + after)?.stem === word
}

function koMarkerAt(input: string, at: number, limit: number, glued: boolean): Marker | null {
  const rest = input.slice(at, limit)
  for (const entry of KO_CURRENCY_WORDS) {
    if (!rest.startsWith(entry.token)) continue
    if (!koCurrencyEndsCleanly(rest, entry.token, glued)) continue
    return {
      code: entry.code,
      multiplier: entry.multiplier,
      start: at,
      end: foldSuffix(input, at + entry.token.length),
    }
  }
  return null
}

/** The currency/money marker attached AFTER the number, if any. */
function findSuffixMarker(tokens: Token[], input: string, read: NumeralRead): Marker | null {
  const lastTok = tokens[read.lastTokenIndex]
  // The read stopped INSIDE a Hangul token — the marker, if there is one, is
  // the rest of that same token ("만원만" reads 만, leaving 원만).
  if (lastTok.kind === 'hangul' && read.end < lastTok.end) {
    return koMarkerAt(input, read.end, lastTok.end, true)
  }
  let j = read.lastTokenIndex + 1
  let glued = true
  if (tokens[j]?.kind === 'space') {
    j += 1
    glued = false
  }
  const tok = tokens[j]
  if (!tok) return null
  if (tok.kind === 'hangul') return koMarkerAt(input, tok.start, tok.end, glued)
  if (tok.kind === 'latin') {
    const entry = LATIN_CURRENCY_WORDS.get(tok.text.toLowerCase())
    if (!entry) return null
    return { code: entry.code, multiplier: entry.multiplier, start: tok.start, end: tok.end }
  }
  return null
}

/** The currency marker attached BEFORE the number ("$45.60", "USD3.14"). */
function findPrefixMarker(tokens: Token[], read: NumeralRead): Marker | null {
  let j = read.firstTokenIndex - 1
  if (tokens[j]?.kind === 'space') j -= 1
  const tok = tokens[j]
  if (!tok) return null
  if (tok.kind === 'punct') {
    // A punct RUN groups into one token ("(¥"), so only its last character
    // can be the symbol that leads the number.
    const symbol = tok.text.slice(-1)
    const entry = SYMBOL_CURRENCY.get(symbol)
    if (!entry) return null
    return { code: entry.code, multiplier: entry.multiplier, start: tok.end - symbol.length, end: tok.end }
  }
  if (tok.kind === 'latin') {
    const entry = LATIN_CURRENCY_WORDS.get(tok.text.toLowerCase())
    if (!entry || !entry.prefix) return null
    return { code: entry.code, multiplier: entry.multiplier, start: tok.start, end: tok.end }
  }
  return null
}

/** "a grand" — the en reader consumes the slang unit itself (value 1000), so
 * there is no suffix token left to find; the money marking has to be read
 * off the read's own last token instead. */
function consumedMoneyUnit(tokens: Token[], read: NumeralRead): boolean {
  const last = tokens[read.lastTokenIndex]
  if (last.kind !== 'latin') return false
  const entry = LATIN_CURRENCY_WORDS.get(last.text.toLowerCase())
  return entry !== undefined && last.end === read.end
}

// --- money qualification ----------------------------------------------------

/**
 * A Korean place-value compound is a money reading on its own, with no
 * currency word needed: "3만 5명" is ₩30,000 for 5 people, and the currency
 * is KRW even when the group's default is something else (the numerals are
 * Korean; the old `extractAmount` rule 1 hardcoded exactly this and every
 * caller depends on it — see people.ts's `maskAmounts`).
 */
const KOREAN_COMPOUND_IS_MONEY = 'KRW'

/** A bare number (no currency signal anywhere) is money only when it does
 * not look like a plain count: 3+ digits, or comma-grouped. "커피 2" stays a
 * count and the UI asks. Word-spelled numbers ("fifty") never qualify bare —
 * they need a currency word, which is the conservative half of "unknown →
 * null, never invented". */
function isBareMoneyShape(text: string): boolean {
  return /^(?:\d{3,}|\d{1,3}(?:,\d{3})+)$/.test(text)
}

/**
 * A bare number must stand alone between whitespace or the ends of the text
 * — the boundary the old rule-4 regex `(?:^|\s)…(?:$|\s)` enforced.
 *
 * Anything else adjacent to it (a hyphen, a tilde, a dot, a letter) means it
 * is part of something that is not money: "2026-08-13 정산하자",
 * "010-1234-5678로 보내줘", "가격은 1500~2000". A MARKED amount is exempt —
 * "$45.60"/"8,500원" carry their own evidence and legitimately sit against
 * punctuation.
 */
function standsAlone(tokens: Token[], index: number): boolean {
  const before = tokens[index - 1]
  const after = tokens[index + 1]
  return (
    (before === undefined || before.kind === 'space') && (after === undefined || after.kind === 'space')
  )
}

/**
 * A Korean numeral must not END on a bare Sino-Korean digit syllable unless a
 * currency/quantity marker confirms it right there.
 *
 * `parseSino` keeps a trailing digit when nothing contradicts it, which is
 * right for a numeral reader ("삼백육십오원" is 365) and wrong for an amount
 * reader when the syllable is really a particle: "오천이 나왔어" is 5000 with
 * a subject 이, not 5002. The reader's own trailing-digit rule asks for a
 * continuation from ITS lexicon; this asks the same question with the
 * parser's money lexicon, about the character the reader actually CONSUMED —
 * the boundary law below can only see what follows the read, which is why it
 * cannot answer this one.
 */
function endsOnUnconfirmedDigit(input: string, read: NumeralRead, confirmed: boolean): boolean {
  if (confirmed) return false
  return HANGUL_DIGIT_CHARS.includes(input[read.end - 1])
}

/**
 * A Hangul-only reading directly after a pure-numeral Hangul word the reader
 * could NOT read is a fragment of that bigger number, not an amount of its
 * own: "오만 삼천원" is 53,000, and reporting the 3,000 the second half reads
 * as would be a confidently wrong number. The reader declines "오만" here (it
 * collides with a decoy and nothing rescues it across the space), so the
 * honest answer for the whole phrase is to ask.
 *
 * Scoped to readings with no Arabic digit of their own: an Arabic anchor is
 * unambiguous numeric intent (docs/SOLVED.md round 8's ruling), so "천사
 * 3만원" still reports 30,000.
 */
function followsUnreadNumeral(tokens: Token[], read: NumeralRead): boolean {
  if (read.arabicDigit) return false
  let j = read.firstTokenIndex - 1
  if (tokens[j]?.kind === 'space') j -= 1
  const prev = tokens[j]
  if (!prev || prev.kind !== 'hangul') return false
  if (!Array.from(prev.text).every((ch) => isKoNumeralChar(ch))) return false
  return readKoreanSegment(tokens, j) === null
}

/**
 * The end-of-number boundary law, inherited from the reader
 * `extractAmount` used before this parser (assistant/hangul-number.ts).
 *
 * When a Korean read stops INSIDE a Hangul token, what follows decides:
 *  - a numeral character (일-구, 십백천만억) means the READER itself declined
 *    to take it (a rolled-back josa-shaped digit — "3만이야" → 30000,
 *    "오만이면" → 50000); the reader's own rules already ran, so the read
 *    stands.
 *  - a currency word or a closed quantity suffix confirms it ("3만원",
 *    "3만씩", "5천짜리").
 *  - anything else is ordinary text glued to the numeral, and the number is
 *    NOT confidently an amount: "3만5천으로"/"5천으로"/"3만5천에 바꿔줘" all
 *    stay null rather than book a number the sentence was only talking
 *    about. (These are pinned by chat-parse/amount.test.ts's C1 cases.)
 */
function isKoreanEndBoundaryOk(tokens: Token[], input: string, read: NumeralRead): boolean {
  const lastTok = tokens[read.lastTokenIndex]
  if (lastTok.kind !== 'hangul' || read.end >= lastTok.end) return true
  if (isKoNumeralChar(input[read.end])) return true
  if (koMarkerAt(input, read.end, lastTok.end, true) !== null) return true
  return foldSuffix(input, read.end) !== read.end
}

/**
 * First words of multi-word split phrases that say nothing about money on
 * their own. "all together" / "went dutch" / "went halves" / "going dutch"
 * contribute `all` / `went` / `going` to the set below, and those are ordinary
 * English verbs and determiners — "1999 went by fast" is not a price (fix
 * round 3 ruling: DROP them rather than match whole phrases here, since the
 * one-word approximation is otherwise exactly right).
 *
 * The split words that remain — split, evenly, everyone, half, each — DO
 * confirm money after a number: "1899 each", "1500 split evenly". `everyone`
 * is the loosest of them ("1984 everyone knows" reads as an amount, asserted
 * as a corpus row), and it stays because a number followed by `everyone` is
 * an expense entry far more often than it is a sentence about a year.
 */
const NON_CONFIRMING_SPLIT_LEADS = new Set(['all', 'went', 'going'])

/**
 * Every English word that, sitting right after a bare number, CONFIRMS it is
 * money: a currency word or slang unit, a split expression, the funding word,
 * one of the closed price-binding prepositions, or a total-word. Built from
 * the lexicons themselves — a split phrase contributes its FIRST word, which
 * is the one that would sit against the number ("300 all together").
 *
 * This is NOT a licence to be money (that is the default). It is the OVERRIDE
 * on the year disqualifier below: a price in the 1000-2100 band is refused
 * only when nothing in the sentence confirms it, so "1500 for lunch",
 * "1899 each" and "2000 cash" all still read.
 */
const MONEY_CONFIRMING_FOLLOWERS_EN: ReadonlySet<string> = new Set([
  ...LATIN_CURRENCY_WORDS.keys(),
  ...SPLIT_EN.map((phrase) => phrase.split(' ')[0]).filter(
    (word) => !NON_CONFIRMING_SPLIT_LEADS.has(word),
  ),
  ...FUNDING_WORDS_EN,
  ...PRICE_BINDERS_EN,
  ...TOTAL_WORDS_EN,
])

/**
 * A bare number in the range English writes YEARS in. Four digits, 1000-2100:
 * "a 2008 comedy", "born in 1770", "a 1979 number one", "which 1998 Disney
 * film". Every one of those read as money before this guard existed.
 *
 * The range is the whole rule — not a list of years, and not a judgement about
 * the words around it beyond the one condition below.
 */
function isYearShaped(text: string): boolean {
  if (!/^\d{4}$/.test(text)) return false
  const value = Number(text)
  return value >= 1000 && value <= 2100
}

/**
 * Words that CLAIM the number in front of them, so the number is theirs and
 * not a price: a measure noun ("250,000 miles from earth", "40 minutes") or a
 * possessive/demonstrative determiner opening the next phrase ("is hal 9000
 * your boyfriend").
 *
 * This is a DENYLIST, and it is deliberately incomplete — the ruling this
 * implements (Task 11 fix round 1) is that a bare number DEFAULTS TO MONEY,
 * because that is how chat writes prices in both languages ("taxi 8500 last
 * night", "커피 4500"), and an allowlist of permitted followers silently
 * swallowed every shape nobody thought to list.
 *
 * The two directions fail differently, which is the whole reason for the
 * default: a word MISSING from this denylist means a number is read that
 * should not have been, and the user sees it on the card that opens; a word
 * missing from an allowlist means the amount is never read at all, and the
 * sentence looks to the user like one the app simply did not understand.
 */
const NUMBER_CLAIMING_FOLLOWERS_EN: ReadonlySet<string> = new Set([
  // possessive / demonstrative determiners
  'my', 'your', 'his', 'her', 'their', 'our', 'its', 'this', 'that', 'these', 'those',
  // measure nouns (the plural is what follows a count; singulars where a
  // count of one is idiomatic)
  'mile', 'miles', 'km', 'kilometers', 'kilometres', 'meters', 'metres',
  'feet', 'ft', 'inches', 'lbs', 'pounds', 'kg', 'kilos', 'litres', 'liters',
  'degrees', 'calories', 'steps', 'points', 'percent',
  'people', 'persons', 'guests', 'nights', 'years', 'months', 'weeks', 'days',
  'hours', 'minutes', 'seconds', 'times',
])

/**
 * Whether a BARE (unmarked) number is disqualified from being money by what it
 * is, or by the word immediately after it.
 *
 * The default is ACCEPT — `isBareMoneyShape` and `standsAlone` above already
 * ask the two structural questions (does it look like an amount rather than a
 * count, and is it a free-standing token rather than part of a date, a phone
 * number or a range). This adds the two disqualifiers the Task 11 fuzz corpus
 * proved were missing, and nothing else:
 *
 *  - a YEAR-shaped number followed by an English word that does NOT confirm
 *    money ("a 2008 comedy", "room 1204 last night"). Two conditions narrow
 *    it. The follower must exist and be Latin, which is what keeps ordinary
 *    Korean prices out entirely — "커피 2000" and "카톡 1234" have no Latin
 *    word after them and stay money. And a MONEY-CONFIRMING follower
 *    overrides the rule outright, so "1500 for lunch", "1899 each",
 *    "2000 cash" and "dinner 1500 total" read as prices in the same band.
 *
 *    What is left as the documented cost is a price in 1000-2100 followed by
 *    an ordinary English word with nothing else confirming it — "hotel 1200
 *    last night" → no amount, and (this being an entry sentence, not a card
 *    reply) NO CARD AT ALL: the user is asked, not shown. That is the price
 *    of not booking every year in an English sentence as an amount, and it
 *    is paid only in that 1,101-value band.
 *  - a follower that CLAIMS the number as its own quantity ("250,000 miles",
 *    "9000 your boyfriend").
 *
 * MARKED amounts never reach here: "$45.60"/"8,500원" carry their own evidence
 * and may sit against any word they like.
 */
function isDisqualifiedBareNumber(tokens: Token[], read: NumeralRead): boolean {
  let j = read.lastTokenIndex + 1
  if (tokens[j]?.kind === 'space') j += 1
  const next = tokens[j]
  if (next === undefined || next.kind !== 'latin') return false
  const follower = next.text.toLowerCase()
  if (MONEY_CONFIRMING_FOLLOWERS_EN.has(follower)) return false
  if (isYearShaped(tokens[read.firstTokenIndex].text)) return true
  return NUMBER_CLAIMING_FOLLOWERS_EN.has(follower)
}

interface Candidate {
  hit: ParseHit<'amount', AmountValue>
  /** first token index NOT covered by the hit */
  nextTokenIndex: number
}

function qualify(
  tokens: Token[],
  input: string,
  read: NumeralRead,
  defaultCurrency: string,
): Candidate | null {
  const prefix = findPrefixMarker(tokens, read)
  const suffix = findSuffixMarker(tokens, input, read)
  const marker = suffix ?? prefix
  /** a currency word or a closed quantity suffix sits right after the number */
  const confirmed = suffix !== null || foldSuffixAcrossSpace(input, read.end) !== read.end

  if (read.source === 'ko') {
    // A bare Sino-Korean digit with no place-value unit is not money ('사' in
    // '치킨 사 먹었어', '이' in '나 이 12000원 냈어') — it must never shadow a
    // real amount later in the sentence.
    if (!read.placeValue && !read.arabicDigit) return null
    if (!isKoreanEndBoundaryOk(tokens, input, read)) return null
    if (endsOnUnconfirmedDigit(input, read, confirmed)) return null
    if (followsUnreadNumeral(tokens, read)) return null
  }
  // The suffix names the currency when it has one, otherwise the prefix does
  // — "$5 grand" is 5000 USD: `grand` multiplies but names no currency, and
  // dropping to the default there would throw away the `$` that is right
  // there in the text.
  const code = suffix?.code ?? prefix?.code ?? null
  // Only a suffix unit multiplies ("5 grand"); a leading symbol never does.
  const multiplier = suffix?.multiplier ?? 1n

  // An implied-1 unit ("헐 억", "아 만 진짜") carries no digit at all; only a
  // currency/quantity marker makes it a quantity ("만원" = 10000).
  if (!read.anyDigit && marker === null && !consumedMoneyUnit(tokens, read)) return null

  const koreanCompound = read.source === 'ko' && read.placeValue
  const marked = marker !== null || koreanCompound || consumedMoneyUnit(tokens, read)

  const start = Math.min(read.start, prefix?.start ?? read.start)
  // A trailing 씩/짜리/정도/쯤/가량/어치 belongs to the amount's span even
  // though it names no currency ("3만씩 걷자" = 30000 each): a caller that
  // strips the span for the description must not be left holding it.
  const end = foldSuffixAcrossSpace(input, Math.max(read.end, suffix?.end ?? read.end))

  if (!marked) {
    if (!read.singleDigitsToken) return null
    if (!isBareMoneyShape(tokens[read.firstTokenIndex].text)) return null
    if (!standsAlone(tokens, read.firstTokenIndex)) return null
    if (isDisqualifiedBareNumber(tokens, read)) return null
  }

  const amount =
    multiplier === 1n ? read.amount : formatDecimal(read.value * multiplier, read.scale)
  const currency = code ?? (koreanCompound ? KOREAN_COMPOUND_IS_MONEY : defaultCurrency)

  let nextTokenIndex = read.lastTokenIndex + 1
  while (nextTokenIndex < tokens.length && tokens[nextTokenIndex].start < end) nextTokenIndex++

  return {
    hit: {
      type: 'amount',
      start,
      end,
      value: { amount, currency, marked },
      confidence: marked ? 1 : 0.6,
    },
    nextTokenIndex,
  }
}

// --- the never-invent-a-number invariant ------------------------------------

/**
 * A hit must be REPRODUCIBLE from where it starts: parsing the text from
 * `hit.start` onward must yield the identical first hit — same amount, same
 * currency, same span. Nothing to the LEFT of an amount may change what that
 * amount is worth.
 *
 * The first version of this check re-parsed the hit's span ALONE, which was
 * wrong in both directions:
 *  - false positives, on every reading a reader legitimately confirms from
 *    the text AFTER the span. "오천이야" is 5000 with the span 오천 (the
 *    reader rolled the 이 back), "오만 짜리" is 50000 with the span 오만 (the
 *    following 짜리 is what rescues the 오만 decoy) — in isolation neither
 *    span reads at all, so the check threw on ordinary Korean.
 *  - and a false negative all the same: a span that re-reads to the same
 *    WRONG value ("오천이" → 5002) sails through, so this can never be the
 *    guard against mis-consuming a trailing syllable. That job belongs to
 *    `endsOnUnconfirmedDigit`, which asks what the reader consumed.
 *
 * Outside production a violation THROWS (tests must fail loudly). In
 * production the hit is dropped instead: a missing amount makes the UI ask
 * "얼마였어?", which is always cheaper than a wrong save.
 */
function verifyReproducible(
  hit: ParseHit<'amount', AmountValue>,
  input: string,
  defaultCurrency: string,
): boolean {
  const rest = input.slice(hit.start)
  // Only the FIRST hit of the re-parse is ever compared, so the re-parse
  // stops there. Without that stop the check re-parsed the whole remaining
  // sentence once per hit, which is quadratic in the input: a message of 400
  // amounts took 9.5s instead of 78ms. The parse is verified, not repeated.
  const first = findAmountsIn(tokenize(rest), rest, defaultCurrency, false, true)[0]
  const ok =
    first !== undefined &&
    first.start === 0 &&
    first.end === hit.end - hit.start &&
    first.value.amount === hit.value.amount &&
    first.value.currency === hit.value.currency
  if (ok) return true
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(
      `amount parser invariant: "${rest}" does not re-read as ${hit.value.amount} ${hit.value.currency} over ${hit.end - hit.start} chars`,
    )
  }
  return false
}

// --- entry point ------------------------------------------------------------

function findAmountsIn(
  tokens: Token[],
  input: string,
  defaultCurrency: string,
  verify: boolean,
  /** stop at the first hit — the verification pass compares only that one */
  stopAfterFirst = false,
): Array<ParseHit<'amount', AmountValue>> {
  const hits: Array<ParseHit<'amount', AmountValue>> = []
  let i = 0
  while (i < tokens.length) {
    const reads = [
      readKoreanCompound(tokens, input, i),
      readDecimalCoefficient(tokens, input, i),
      readEnglish(tokens, input, i),
    ]
    let best: Candidate | null = null
    for (const read of reads) {
      if (!read) continue
      const candidate = qualify(tokens, input, read, defaultCurrency)
      if (!candidate) continue
      // Longest span wins; the Korean read is tried first, so it also wins ties.
      if (best === null || candidate.hit.end - candidate.hit.start > best.hit.end - best.hit.start) {
        best = candidate
      }
    }
    if (best === null) {
      i += 1
      continue
    }
    if (verify && !verifyReproducible(best.hit, input, defaultCurrency)) {
      i += 1
      continue
    }
    hits.push(best.hit)
    if (stopAfterFirst) break
    i = Math.max(best.nextTokenIndex, i + 1)
  }
  return hits
}

/**
 * Every money mention in `tokens`, left to right, non-overlapping. Returns
 * `[]` rather than guessing when nothing in the sentence is confidently an
 * amount — a null makes the UI ask, which is cheaper than a wrong save.
 */
export function findAmounts(
  tokens: Token[],
  input: string,
  defaultCurrency: string,
): Array<ParseHit<'amount', AmountValue>> {
  return findAmountsIn(tokens, input, defaultCurrency, true)
}
