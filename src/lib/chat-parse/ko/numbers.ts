import type { Token } from '../engine/tokens'
import { isHangulCodePoint } from '../engine/tokenizer'
import { NUMBER_DECOYS } from './lexicon-decoys'

/**
 * Korean number reader — parsing core ported from kor-to-number.js
 * (MIT, https://github.com/dragonteros/kor-to-number.js), reworked to walk
 * `Token[]` instead of raw strings. See NOTICE.
 *
 * Handles: sino ("삼만오천"), leading-일 omission ("만오천"), mixed
 * arabic+hangul ("5만 5천", "1만2천"), native ("아흔아홉").
 */

// "사장" (boss) reads as digit-4 + counter-word "장". Nothing structural
// separates it from "이인분" (= 2인분, genuinely a number + counter) or
// "오원" — both are a bare digit syllable followed by a counter/currency
// word — so ONLY a lexicon can tell them apart. Do NOT try to fix it by
// narrowing the accepted counter/currency set — that is the failure pattern
// logged three times in docs/SOLVED.md. Task 3's mined lexicon-decoys.ts
// carries this entry (and the whole class: 이장, 사병, 일병, 오분, ...) — see
// that file for provenance.
/** Decoy lexicon: non-numeric hangul words that share a prefix with a
 * numeral reading. Mined into lexicon-decoys.ts (Task 3); re-exported here
 * as an array (NUMBER_DECOYS itself is a Set) so the array-scan loop below
 * and numbers.test.ts's `.includes` keep working unchanged. */
export const DECOY_WORDS: readonly string[] = [...NUMBER_DECOYS]

/** Currency words the repo already recognizes — mirrors
 * src/lib/chat-parse/amount.ts's suffix regex (원|엔|달러|유로|krw|jpy|usd|eur|yen)
 * plus 짜리/어치 combinations. krw/jpy/usd/eur/yen are latin-script and can
 * never actually appear inside a hangul-kind Token's text (the tokenizer
 * splits latin runs into their own token), so they're listed here purely
 * for fidelity with amount.ts — Token-kind checks already accept a
 * following latin token unconditionally (see readArabicLed). */
const CURRENCY_WORDS: readonly string[] = [
  '원',
  '엔',
  '달러',
  '유로',
  'krw',
  'jpy',
  'usd',
  'eur',
  'yen',
  '원짜리',
  '원어치',
  '엔짜리',
  '엔어치',
  '달러짜리',
  '달러어치',
  '유로짜리',
  '유로어치',
  '짜리',
  '어치',
  // Quantity markers of the SAME class as 짜리/어치 above (which are not
  // currencies either): a number followed by one of these is a quantity, so
  // they rescue a decoy-colliding reading exactly the way a currency word
  // does — "오만 씩 걷자" is 50000 each, "오만원쯤" is about 50000, neither is
  // 오만 (arrogance). They were the one gap between this lexicon and the
  // older reader's CLOSED_END_SUFFIX (assistant/hangul-number.ts), which
  // parsers/amount.ts folds into an amount's span; without them a hangul-led
  // amount marked ONLY by one of these read as null.
  '씩',
  '쯤',
  '정도',
  '가량',
]

/** Curated common counter words. Deliberately excludes bare "일" (day) —
 * it's also the numeral 1 (DIGIT_MAP), so a dangling digit immediately
 * followed by "일" is genuinely ambiguous; the whole-read-reject default
 * (see parseSino) handles that case instead of guessing either way. "대" and
 * "시간" were added in the Task 3 review-fix round: "대" is the counter for
 * vehicles/machines/appliances (차 3대, 컴퓨터 2대), needed so "1억대"/"5억대"
 * rescue via the same currency-or-counter mechanism as any other unit+counter
 * compound (see isUnitExtensionRejected); "시간" is the duration-hours
 * counter (10시간, distinct from bare "시" = clock-time o'clock), needed so
 * "1만시간" rescues the same way. Neither needs special-casing beyond being
 * a real Korean counter. */
const COUNTER_WORDS: readonly string[] = [
  '명',
  '개',
  '번',
  '살',
  '시',
  '분',
  '초',
  '퍼센트',
  '%',
  '인분',
  '병',
  '잔',
  '마리',
  '장',
  '대',
  '시간',
]

/** Recognized currency/counter continuations that rescue a numeral reading
 * which would otherwise collide with a decoy word or a dangling trailing
 * digit ("오만" + "원"/"명"/"짜리" is still the number 50000). This is the
 * other half of the one-edit swap surface for Task 3, next to DECOY_WORDS. */
export const NUMBER_CONTINUATIONS: readonly string[] = [...CURRENCY_WORDS, ...COUNTER_WORDS]

