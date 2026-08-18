import type { Token } from '../engine/tokens'

/**
 * English cardinal-number reader — parsing core ported from words-to-numbers
 * (MIT, https://github.com/0x80/words-to-numbers), reworked to walk this
 * codebase's `Token[]` array with exact bigint/scale arithmetic instead of
 * upstream's float division for decimals. See NOTICE.
 *
 * Handles: word cardinals ("forty five", "one hundred and five", "fifteen
 * hundred"), digit tokens with comma grouping and a decimal point ("45.60",
 * "45,000"), a glued k/K/m/M magnitude suffix on a digit token ("1.2k"), the
 * "a hundred"/"a grand" article-before-magnitude-word idiom, and a
 * word-spelled decimal ("ten point five"). Slang currency UNITS (bucks,
 * quid, "5 grand" meaning $5000) are Task 6's job, not this reader's — see
 * the interface doc-comment below.
 */

export interface EnNumberHit {
  value: bigint
  /** real value = value * 10^-scale. 0 for integers. */
  scale: number
  /** how many tokens consumed */
  tokenCount: number
  start: number
  end: number
}

const ONES: Record<string, bigint> = {
  zero: 0n,
  one: 1n,
  two: 2n,
  three: 3n,
  four: 4n,
  five: 5n,
  six: 6n,
  seven: 7n,
  eight: 8n,
  nine: 9n,
  ten: 10n,
  eleven: 11n,
  twelve: 12n,
  thirteen: 13n,
  fourteen: 14n,
  fifteen: 15n,
  sixteen: 16n,
  seventeen: 17n,
  eighteen: 18n,
  nineteen: 19n,
}

const TENS: Record<string, bigint> = {
  twenty: 20n,
  thirty: 30n,
  forty: 40n,
  fifty: 50n,
  sixty: 60n,
  seventy: 70n,
  eighty: 80n,
  ninety: 90n,
}

const SMALL_UNIT: Record<string, bigint> = {
  hundred: 100n,
}

const BIG_UNIT: Record<string, bigint> = {
  thousand: 1_000n,
  million: 1_000_000n,
  billion: 1_000_000_000n,
  trillion: 1_000_000_000_000n,
}

// Deliberately does NOT include ordinals (first/second/third/...) —
// upstream's UNIT map does, which would make "the second option" parse a
// phantom number 2 in ordinary chat text. Cardinals only.
const JOINERS = new Set(['and'])
const DECIMAL_MARKERS = new Set(['point', 'dot'])

/** Glued digit-token magnitude suffix — "1.2k" tokenizes as digits "1.2" +
 * latin "k" with no gap between them (see engine/tokenizer.ts's doc-comment
 * on this exact shape). Scoped to k/K/m/M per the brief; no b/B — out of
 * required scope. */
const DIGIT_SUFFIX_MAGNITUDE: Record<string, bigint> = {
  k: 1_000n,
  m: 1_000_000n,
}

/** Article-before-magnitude-word idiom ("a hundred", "a grand") — the ONLY
 * way the word "a" contributes to a number reading here. Upstream
 * words-to-numbers maps bare "a" to UNIT value 1, which (per its own
 * BLACKLIST_SINGULAR_WORDS special-case for a lone "a") still leaks through
 * as soon as "a" appears as one token among several unrelated ones — e.g.
 * "a book" would parse as the number 1. That is not a safe default for a
 * chat parser scanning arbitrary sentences, so it is deliberately NOT
 * ported: "a" is only ever a coefficient here when the very next word is a
 * recognized magnitude word (SMALL_UNIT, BIG_UNIT, or "grand" below) — see
 * `readArticleCoefficient`. "grand" itself is intentionally NOT added to
 * BIG_UNIT: "10 grand"/"five grand" (a number generally followed by
 * "grand") is the slang-currency-UNIT reading Task 6 owns, per the task
 * brief's scope note — only the fixed "a grand" idiom belongs here.
 */
const GRAND_VALUE = 1_000n

const MAX_SIGNIFICANT_DIGITS = 15

function significantDigitCount(digits: string): number {
  return (digits.replace(/^0+/, '') || '0').length
}