// There used to be an enumerated JOSA_CONTINUATIONS list here (이면/이다/이고/
// ...) for parseSino's trailing-dangling-digit rollback. It was deleted: it
// only ever covered the endings someone remembered to type in, so any other
// 이-initial josa (이랑/이나/이에요/이었어/이죠/...) silently fell through to
// the reject-default and returned null for numbers that were actually fine
// ("삼만오천이랑" -> null instead of 35000). The replacement doesn't
// enumerate endings at all — see the "이" special case in parseSino below.

export interface KoNumberHit {
  value: bigint
  /** how many tokens consumed */
  tokenCount: number
  start: number
  end: number
}

const DIGIT_MAP: Record<string, bigint> = {
  일: 1n,
  이: 2n,
  삼: 3n,
  사: 4n,
  오: 5n,
  육: 6n,
  칠: 7n,
  팔: 8n,
  구: 9n,
}

const SMALL_UNIT: Record<string, bigint> = {
  십: 10n,
  백: 100n,
  천: 1000n,
}

const BIG_UNIT: Record<string, bigint> = {
  만: 10_000n,
  억: 100_000_000n,
  조: 1_000_000_000_000n,
}

const NATIVE_TENS: ReadonlyArray<readonly [string, bigint]> = [
  ['아흔', 90n],
  ['여든', 80n],
  ['일흔', 70n],
  ['예순', 60n],
  ['쉰', 50n],
  ['마흔', 40n],
  ['서른', 30n],
  ['스물', 20n],
  ['열', 10n],
]

const NATIVE_ONES: ReadonlyArray<readonly [string, bigint]> = [
  ['아홉', 9n],
  ['여덟', 8n],
  ['일곱', 7n],
  ['여섯', 6n],
  ['다섯', 5n],
  ['넷', 4n],
  ['셋', 3n],
  ['둘', 2n],
  ['하나', 1n],
]

const MAX_SIGNIFICANT_DIGITS = 15

interface ParsedRun {
  value: bigint
  /** length in characters consumed from the start of the input string */
  length: number
  /** true when a trailing digit syllable that had no following unit was
   * rolled back because it was "이" — the one numeral syllable homophonous
   * with the copula/josa stem ("오만" + "이면"/"이랑"/"이나"/... — "이" reads
   * as digit 2 but is actually grammar, whatever specific ending follows
   * it). A rolled-back prefix is treated as a confirmed number use
   * downstream: see isRejectedByDecoy. (A dangling digit that is NOT "이"
   * and isn't confirmed by a currency/counter continuation rejects the
   * whole read instead — see the guard below.) */
  rolledBack: boolean
}

/** Korean case/auxiliary particles (조사).
 *
 * Enumerating these is safe where enumerating verb/copula ENDINGS was not
 * (see docs/SOLVED.md [2026-08-13] round 3): 조사 is a genuinely closed
 * grammatical class — a fixed, finite inventory taught as a complete list —
 * whereas endings are productive and open. This list is what tells a real
 * boundary after a currency/counter word ("원" + "을") apart from more of a
 * longer, unrelated word ("장" + "님이"). */
const PARTICLES: readonly string[] = [
  '을',
  '를',
  '은',
  '는',
  '이',
  '가',
  '도',
  '만',
  '씩',
  '의',
  '에',
  '에서',
  '에게',
  '에게서',
  '한테',
  '한테서',
  '께',
  '께서',
  '으로',
  '로',
  '으로서',
  '로서',
  '으로써',
  '로써',
  '부터',
  '까지',
  '하고',
  '랑',
  '이랑',
  '과',
  '와',
  '뿐',
  '밖에',
  '보다',
  '처럼',
  '만큼',
  '조차',
  '마저',
  '마다',
  '이나',
  '나',
  '라도',
  '이라도',
]

/** True when `word` matches the start of `remaining` AND is followed by a
 * real boundary rather than more of a longer, unrelated word.
 *
 * A boundary is: end of the substring, a non-hangul character (space,
 * punctuation, latin, digit), or a case/auxiliary particle. Plain
 * `startsWith` fires mid-word ("사장님이" is not digit-4 "사" + "장님이":
 * 장 matches counter-word "장", but "님이" follows it, and 님 is not a
 * particle — "일번지" similarly is not digit-1 "일" + "번지"). Accepting
 * ONLY end-of-string and a leading 이 (the previous rule) was the mirror
 * mistake: every other particle then truncated or nulled a correct read
 * ("십이원을" -> 10, "오만원을" -> null). */
function matchesAtBoundary(remaining: string, word: string): boolean {
  if (!remaining.startsWith(word)) return false
  const after = remaining.slice(word.length)
  if (after === '') return true
  const firstCp = after.codePointAt(0)
  if (firstCp === undefined || !isHangulCodePoint(firstCp)) return true
  return PARTICLES.some((particle) => after.startsWith(particle))
}

function isAcceptedContinuation(remaining: string): boolean {
  return NUMBER_CONTINUATIONS.some((word) => matchesAtBoundary(remaining, word))
}