/** Validates a digits token's shape BEFORE any arithmetic touches it:
 * either a plain digit run with no commas at all ("45000"), or a properly
 * US-grouped comma run (1-3 digits, then complete ",DDD" groups —
 * "45,000", "1,234,567"), each optionally followed by exactly one ".digits"
 * decimal suffix. Rejects anything else — multiple decimal points
 * ("1.2.3", "12.25.2024", "3.14.15": the tokenizer's digit-grouping rule
 * happily produces these as ONE token whenever every separator is
 * digit-flanked, and naively taking `indexOf('.')` for the first dot while
 * leaving a second dot in the "fraction" used to crash `BigInt()` outright)
 * and malformed groupings ("1,5" — a comma group must be exactly 3 digits;
 * accepting a short group used to silently misread it as "15", a
 * confidently wrong value for what is genuinely an ambiguous/malformed
 * shape). Never guesses past an invalid shape — null. */
function isValidDigitsShape(text: string): boolean {
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)
}

/** Strips trailing zero decimal places while scale > 0, so two
 * differently-spelled inputs with the same real value ("7.2" and "7.20000")
 * produce the identical canonical {value, scale} pair. */
function normalize(value: bigint, scale: number): { value: bigint; scale: number } {
  while (scale > 0 && value % 10n === 0n) {
    value /= 10n
    scale -= 1
  }
  return { value, scale }
}

// --- token-level helpers ----------------------------------------------------

/** Returns the index reachable from `idx` by crossing at most one
 * space token or one hyphen-punct token ("forty-five") — English number
 * words are already whole tokens (unlike Korean's per-syllable hangul
 * tokens), so no char-level walking is needed here, only token-level
 * separator-skipping. Returns `idx` unchanged if there is nothing to
 * cross. */
function skipSeparator(tokens: Token[], idx: number): number {
  const t = tokens[idx]
  if (t?.kind === 'space') return idx + 1
  if (t?.kind === 'punct' && t.text === '-') return idx + 1
  return idx
}

function wordAt(tokens: Token[], idx: number): string | null {
  const t = tokens[idx]
  return t?.kind === 'latin' ? t.text.toLowerCase() : null
}

/** Parses a single digits token into an exact {value, scale} pair. Strips
 * comma thousands-separators; a single `.` splits integer/fraction (the
 * fraction's length becomes `scale`). Null on a >15-significant-digit
 * value — never silently truncated (mirrors ko/numbers.ts's same guard and
 * rationale: this large a number in chat text is almost certainly not a
 * real amount). */
// Note: a LEADING dot (".5" meaning 0.5) is not reachable here — the
// tokenizer only starts a 'digits' run on a digit character (see
// engine/tokenizer.ts's `classify`), so ".5" always tokenizes as a
// separate punct "." token followed by a plain digits "5" token, and
// readEnglishNumber(tokens, indexOf('5')) reads it as the integer 5, not
// 0.5. Not fixed here — would need a tokenizer-level or dispatch-level
// change to recognize a leading-dot digit run, which is out of this
// reader's scope; flagged so a future caller doesn't assume ".5" round-trips.
function parseDigitsToken(tok: Token): { value: bigint; scale: number } | null {
  if (!isValidDigitsShape(tok.text)) return null
  const stripped = tok.text.replace(/,/g, '')
  const dotIdx = stripped.indexOf('.')
  const intPart = dotIdx === -1 ? stripped : stripped.slice(0, dotIdx)
  const fracPart = dotIdx === -1 ? '' : stripped.slice(dotIdx + 1)
  const digits = intPart + fracPart
  if (significantDigitCount(digits) > MAX_SIGNIFICANT_DIGITS) return null
  return { value: BigInt(digits), scale: fracPart.length }
}

/** One composed coefficient: a digits token's value, a bare ones-word
 * (0-19), or a tens-word optionally combined with a following 1-9 ones-word
 * ("forty" alone = 40, "forty five" = 45). Does not itself apply any
 * hundred/thousand multiplier — that's the caller's job (tier state below).
 * Only ever reads an INTEGER coefficient (scale 0) — a digits token with a
 * decimal point is handled separately by the entry points, since a decimal
 * can only ever be the reading's leading coefficient, never a later one
 * ("one hundred 45.6" is not a sensible English number). */