/** Currency-only continuation check — used where a COUNTER word must NOT
 * rescue the read: readArabicLed's un-scaled-segment fold ("3만 2명" stays
 * 30000, since "2명" is a headcount, not more money; "3만 2000엔" folds to
 * 32000, since 엔 is a currency); isRejectedByDecoy's across-space rescue
 * (a counter in a SEPARATE, space-separated token never rescues — "오만 명"
 * stays null even though attached "오만명" now would, see isRejectedByDecoy);
 * and isRejectedByDecoy's rescue generally, whenever the matched decoy's
 * prefix does NOT end at a unit boundary (endsAtUnitBoundary) — e.g.
 * "천사장" stays null because "천사"'s prefix ends at the dangling digit
 * "사", not because counters categorically never rescue an exact match
 * (they do, for a unit-ending prefix — see isRejectedByDecoy). */
function isCurrencyContinuation(remaining: string): boolean {
  return CURRENCY_WORDS.some((word) => matchesAtBoundary(remaining, word))
}

/** True for 만/억/조 — the tiers a trailing bare 이 is ruled a josa after.
 * `undefined` (start of text) is not a unit, so bare "이" keeps its digit. */
function isBigUnitChar(ch: string | undefined): boolean {
  return ch !== undefined && ch in BIG_UNIT
}

// --- shared tier grammar --------------------------------------------------
//
// ONE grammar for the pending-section/tier arithmetic every numeral reading
// in this file uses, whether the coefficient in front of a unit syllable
// comes from a sino digit syllable (1-9) or an arabic digits token (any
// value — readArabicLed feeds a whole "300" in as a single coefficient the
// same way a sino "삼" feeds in a 3). Before this, readArabicLed had its own
// ad-hoc arithmetic (multiply the digit group by a whole parsed sub-number)
// that disagreed with this engine on every multi-tier compound
// ("3천5백만원" -> 5,003,000 instead of 35,000,000) — a second arithmetic
// path is a second chance to be wrong; see docs/SOLVED.md round 8.

type NumAtom = { kind: 'digit'; value: bigint } | { kind: 'small'; mult: bigint } | { kind: 'big'; mult: bigint }

interface TierState {
  total: bigint
  section: bigint
  currentDigit: bigint
  hasDigit: boolean
  lastSmallUnit: bigint | null
  lastBigUnit: bigint | null
}

function initTierState(): TierState {
  return { total: 0n, section: 0n, currentDigit: 0n, hasDigit: false, lastSmallUnit: null, lastBigUnit: null }
}

/** Feeds one atom into the tier state machine. Returns false (state
 * UNCHANGED) when the atom doesn't validly continue the read — two digit
 * coefficients in a row with no unit between them, or a unit that doesn't
 * strictly decrease from the last one at its tier. */
function applyAtom(state: TierState, atom: NumAtom): boolean {
  if (atom.kind === 'digit') {
    if (state.hasDigit) return false
    state.currentDigit = atom.value
    state.hasDigit = true
    return true
  }
  if (atom.kind === 'small') {
    if (state.lastSmallUnit !== null && atom.mult >= state.lastSmallUnit) return false
    const digit = state.hasDigit ? state.currentDigit : 1n // e.g. bare "십" = 10
    state.section += digit * atom.mult
    state.lastSmallUnit = atom.mult
    state.currentDigit = 0n
    state.hasDigit = false
    return true
  }
  // atom.kind === 'big'
  if (state.lastBigUnit !== null && atom.mult >= state.lastBigUnit) return false
  state.section += state.currentDigit
  if (state.section === 0n) state.section = 1n // leading-일 omission, e.g. bare "만" = 10000
  state.total += state.section * atom.mult
  state.section = 0n
  state.currentDigit = 0n
  state.hasDigit = false
  state.lastBigUnit = atom.mult
  state.lastSmallUnit = null // small-unit ordering resets per big-unit tier
  return true
}

/** The value if the pending coefficient (state.hasDigit) is kept, not
 * rolled back — section and the dangling digit folded into total. */
function finalizeTierValue(state: TierState): bigint {
  return state.total + state.section + state.currentDigit
}

function charToAtom(ch: string | undefined): NumAtom | null {
  if (ch === undefined) return null
  if (ch in DIGIT_MAP) return { kind: 'digit', value: DIGIT_MAP[ch] }
  if (ch in SMALL_UNIT) return { kind: 'small', mult: SMALL_UNIT[ch] }
  if (ch in BIG_UNIT) return { kind: 'big', mult: BIG_UNIT[ch] }
  return null
}

function isNumeralChar(ch: string | undefined): boolean {
  return ch !== undefined && charToAtom(ch) !== null
}

/** Parses a Sino-Korean (한자어) number run from the start of `text`.
 * Returns null when `text` does not start with a numeral syllable. */
function parseSino(text: string): ParsedRun | null {
  const chars = Array.from(text)
  const state = initTierState()
  let i = 0
  let consumed = false

  while (i < chars.length) {
    const atom = charToAtom(chars[i])
    if (!atom || !applyAtom(state, atom)) break
    consumed = true
    i++
  }

  if (!consumed) return null

  // A trailing digit syllable with no unit after it is ambiguous: it might
  // be a real digit (confirmed by a currency/counter word right after it —
  // "삼백육십오원"/"삼십오명" keep their trailing digit), or — specifically
  // when that digit is "이" — it might be the copula/josa stem instead
  // (오만 + 이 in "오만이면"/"오만이랑"/"오만이나" reads 이 as digit 2, but
  // it's actually grammar; rolled back regardless of which specific ending
  // follows it, since enumerating endings just reproduces this bug one
  // level down — see docs/SOLVED.md [2026-08-13]). Any OTHER dangling digit
  // with an unrecognized suffix is genuinely unknown: per the "never emit a
  // confidently wrong number" rule, that rejects the WHOLE read rather than
  // silently truncating ("십오큐큐" must not become 10).
  //
  // At the END of the token the same 이 is ruled the subject particle when
  // the number it trails ends at a 만/억/조-tier unit ("오만이 넘었어" is
  // 50000, "만이" is 10000). Controller ruling: someone who means 10002
  // writes 10002 or 만이천, essentially never 일만이, so this is the reading
  // that is wrong less often — and when it IS wrong the user sees a smaller
  // number on the always-shown confirm card, never a silent save. The rule
  // is deliberately scoped to big-unit-tier finals: a small-unit final keeps
  // 이 as its ones digit ("십이" 12, "백이" 102, bare "이" 2).
  let rolledBack = false
  if (state.hasDigit && i < chars.length) {
    const afterDigit = chars.slice(i).join('')
    if (!isAcceptedContinuation(afterDigit)) {
      if (chars[i - 1] !== '이') return null
      i -= 1
      state.currentDigit = 0n
      state.hasDigit = false
      rolledBack = true
    }
  } else if (state.hasDigit && chars[i - 1] === '이' && isBigUnitChar(chars[i - 2])) {
    i -= 1
    state.currentDigit = 0n
    state.hasDigit = false
    rolledBack = true
  }

  return { value: finalizeTierValue(state), length: i, rolledBack }
}

/** Parses a native Korean (고유어) number run — valid for 1..99. */
function parseNative(text: string): ParsedRun | null {
  let value = 0n
  let length = 0
  let matchedTens = false

  for (const [word, tensValue] of NATIVE_TENS) {
    if (text.startsWith(word)) {
      value += tensValue
      length += word.length
      matchedTens = true
      break
    }
  }

  const rest = text.slice(length)
  for (const [word, onesValue] of NATIVE_ONES) {
    if (rest.startsWith(word)) {
      value += onesValue
      length += word.length
      return { value, length, rolledBack: false }
    }
  }

  if (matchedTens) return { value, length, rolledBack: false }
  return null
}

/** True when the character right before `prefixLength` in `text` is NOT
 * safe ground for a counter to rescue a decoy match on. Two cases are
 * treated as "not safe" (both fall back to currency-only rescue):
 *  - a bare sino digit syllable (일-구, DIGIT_MAP) — "사"+장 in "사장",
 *    "이"+장 in "이장". parseSino's OWN trailing-digit-confirm logic
 *    already decided this digit stays (that's precisely why prefixLength
 *    stops short of the counter syllable instead of consuming it), so
 *    rescuing the decoy check with the SAME counter here would be
 *    circular: the counter that confirmed the digit as "not a josa" is not
 *    evidence the whole word is a number rather than a name/occupation.
 *    This is what protects Task 3's mandated
 *    사장/이장/사병/일병/오분/구분/칠장 carry-over class.
 *  - "조" (BIG_UNIT, 10^12) specifically — "구"+조 in "구조", "일"+조 in
 *    "일조". 조 is excluded from the mining script's automatic decoy-prefix
 *    filter for the same underlying reason (see mine-korean-lexicons.mjs:
 *    "too noisy a prefix to mine automatically") — a trillion-scale amount
 *    is essentially never the intended reading of a common word like 구조
 *    (rescue/structure) or 일조 (a sunrise/harmony-adjacent word family) in
 *    this app's chat text, so a counter right after it is exactly as weak
 *    evidence as one right after a dangling digit, not the strong evidence
 *    it is after 만/억/십/백/천 (천만개/억대/십분 — see docs/SOLVED.md
 *    round 7). Every OTHER unit (만/억/십/백/천) still counts as safe
 *    ground — "천"+명 in "천명", "억"+대 in "억대", "십"+분 in "십분" all
 *    rescue via counter, unambiguous ("1000 of a counted thing"/"in the
 *    hundred-millions"/"10 minutes"). See docs/SOLVED.md round 9.
 */