function readCoefficient(tokens: Token[], idx: number): { value: bigint; endIndex: number } | null {
  const tok = tokens[idx]
  if (!tok) return null
  if (tok.kind === 'digits') {
    const parsed = parseDigitsToken(tok)
    if (parsed === null || parsed.scale > 0) return null // no decimal as a non-leading coefficient
    return { value: parsed.value, endIndex: idx }
  }
  const word = wordAt(tokens, idx)
  if (word === null) return null
  if (Object.hasOwn(TENS, word)) {
    const tensValue = TENS[word]
    const nextIdx = skipSeparator(tokens, idx + 1)
    const nextWord = wordAt(tokens, nextIdx)
    if (nextWord !== null && Object.hasOwn(ONES, nextWord)) {
      const onesValue = ONES[nextWord]
      if (onesValue >= 1n && onesValue <= 9n) {
        return { value: tensValue + onesValue, endIndex: nextIdx }
      }
    }
    return { value: tensValue, endIndex: idx }
  }
  if (Object.hasOwn(ONES, word)) return { value: ONES[word], endIndex: idx }
  return null
}

/** Slang/formal currency UNIT nouns that pair with the article "a" to mean
 * exactly 1 of that unit ("a buck" = $1, "a dollar" = $1) — unlike
 * "a grand"/"a hundred" below, the unit word is NOT itself a magnitude and
 * is left COMPLETELY UNCONSUMED: the hit spans only "a", value 1, so Task
 * 6's amount parser sees "buck"/"dollar" untouched and can bind it as the
 * currency, the same way it already would after a plain "100 dollars".
 * Scoped to exactly the two words the task brief and review named — not
 * "quid" or any other slang unit, which would be new, undiscussed scope. */
const ARTICLE_UNIT_NOUNS = new Set(['buck', 'dollar'])

/** "a" immediately (one optional space) before a magnitude word — the ONLY
 * way bare "a" participates in a number reading (see GRAND_VALUE doc
 * comment above). Handles "a hundred"/"a thousand"/"a million"/"a
 * grand" uniformly: coefficient 1 times the magnitude word's value. Also
 * handles "a buck"/"a dollar" (see ARTICLE_UNIT_NOUNS) — same article, but
 * a fundamentally different consumption shape, so checked first and
 * returned separately rather than folded into the multiply below. */
function readArticleCoefficient(tokens: Token[], i: number): EnNumberHit | null {
  if (wordAt(tokens, i) !== 'a') return null
  const nextIdx = skipSeparator(tokens, i + 1)
  const word = wordAt(tokens, nextIdx)
  if (word === null) return null
  if (ARTICLE_UNIT_NOUNS.has(word)) {
    const tok = tokens[i]
    return { value: 1n, scale: 0, tokenCount: 1, start: tok.start, end: tok.end }
  }
  let mult: bigint | undefined
  if (word === 'grand') mult = GRAND_VALUE
  else if (Object.hasOwn(SMALL_UNIT, word)) mult = SMALL_UNIT[word]
  else if (Object.hasOwn(BIG_UNIT, word)) mult = BIG_UNIT[word]
  if (mult === undefined) return null
  const endTok = tokens[nextIdx]
  return { value: mult, scale: 0, tokenCount: nextIdx - i + 1, start: tokens[i].start, end: endTok.end }
}

/** After a "point"/"dot" decimal marker: consumes either one digits token
 * (the whole token is the fractional block, e.g. "point 25" -> .25) or a
 * run of single-digit (0-9) ones-words, one decimal place each ("point one
 * four" -> .14). Null (whole hit rejected, never truncated) when what
 * follows isn't a valid decimal digit at all.
 *
 * Each word is consumed ONE AT A TIME, and `endIndex` only ever advances to
 * a position that was ITSELF just validated as a 0-9 ones-word — never to
 * whatever token happens to follow it. An earlier version advanced `cur`
 * to the NEXT token first and only validated it on the following loop
 * iteration, so a non-digit word right after a valid one (most commonly a
 * trailing magnitude word or currency noun: "two point five million",
 * "ten point five dollars") got folded into `endIndex` anyway before the
 * loop noticed it didn't qualify — the caller then treated that unrelated
 * word as already consumed, corrupting the trailing-magnitude multiply in
 * the first case (readWordLed looked for "million" AFTER, not AT,
 * `tail.endIndex`, so it silently missed the multiply) and swallowing the
 * currency word into the hit's span in the second (leaving Task 6 nothing
 * to bind a currency to). See docs/SOLVED.md. */
function readDecimalTail(
  tokens: Token[],
  idx: number,
): { value: bigint; scale: number; endIndex: number } | null {
  const tok = tokens[idx]
  if (tok?.kind === 'digits') {
    if (tok.text.includes('.') || tok.text.includes(',')) return null
    if (significantDigitCount(tok.text) > MAX_SIGNIFICANT_DIGITS) return null
    return { value: BigInt(tok.text), scale: tok.text.length, endIndex: idx }
  }
  let value = 0n
  let scale = 0
  let cur = idx
  let endIndex = -1
  while (true) {
    const word = wordAt(tokens, cur)
    if (word === null || !Object.hasOwn(ONES, word) || ONES[word] > 9n) break
    value = value * 10n + ONES[word]
    scale += 1
    endIndex = cur // only ever a position just confirmed as a valid digit word
    cur = skipSeparator(tokens, cur + 1)
  }
  if (endIndex === -1) return null
  return { value, scale, endIndex }
}

/** Optional single trailing big-unit multiplier after a decimal value
 * ("48.2 million", "two point five million") — the one place a decimal
 * reading may still combine with a magnitude word. Returns the (possibly
 * unchanged) value/scale/endIndex. */
function applyOptionalTrailingBigUnit(
  tokens: Token[],
  afterIndex: number,
  value: bigint,
  scale: number,
): { value: bigint; scale: number; endIndex: number } {
  const nextIdx = skipSeparator(tokens, afterIndex + 1)
  const word = wordAt(tokens, nextIdx)
  if (word !== null && Object.hasOwn(BIG_UNIT, word)) {
    return { value: value * BIG_UNIT[word], scale, endIndex: nextIdx }
  }
  return { value, scale, endIndex: afterIndex }
}

// --- shared integer tier grammar --------------------------------------------
//
// Same shape as ko/numbers.ts's applyAtom/TierState (total/section/pending
// coefficient/last-seen small & big unit) — English tiering (hundred, then
// strictly-descending thousand/million/billion/trillion) is structurally
// the same problem as Korean's 만/억/조 tiering, just with a different atom
// vocabulary (a composed TEN+ONES coefficient standing in for a sino
// digit syllable). Independently re-derived here for English's word
// grammar, not imported — a different language's construction, not a
// second arithmetic path for the SAME one (see docs/SOLVED.md round 8's
// "one grammar" lesson: that rule is about not having two ways to compute
// the same construction, not about every language sharing one module).

interface TierState {
  total: bigint
  section: bigint
  pending: bigint | null
  lastSmallUnit: bigint | null
  lastBigUnit: bigint | null
}

function initTierState(): TierState {
  return { total: 0n, section: 0n, pending: null, lastSmallUnit: null, lastBigUnit: null }
}

function finalizeTierValue(state: TierState): bigint {
  return state.total + state.section + (state.pending ?? 0n)
}

/**
 * Walks the integer tier grammar (hundred/thousand/million/billion/trillion,
 * with the "and" joiner bridging a closed hundred-section to a trailing
 * coefficient) starting from an already-read first coefficient. Returns the
 * final value plus the last confirmed token index/end offset — mirrors
 * ko/numbers.ts's confirmedEnd bookkeeping: a dangling coefficient with
 * nothing recognized after it is still confirmed (the number stands on its
 * own, e.g. "forty five"), but a token that doesn't fit ends the walk
 * without consuming it.
 */