function endsAtUnitBoundary(text: string, prefixLength: number): boolean {
  const ch = text[prefixLength - 1]
  return !(ch in DIGIT_MAP) && ch !== '조'
}

/**
 * True when `text` read as a number should be REJECTED because the numeral
 * prefix of length `prefixLength` collides with the decoy lexicon. Two
 * shapes — an exact-length decoy match ("오만" = arrogance, "천사" = angel)
 * and a decoy word LONGER than the prefix ("만" extends into listed "만원",
 * "천" extends into listed "천명") — both rescued the SAME way: a CURRENCY
 * continuation right after the prefix rescues unconditionally ("오만원"/
 * "천사원"/"만원" all survive, genuinely ambiguous, currency wins — see
 * docs/SOLVED.md round 3), and a COUNTER continuation rescues too, but
 * ONLY when the prefix ends at a unit boundary (endsAtUnitBoundary above)
 * — so "만원"/"천명"/"억대"/"십분" all counter-rescue (unit-ending prefix),
 * "천만개"/"천만명" counter-rescue as an EXACT match the same way, but
 * "사장"/"이장"/"사병" and "구조"/"구조대" do not (digit-ending or
 * 조-ending prefix — endsAtUnitBoundary excludes both). Exact-match
 * rescue used to be currency-only, unconditionally, which is why this
 * docblock used to say a counter "never" rescues an exact match — that
 * was tightened once bare "천만개"/"천만명" (exact matches, not
 * extensions) turned up needing the same rescue the longer-than-prefix
 * branch already had; see docs/SOLVED.md round 9. The longer-than-prefix
 * branch used to be an unconditional reject with no rescue at all, which
 * is what let a real mined dictionary word like "만원" (滿員 "sold out") or
 * "천명" (天命 "destiny") silently kill common KRW/counting phrase shapes
 * once Task 3 swapped in the full mined lexicon — see docs/SOLVED.md
 * round 7.
 * `skipExactMatch` bypasses the exact-prefix case — used when parseSino
 * already rolled back a trailing digit off this exact prefix, which is
 * itself proof the remainder is a josa/particle, not a different word.
 * `acrossSpace` is the next word's text when the prefix ends at the end of
 * its token — "오만 원" is "오만원" with a space, so a currency word there
 * rescues the exact match exactly the same way an attached one does. A
 * COUNTER across the space does NOT rescue ("오만 명" stays null even though
 * attached "오만명" now would) — a space is a real word boundary, and
 * unlike an attached counter syllable (unambiguously glued to the number),
 * a counter word in a NEXT, separate token is exactly as good evidence for
 * "a new sentence about some count" as for "more of this number" — currency
 * across a space stays a strong enough signal either way (established
 * behavior, unchanged), a counter does not.
 *
 * readArabicLed has its OWN, simpler decoy check (isArabicAnchoredExtensionRejected
 * below) — an arabic-digit anchor is unambiguous numeric intent, so an
 * arabic-anchored read never runs THIS check at all (see docs/SOLVED.md
 * round 8's decoy scope ruling).
 */
function isRejectedByDecoy(
  text: string,
  prefixLength: number,
  skipExactMatch = false,
  acrossSpace?: string,
): boolean {
  const allowCounterRescue = endsAtUnitBoundary(text, prefixLength)
  const rescued = (remaining: string): boolean => {
    const check = allowCounterRescue ? isAcceptedContinuation : isCurrencyContinuation
    if (check(remaining)) return true
    return remaining === '' && acrossSpace !== undefined && isCurrencyContinuation(acrossSpace)
  }

  if (!skipExactMatch) {
    const exact = text.slice(0, prefixLength)
    // O(1) membership check — the mined set is large enough (14.6k
    // entries) that this exact-match case is worth not linear-scanning.
    if (NUMBER_DECOYS.has(exact) && !rescued(text.slice(prefixLength))) {
      return true
    }
  }

  for (const word of DECOY_WORDS) {
    if (word.length <= prefixLength) continue // exact case handled above
    if (text.slice(0, word.length) !== word) continue
    if (rescued(text.slice(prefixLength))) continue
    return true
  }
  return false
}

/**
 * readArabicLed's decoy check, for the ONE hangul token (if any) where its
 * unit-run walk stopped with leftover non-numeral text — `prefixLength`
 * chars of `text` were consumed as part of the number, the rest wasn't.
 *
 * Decoy scope ruling (docs/SOLVED.md round 8): an arabic-digit anchor is
 * unambiguous numeric intent, so an EXACT decoy match (the consumed prefix
 * IS, exactly, a decoy word — "천만" in "5천만원"/"5천만을"/bare "5천만") is
 * NEVER rejected for an arabic-anchored read, regardless of what trails it
 * — this function only ever compares against decoy words STRICTLY LONGER
 * than `prefixLength`, so an exact-length match is structurally excluded,
 * not specially cased. Only the EXTENSION case (a decoy word LONGER than
 * the consumed prefix — "만두" in "3만두", "조각" in "3조각") is still
 * checked, rescued unconditionally by a currency OR counter continuation
 * right after the prefix (this call site's prefix always starts at a
 * scale-unit character, so it can never be the "사장"-class digit+counter
 * decoy isRejectedByDecoy has to guard against).
 */