function walkIntegerTiers(
  tokens: Token[],
  state: TierState,
  startIndex: number,
  confirmedEndIn: number,
  confirmedTokenIndexIn: number,
): { value: bigint; confirmedEnd: number; confirmedTokenIndex: number } {
  let confirmedEnd = confirmedEndIn
  let confirmedTokenIndex = confirmedTokenIndexIn
  let pos = startIndex

  while (true) {
    // 1) a small unit (hundred) — requires it not already applied this section.
    const smallWord = wordAt(tokens, pos)
    if (smallWord !== null && Object.hasOwn(SMALL_UNIT, smallWord)) {
      if (state.lastSmallUnit !== null) break
      const coeff = state.pending ?? 1n
      state.section += coeff * SMALL_UNIT[smallWord]
      state.lastSmallUnit = SMALL_UNIT[smallWord]
      state.pending = null
      confirmedEnd = tokens[pos].end
      confirmedTokenIndex = pos
      pos = skipSeparator(tokens, pos + 1)
      continue
    }
    // 2) a big unit (thousand/million/...) — must strictly decrease from the
    // last one seen (no "thousand million"), same property as Korean's rule.
    // This is a coefficient*100+section multiply, not a "hundred" check, so
    // it applies just as well when `section` came from a "hundred" tier:
    // "fifteen hundred thousand" (15*100=1500, then *1000) = 1,500,000 falls
    // out of this SAME general rule, not a special case — an unusual but
    // mathematically consistent extrapolation of "fifteen hundred"=1500.
    if (smallWord !== null && Object.hasOwn(BIG_UNIT, smallWord)) {
      const mult = BIG_UNIT[smallWord]
      if (state.lastBigUnit !== null && mult >= state.lastBigUnit) break
      state.section += state.pending ?? 0n
      if (state.section === 0n) state.section = 1n // implied-1, bare "thousand" = 1000
      state.total += state.section * mult
      state.section = 0n
      state.pending = null
      state.lastBigUnit = mult
      state.lastSmallUnit = null
      confirmedEnd = tokens[pos].end
      confirmedTokenIndex = pos
      pos = skipSeparator(tokens, pos + 1)
      continue
    }
    // 3) "and" joiner — only bridges FROM anything already accumulated
    // (a closed hundred-section OR a closed thousand/million/... tier) TO a
    // following coefficient; a bare "and" with nothing before or nothing
    // valid after does not get consumed. ("one thousand and five" closes
    // its tier into `total`, resetting `section` to 0 — checking only
    // `section !== 0n` would miss that case and wrongly stop at 1000.)
    if (
      smallWord !== null &&
      JOINERS.has(smallWord) &&
      state.pending === null &&
      (state.section !== 0n || state.total !== 0n)
    ) {
      const afterJoiner = skipSeparator(tokens, pos + 1)
      const coeff = readCoefficient(tokens, afterJoiner)
      if (coeff === null) break
      state.pending = coeff.value
      confirmedEnd = tokens[coeff.endIndex].end
      confirmedTokenIndex = coeff.endIndex
      pos = skipSeparator(tokens, coeff.endIndex + 1)
      continue
    }
    // 4) a coefficient (only when nothing is already pending).
    if (state.pending === null) {
      const coeff = readCoefficient(tokens, pos)
      if (coeff !== null) {
        state.pending = coeff.value
        confirmedEnd = tokens[coeff.endIndex].end
        confirmedTokenIndex = coeff.endIndex
        pos = skipSeparator(tokens, coeff.endIndex + 1)
        continue
      }
    }
    break
  }

  return { value: finalizeTierValue(state), confirmedEnd, confirmedTokenIndex }
}

// --- entry points ------------------------------------------------------------

function readDigitsLed(tokens: Token[], i: number): EnNumberHit | null {
  const firstTok = tokens[i]
  const parsed = parseDigitsToken(firstTok)
  if (parsed === null) return null

  // Glued magnitude suffix — "1.2k", "45k", "3M" — no space between the
  // digits token and the suffix letter. Terminal: nothing continues after it.
  const suffixTok = tokens[i + 1]
  if (suffixTok?.kind === 'latin' && suffixTok.start === firstTok.end) {
    const suffixWord = suffixTok.text.toLowerCase()
    if (Object.hasOwn(DIGIT_SUFFIX_MAGNITUDE, suffixWord)) {
      const { value, scale } = normalize(parsed.value * DIGIT_SUFFIX_MAGNITUDE[suffixWord], parsed.scale)
      return { value, scale, tokenCount: 2, start: firstTok.start, end: suffixTok.end }
    }
  }

  if (parsed.scale > 0) {
    // A decimal digits token ("48.2") may still be followed by exactly one
    // big-unit multiplier ("48.2 million") — see applyOptionalTrailingBigUnit.
    const withUnit = applyOptionalTrailingBigUnit(tokens, i, parsed.value, parsed.scale)
    const { value, scale } = normalize(withUnit.value, withUnit.scale)
    return {
      value,
      scale,
      tokenCount: withUnit.endIndex - i + 1,
      start: firstTok.start,
      end: tokens[withUnit.endIndex].end,
    }
  }

  // Integer digits token — may continue into the general tier grammar
  // ("5 thousand"), or stand alone.
  const state = initTierState()
  state.pending = parsed.value
  const startPos = skipSeparator(tokens, i + 1)
  const result = walkIntegerTiers(tokens, state, startPos, firstTok.end, i)
  return {
    value: result.value,
    scale: 0,
    tokenCount: result.confirmedTokenIndex - i + 1,
    start: firstTok.start,
    end: result.confirmedEnd,
  }
}

function readWordLed(tokens: Token[], i: number): EnNumberHit | null {
  const article = readArticleCoefficient(tokens, i)
  if (article) return article

  const first = readCoefficient(tokens, i)
  if (first === null) {
    // No leading coefficient word — still a valid start when tokens[i] is
    // ITSELF a bare SMALL_UNIT word ("hundred"): the shared tier walk's
    // implied-1 rule (coefficient defaults to 1 when absent, `state.pending
    // ?? 1n`) picks it up the same way it already handles a bare "만"/"억"
    // in ko/numbers.ts — "hundred thousand" (bare "hundred" starting the
    // walk, "thousand" then closing the tier on the section it produced) =
    // 100,000. Deliberately does NOT extend to a bare BIG_UNIT word alone
    // ("million"/"billion"/"trillion"/"thousand" with nothing before or
    // after it): unlike "hundred", these words appear constantly as
    // ordinary vocabulary with no numeric intent ("thanks a million", "one
    // in a million", "million-dollar question") — review round 1 caught
    // this the hard way: allowing it here made bare "million" alone parse
    // as a confident 1,000,000, which let a scanning caller slip straight
    // past the (correctly) suppressed "a million" in "half a million" and
    // land on the bare "million" right after it, resolving to the same
    // wrong value the suppression exists to prevent. "hundred" alone is
    // comparatively safe: it is rarely ordinary vocabulary on its own.
    const word = wordAt(tokens, i)
    if (word === null || !Object.hasOwn(SMALL_UNIT, word)) return null
    const state = initTierState()
    const result = walkIntegerTiers(tokens, state, i, tokens[i].start, i)
    return {
      value: result.value,
      scale: 0,
      tokenCount: result.confirmedTokenIndex - i + 1,
      start: tokens[i].start,
      end: result.confirmedEnd,
    }
  }

  // Decimal immediately after the leading coefficient ("ten point five") —
  // terminal aside from one optional trailing big unit, same as the
  // digits-led decimal path.
  const afterFirst = skipSeparator(tokens, first.endIndex + 1)
  const decimalWord = wordAt(tokens, afterFirst)
  if (decimalWord !== null && DECIMAL_MARKERS.has(decimalWord)) {
    const tailStart = skipSeparator(tokens, afterFirst + 1)
    const tail = readDecimalTail(tokens, tailStart)
    if (tail === null) return null // ambiguous/unknown decimal digit — reject the whole read, never truncate
    const combinedValue = first.value * 10n ** BigInt(tail.scale) + tail.value
    const withUnit = applyOptionalTrailingBigUnit(tokens, tail.endIndex, combinedValue, tail.scale)
    const { value, scale } = normalize(withUnit.value, withUnit.scale)
    return {
      value,
      scale,
      tokenCount: withUnit.endIndex - i + 1,
      start: tokens[i].start,
      end: tokens[withUnit.endIndex].end,
    }
  }

  const state = initTierState()
  state.pending = first.value
  const startPos = skipSeparator(tokens, first.endIndex + 1)
  const result = walkIntegerTiers(tokens, state, startPos, tokens[first.endIndex].end, first.endIndex)
  return {
    value: result.value,
    scale: 0,
    tokenCount: result.confirmedTokenIndex - i + 1,
    start: tokens[i].start,
    end: result.confirmedEnd,
  }
}

/** Token index immediately before `i`, crossing at most one space token OR
 * one hyphen-punct token — the backward mirror of `skipSeparator`, needed
 * only for the "half" adjacency guard below (nothing else in this file
 * looks backward). Must cross the SAME separator set `skipSeparator` does
 * going forward ("twenty-five" is one coefficient via a forward hyphen
 * cross), or a hyphenated "half-a-million" evades the guard that catches
 * spaced "half a million" (review round 2). Out-of-range indices are
 * returned as-is; `wordAt`/`wordBefore` resolve them to null. */
function indexBefore(tokens: Token[], i: number): number {
  const prev = tokens[i - 1]
  if (prev?.kind === 'space' || (prev?.kind === 'punct' && prev.text === '-')) return i - 2
  return i - 1
}