function isArabicAnchoredExtensionRejected(text: string, prefixLength: number): boolean {
  for (const word of DECOY_WORDS) {
    if (word.length <= prefixLength) continue
    if (text.slice(0, word.length) !== word) continue
    if (isAcceptedContinuation(text.slice(prefixLength))) continue
    return true
  }
  return false
}

/** Text of the hangul word one single space token after tokens[i], if any. */
function wordAcrossSpace(tokens: Token[], i: number): string | undefined {
  if (tokens[i + 1]?.kind !== 'space') return undefined
  const word = tokens[i + 2]
  return word?.kind === 'hangul' ? word.text : undefined
}

function readHangulLed(tokens: Token[], i: number): KoNumberHit | null {
  const tok = tokens[i]
  const parsed = parseSino(tok.text) ?? parseNative(tok.text)
  if (!parsed || parsed.length === 0) return null

  // A currency word in the NEXT token counts only when the reading consumed
  // this whole token — otherwise the leftover text, not the next word, is
  // what follows the number.
  const endsAtTokenEnd = parsed.length === Array.from(tok.text).length
  const acrossSpace = endsAtTokenEnd ? wordAcrossSpace(tokens, i) : undefined

  if (isRejectedByDecoy(tok.text, parsed.length, parsed.rolledBack, acrossSpace)) return null

  return {
    value: parsed.value,
    tokenCount: 1,
    start: tok.start,
    end: tok.start + parsed.length,
  }
}

function significantDigits(rawDigits: string): number {
  return (rawDigits.replace(/^0+/, '') || '0').length
}

/** Parses one digits token into a bigint. Null on a decimal point (not an
 * integer Korean number) or when the value exceeds the significant-digit
 * guard — never silently truncated into a wrong value. */
function readDigitsToken(tok: Token): bigint | null {
  if (tok.text.includes('.')) return null
  const raw = tok.text.replace(/,/g, '')
  if (significantDigits(raw) > MAX_SIGNIFICANT_DIGITS) return null
  return BigInt(raw)
}

interface Cursor {
  tokenIndex: number
  /** meaningful only when tokens[tokenIndex] is hangul: how many of its
   * chars have already been consumed as atoms. */
  charIndex: number
}

interface AtomStep {
  atom: NumAtom
  isArabic: boolean
  start: number
  end: number
  tokenIndex: number
  /** true when this atom was the last char of its hangul token (or the
   * whole of a digits token) — nothing else remains in THIS token after
   * it, so a dangling digit here has to look past the token, not within it. */
  endsToken: boolean
  /** true when reaching this atom required crossing a space token — used to
   * reject a NEW digit group that would otherwise silently fold into an
   * in-progress, not-yet-tiered section ("5천 5만" must stop at "5천"=5000,
   * not read as one 5005-scaled-by-만 compound the way contiguous "3천5백만"
   * legitimately does — see the guard in readArabicLed's main loop). */
  crossedSpace: boolean
  next: Cursor
}

/** Finds the next atom from `cursor`, spanning token boundaries — an arabic
 * digits token contributes ONE atom (its whole parsed value as the
 * coefficient), a hangul token contributes one atom per numeral character.
 * A space is only crossed when what follows it can itself start
 * contributing (a digits token, or a hangul token starting with a numeral
 * character) — same grammar as parseSino's own char walk, generalized to
 * cross token boundaries instead of only characters within one string. See
 * docs/SOLVED.md round 8. */
function nextAtom(tokens: Token[], cursor: Cursor): AtomStep | null {
  const cur = tokens[cursor.tokenIndex]

  if (cur?.kind === 'hangul') {
    const chars = Array.from(cur.text)
    if (cursor.charIndex < chars.length) {
      const atom = charToAtom(chars[cursor.charIndex])
      if (!atom) return null
      const start = cur.start + cursor.charIndex
      const nextCharIndex = cursor.charIndex + 1
      return {
        atom,
        isArabic: false,
        start,
        end: start + 1,
        tokenIndex: cursor.tokenIndex,
        endsToken: nextCharIndex === chars.length,
        crossedSpace: false,
        next: { tokenIndex: cursor.tokenIndex, charIndex: nextCharIndex },
      }
    }
  }

  let idx = cur?.kind === 'hangul' ? cursor.tokenIndex + 1 : cursor.tokenIndex
  let crossedSpace = false
  if (tokens[idx]?.kind === 'space') {
    const after = tokens[idx + 1]
    const afterContributes =
      after?.kind === 'digits' || (after?.kind === 'hangul' && isNumeralChar(Array.from(after.text)[0]))
    if (afterContributes) {
      idx++
      crossedSpace = true
    }
  }

  const next = tokens[idx]
  if (next?.kind === 'digits') {
    const value = readDigitsToken(next)
    if (value === null) return null
    return {
      atom: { kind: 'digit', value },
      isArabic: true,
      start: next.start,
      end: next.end,
      tokenIndex: idx,
      endsToken: true,
      crossedSpace,
      next: { tokenIndex: idx + 1, charIndex: 0 },
    }
  }
  if (next?.kind === 'hangul') {
    const chars = Array.from(next.text)
    const atom = charToAtom(chars[0])
    if (!atom) return null
    return {
      atom,
      isArabic: false,
      start: next.start,
      end: next.start + 1,
      tokenIndex: idx,
      endsToken: chars.length === 1,
      crossedSpace,
      next: { tokenIndex: idx, charIndex: 1 },
    }
  }
  return null
}