function wordBefore(tokens: Token[], i: number): string | null {
  return wordAt(tokens, indexBefore(tokens, i))
}

/** True when "and a half" immediately follows the last token of a
 * completed read (crossing up to one space between each word). */
function isAndAHalfAfter(tokens: Token[], lastTokenIndex: number): boolean {
  let idx = skipSeparator(tokens, lastTokenIndex + 1)
  if (wordAt(tokens, idx) !== 'and') return false
  idx = skipSeparator(tokens, idx + 1)
  if (wordAt(tokens, idx) !== 'a') return false
  idx = skipSeparator(tokens, idx + 1)
  return wordAt(tokens, idx) === 'half'
}

/** True when `i` is a "half"-modified read's OWN start ("half" directly
 * before it), OR is the RE-ENTRY position a scanner reaches after that read
 * gets suppressed here. The re-entry exists because "half a hundred"/"half
 * two hundred" don't only have ONE way to start reading a number at "a
 * hundred"/"two hundred" — once THAT hit is suppressed, a token-by-token
 * scanner tries the next index and lands directly on bare "hundred" via
 * readWordLed's own no-leading-coefficient SMALL_UNIT fallback (see there),
 * which has no idea "half"/"a"/"two" ever preceded it — it just sees
 * "hundred" starting fresh and returns 100. (This is the SAME class of gap
 * review round 1 already found and fixed for bare BIG_UNIT words — that
 * one was closed by narrowing the fallback itself; a bare SMALL_UNIT
 * fallback is still legitimate on its own, e.g. queried after "three
 * hundred thousand"'s "three", so it can't be narrowed the same way. The
 * fix here is on the "half" side instead: also treat `i` as half-modified
 * when the word directly before it is "a" or a coefficient (ONES/TENS)
 * word, AND the word before THAT is "half".) See docs/SOLVED.md, review
 * round 2. */
function isHalfModified(tokens: Token[], i: number): boolean {
  const idx1 = indexBefore(tokens, i)
  const word1 = wordAt(tokens, idx1)
  if (word1 === 'half') return true
  if (word1 === null) return false
  if (word1 !== 'a' && !Object.hasOwn(ONES, word1) && !Object.hasOwn(TENS, word1)) return false
  return wordBefore(tokens, idx1) === 'half'
}

/** This reader does not implement fractional "half" arithmetic ("half a
 * million" = 500,000; "one and a half" = 1.5) — that's real scope, not a
 * gap to silently ignore. Without this guard, a caller scanning
 * token-by-token would skip straight past "half" (not itself a number
 * word) and land on the FOLLOWING complete-looking read — "a million" in
 * "half a million", "one" in "one and a half" — and walk away with a
 * plausible but exactly-2x-wrong value with no signal anything was
 * dropped. Per this file's "never a confidently wrong number" rule, both
 * shapes are suppressed to a safe miss (null) instead: a hit is discarded
 * when `i` is half-modified (see isHalfModified, which also covers the
 * SMALL_UNIT re-entry residual) OR "and a half" immediately follows its
 * end. Real half-arithmetic support, if the corpus demands it, is future
 * scope (see task review rounds 1-2). */
function suppressIfHalfAdjacent(tokens: Token[], i: number, hit: EnNumberHit): boolean {
  if (isHalfModified(tokens, i)) return true
  const lastTokenIndex = i + hit.tokenCount - 1
  return isAndAHalfAfter(tokens, lastTokenIndex)
}

/** Reads an English cardinal number starting at tokens[i]. Returns null
 * when tokens[i] does not START a number — including when tokens[i] is the
 * bare article "a" not immediately followed by a magnitude word (never a
 * confidently wrong number; see GRAND_VALUE's doc comment), and when the
 * read would otherwise land on a "half"-modified phrase this reader
 * doesn't compute (see suppressIfHalfAdjacent). */
export function readEnglishNumber(tokens: Token[], i: number): EnNumberHit | null {
  const tok = tokens[i]
  if (!tok) return null
  let hit: EnNumberHit | null = null
  if (tok.kind === 'digits') hit = readDigitsLed(tokens, i)
  else if (tok.kind === 'latin') hit = readWordLed(tokens, i)
  if (hit === null) return null
  if (suppressIfHalfAdjacent(tokens, i, hit)) return null
  return hit
}