/**
 * Reads a Korean number led by an arabic digits token — handles pure
 * arabic ("9999"), mixed arabic+hangul including multi-tier compounds
 * ("5천만원" = 5 * 천만, "1억 5천만원"), and cross-token continuation
 * ("5만 5천", "1만2천"). Feeds tokens.digit into the SAME tier grammar
 * parseSino uses for pure hangul (see applyAtom above) — the arabic
 * coefficient stands in for a sino digit syllable at any point, so a
 * CONTIGUOUS ascending-then-descending run like "5천3만" reads as one
 * compound the same way "오천삼만" does as pure hangul (50,030,000 —
 * applyAtom's 'big' branch has no reason to reject it: nothing about
 * 만 following 천 is invalid grammar, it's the standard compound shape).
 * What genuinely gets rejected is a NEW digit group reached by CROSSING A
 * SPACE while an untiered small-unit section is pending and a big unit
 * would consume it — "5천 5만" stops at "5천" (5000), it does not become
 * 50,050,000 (see the crossedSpace guard in the main loop, and
 * docs/SOLVED.md round 8/9 — the guard is unit-aware, not literal-driven:
 * it blocks based on what atom FOLLOWS the crossed digit, not on the
 * mere fact that a space was crossed, so spaced DESCENDING amounts like
 * "5천 5백원" still correctly combine to 5500).
 */
function readArabicLed(tokens: Token[], i: number): KoNumberHit | null {
  const firstTok = tokens[i]
  if (firstTok.kind !== 'digits') return null
  const firstValue = readDigitsToken(firstTok)
  if (firstValue === null) return null

  const state = initTierState()
  applyAtom(state, { kind: 'digit', value: firstValue }) // always succeeds: state starts empty

  let cursor: Cursor = { tokenIndex: i + 1, charIndex: 0 }
  let lastEnd = firstTok.end
  let lastTokenIndex = i
  let lastWasArabic = true
  let lastEndsToken = true
  let anyTierClosed = false

  // The last position confirmed as part of the number — separate from
  // `lastEnd`/`lastTokenIndex` above, since a still-pending trailing digit
  // (state.hasDigit) might get rolled back below before it's ever confirmed.
  let confirmedEnd = firstTok.end
  let confirmedTokenIndex = i

  while (true) {
    const step = nextAtom(tokens, cursor)
    if (!step) break
    // A NEW digit group reached by crossing a space must not silently fold
    // INTO A BIG UNIT on top of an in-progress, not-yet-tiered small
    // section — "5천 5만" stops at "5천" (5000): applying 만 there would
    // scale (5000+5) instead of scaling the 5000 that's already committed
    // to being a small-unit amount. This is the actual property the old
    // per-segment code enforced (each segment's UNIT had to strictly
    // decrease from the last — a following BIG unit after an untiered
    // SMALL section is the one shape that breaks that property when
    // crossing a space). It is NOT "block any space-crossed digit while
    // untiered" — that was written from the single failing literal instead
    // of this property, and wrongly truncated spaced DESCENDING amounts
    // too ("5천 5백원" must still combine to 5500 the same way contiguous
    // "3천5백만원" combines to 3500 before its 만 — applyAtom's small-unit
    // branch already enforces strict decrease there, no extra guard
    // needed). So: only block when the atom immediately AFTER this
    // space-crossed digit is a BIG unit while section is untiered
    // (lastBigUnit still null) — peek one atom ahead to find out. Once a
    // tier HAS closed (lastBigUnit set, section reset to 0) or nothing has
    // accumulated at all, crossing is always fine regardless of what
    // follows ("1만 2천"). See docs/SOLVED.md round 9.
    if (step.atom.kind === 'digit' && step.crossedSpace && state.section !== 0n && state.lastBigUnit === null) {
      const peeked = nextAtom(tokens, step.next)
      if (peeked?.atom.kind === 'big') break
    }
    if (!applyAtom(state, step.atom)) break
    cursor = step.next
    lastEnd = step.end
    lastTokenIndex = step.tokenIndex
    lastWasArabic = step.isArabic
    lastEndsToken = step.endsToken
    if (!state.hasDigit) {
      // a unit atom just closed a tier — a clean, confirmed point.
      anyTierClosed = true
      confirmedEnd = lastEnd
      confirmedTokenIndex = lastTokenIndex
    }
  }

  // Resolve a still-pending trailing digit, if any.
  if (state.hasDigit) {
    if (lastWasArabic) {
      // A bare arabic number with NOTHING scaled yet always stands on its
      // own regardless of what follows (numberToHangulMixed's plain
      // "9999") — no continuation check. Once something HAS been scaled,
      // a further un-scaled arabic group only folds in behind a CURRENCY
      // continuation (a counter must not rescue this — "3만 2명" stays
      // 30000, not 30002; "3만 5000원" folds to 35000).
      if (!anyTierClosed) {
        confirmedEnd = lastEnd
        confirmedTokenIndex = lastTokenIndex
      } else {
        // Only a GLUED word can claim the trailing digits. "3만 2명" is
        // 30000 because 명 is stuck to the 2 — the 2 is the counter's, not
        // the number's. A word after a SPACE cannot make that claim, and
        // treating it as if it could is what made "3만5000 점심" read 30000
        // (silently dropping a digit group) while the spaced "3만 5000 점심"
        // read 35000 via the compound JOIN path — the same number, written
        // two ways, coming out different. (Task 11 corpus.)
        const afterTok = tokens[lastTokenIndex + 1]
        const folds =
          afterTok === undefined ||
          afterTok.kind !== 'hangul' ||
          isCurrencyContinuation(afterTok.text)
        if (folds) {
          confirmedEnd = lastEnd
          confirmedTokenIndex = lastTokenIndex
        } else {
          state.currentDigit = 0n
          state.hasDigit = false
        }
      }
    } else {
      // A dangling SINO digit reached via an arabic anchor — identical
      // rule to parseSino's own trailing-digit handling (re-derived from
      // tokens instead of one string): a currency/counter continuation
      // right after it (in the same token, or across one space if it was
      // the token's last char) confirms it; otherwise only "이" right
      // after a big-unit tier rolls back (the subject-particle reading);
      // anything else at token-end is accepted as-is (nothing to be
      // ambiguous WITH); anything else with more text in the SAME token
      // rejects the whole read.
      const tok = tokens[lastTokenIndex]
      const chars = Array.from(tok.text)
      const digitCharIndex = lastEnd - tok.start - 1
      const danglingChar = chars[digitCharIndex]
      let resolved: 'keep' | 'rollback' | 'reject'
      if (!lastEndsToken) {
        const afterText = chars.slice(digitCharIndex + 1).join('')
        resolved = isAcceptedContinuation(afterText) ? 'keep' : danglingChar === '이' ? 'rollback' : 'reject'
      } else {
        const acrossSpaceText = wordAcrossSpace(tokens, lastTokenIndex)
        if (acrossSpaceText !== undefined && isAcceptedContinuation(acrossSpaceText)) {
          resolved = 'keep'
        } else if (danglingChar === '이' && isBigUnitChar(chars[digitCharIndex - 1])) {
          resolved = 'rollback'
        } else {
          resolved = 'keep'
        }
      }
      if (resolved === 'reject') return null
      if (resolved === 'rollback') {
        state.currentDigit = 0n
        state.hasDigit = false
      } else {
        confirmedEnd = lastEnd
        confirmedTokenIndex = lastTokenIndex
      }
    }
  }

  // Decoy check: only when the walk stopped with leftover non-numeral text
  // in the LAST confirmed hangul token (see isArabicAnchoredExtensionRejected).
  const confirmedTok = tokens[confirmedTokenIndex]
  if (confirmedTok?.kind === 'hangul') {
    const prefixLength = confirmedEnd - confirmedTok.start
    if (prefixLength < Array.from(confirmedTok.text).length) {
      if (isArabicAnchoredExtensionRejected(confirmedTok.text, prefixLength)) return null
    }
  }

  return {
    value: finalizeTierValue(state),
    tokenCount: confirmedTokenIndex - i + 1,
    start: firstTok.start,
    end: confirmedEnd,
  }
}

/** Reads a Korean number starting at tokens[i]. Handles sino, leading-일
 * omission, mixed arabic+hangul, and native forms. Returns null when
 * tokens[i] does not START a number. */
export function readKoreanNumber(tokens: Token[], i: number): KoNumberHit | null {
  const tok = tokens[i]
  if (!tok) return null
  if (tok.kind === 'digits') return readArabicLed(tokens, i)
  if (tok.kind === 'hangul') return readHangulLed(tokens, i)
  return null
}
