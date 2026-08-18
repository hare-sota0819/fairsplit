/**
 * Character-walking Sino-Korean/Arabic numeral reader.
 *
 * Replaces the 만/천 regex chain in `src/lib/chat-parse/amount.ts` (see
 * docs/SOLVED.md 2026-08-09: four rounds of guard/counter-guard ping-pong on
 * that regex). A malformed or out-of-rank unit sequence (the second 천 in
 * 천천히) is rejected by *stopping* the walk rather than by a decoy list —
 * that is what makes 만두/오랜만에/만나자/천천히 fall out for free.
 *
 * Boundary law, reused from `src/lib/chat-parse/people.ts`'s script-agnostic
 * word-char check (`isWordChar`, re-exported here as the single owner so the
 * two copies can't drift): a numeral may not start or end glued to a letter
 * or digit, with a small CLOSED allow-list of trailing Korean suffixes
 * (`CLOSED_END_SUFFIX`) that legitimately follow a bare number — 원 (10000원),
 * 씩 (3만씩 = 30000 each), 정도/쯤 (approximately), 짜리 (a 5천짜리 item), 가량
 * (approximately).
 *
 * This module stays import-free (no dependency on `src/lib/chat-parse/` or
 * anywhere else) so that `chat-parse/amount.ts` importing from here can never
 * become a cycle — see docs/SOLVED.md and the layering note in
 * `.superpowers/sdd/2026-08-10-assistant-brain/task-1-report.md`.
 */

const SMALL_UNIT: Record<string, bigint> = { 십: 10n, 백: 100n, 천: 1000n }
const BIG_UNIT: Record<string, bigint> = { 만: 10000n, 억: 100000000n }
const HANGUL_DIGIT: Record<string, bigint> = {
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

/**
 * The Sino-Korean digit and place-value-unit characters, exported as plain
 * strings (not a regex) so a caller building its OWN char-class regex — e.g.
 * `src/lib/assistant/classify.ts`'s numeral-stripping for the §2.4 fragment
 * check — reads the single source instead of retyping the jamo literally.
 * This module stays import-free either way (no new dependency is added by
 * exporting a plain string).
 */
export const HANGUL_DIGIT_CHARS = Object.keys(HANGUL_DIGIT).join('')
export const HANGUL_UNIT_CHARS =
  Object.keys(SMALL_UNIT).join('') + Object.keys(BIG_UNIT).join('')

/**
 * Script-agnostic "word char" boundary check — the same rule people.ts:30
 * uses for member-name matching (`/[\p{L}\p{N}]/u`, since native `\b`/`\w`
 * don't fire on Hangul). Exported as the single source; people.ts imports
 * this instead of keeping its own copy, so the two can't drift apart.
 * Broader than a Hangul-only check on purpose: it also closes the
 * "abc3만원" hole (a Latin letter glued to the numeral) and the "3만2" hole
 * (a bare digit glued right after a closed reading).
 */
export const WORD_CHAR = /[\p{L}\p{N}]/u

export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch)
}

function isDigitChar(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch)
}

/** Precomposed Hangul syllable block — used to pick the KOREAN half of
 *  `CURRENCY_TOKEN` apart from its latin ISO codes (see
 *  `CLOSED_END_CURRENCY_WORDS`). */
const HANGUL_SYLLABLE = /\p{Script=Hangul}/u

function isHangulSyllable(ch: string | undefined): boolean {
  return ch !== undefined && HANGUL_SYLLABLE.test(ch)
}

/** Sino-Korean place-value unit characters — what makes a Hangul span money, not just digits. */
const PLACE_VALUE_UNIT = /[십백천만억]/

/** Arabic digit or Sino-Korean digit syllable — used to gate a checkpoint back-off. */
const DIGIT_CHAR = /[0-9일이삼사오육칠팔구]/

/**
 * True when `span` contains at least one place-value unit character. A
 * bare Sino-Korean digit with no unit ('사' = 4 alone, as in '치킨 사
 * 먹었어') is not money on its own — this is the gate that keeps a lone
 * digit from shadowing a real amount elsewhere in the sentence.
 */
export function hasPlaceValueUnit(span: string): boolean {
  return PLACE_VALUE_UNIT.test(span)
}

/**
 * Trailing suffixes that may immediately follow a closed numeral reading.
 * A DATA table, not a regex disjunct — a new suffix is a new row, matching
 * the assistant/ directory's "no >1 alternation group" rule (§5.1).
 */
export const CLOSED_END_SUFFIX = [
  '원',
  '씩',
  '정도',
  '쯤',
  '짜리',
  '가량',
] as const

/**
 * If `input` at `end` (after optional whitespace) starts with one of
 * `CLOSED_END_SUFFIX`, returns the index right after that suffix; otherwise
 * returns `end` unchanged. Used to fold a currency/quantity marker into a
 * consumed span so callers that strip `input.slice(start, end)` don't leave
 * a dangling suffix behind.
 */
export function foldClosedSuffix(input: string, end: number): number {
  return foldClosedEnd(input, end).end
}

/**
 * `foldClosedSuffix` plus the ISO code of whatever it folded — `'KRW'` for
 * `원`, `null` for a pure quantity marker (`씩`, `정도`), and the matching
 * code for any other currency word.
 *
 * T3 fix round 1 (I2, controller ruling): a Hangul place-value compound used
 * to be confirmed as MONEY by `원` alone, so `4천엔으로 바꿔줘` — the
 * idiomatic way to say this on a Japan trip — read as no amount at all and
 * fell out as `CONFIRM_MODIFY {field:null}` ("what should I change?"). The
 * rule was never about `원` specifically: a currency word confirms a number
 * BECAUSE it is a currency, whichever one it is. So the confirming set is the
 * property "is a currency word" over `CURRENCY_TOKEN` — the module's own
 * single owning table — not a second hand-written list.
 *
 * The currency pass requires ADJACENCY (no whitespace skip), unlike
 * `CLOSED_END_SUFFIX` above, which keeps the SPACED collision out: `3만
 * 엔지니어에게 줬어` stays ₩30,000 rather than becoming ¥30,000. `3만 원`
 * with a space keeps working because `원` is matched by the whitespace-
 * skipping pass above, exactly as before.
 *
 * What adjacency does NOT do (fix round 2, N2 — the earlier wording here
 * implied otherwise): it does not protect the GLUED collision. `4천엔지니어`
 * folds, because `엔` sits flush against the numeral and this reader has no
 * way to tell a currency word from the first syllable of a longer one. That
 * is a deliberate convergence, not an oversight — `chat-parse`'s tokenizer-
 * based reader resolves the same string the same way, and unlike this module
 * it can afford the josa detacher that would separate them (`ko/josa.ts`;
 * this file is import-free by design so a cycle can never form with
 * `chat-parse/parsers/amount.ts`, which imports FROM here).
 *
 * The same limit is why the SPACED `3만 엔` — which IS money — is still read
 * KRW here. Fix round 2 resolved that where it actually mattered rather than
 * by teaching this scanner Korean morphology: `classify.ts` prefers
 * `parse()`'s currency whenever the strict parser read the same amount AND
 * bound a currency marker of its own, so the card path no longer consults
 * this reader's guess. See `sentenceNamesCurrency` there.
 */
export function foldClosedEnd(
  input: string,
  end: number,
): { end: number; currency: string | null } {
  let afterWs = end
  while (isWhitespace(input[afterWs])) afterWs++
  for (const suffix of CLOSED_END_SUFFIX) {
    if (input.startsWith(suffix, afterWs)) {
      return {
        end: afterWs + suffix.length,
        currency: currencyCodeForToken(suffix),
      }
    }
  }
  for (const token of CLOSED_END_CURRENCY_WORDS) {
    if (input.startsWith(token, end)) {
      return { end: end + token.length, currency: currencyCodeForToken(token) }
    }
  }
  return { end, currency: null }
}

/** Currency signal → ISO code. The single owning table (amount.ts imports this — no duplicate). */
export const CURRENCY_TOKEN: ReadonlyArray<{
  token: string
  code: string
  kind: 'symbol' | 'word'
}> = [
  { token: '¥', code: 'JPY', kind: 'symbol' },
  { token: '￥', code: 'JPY', kind: 'symbol' },
  { token: '엔', code: 'JPY', kind: 'word' },
  { token: 'jpy', code: 'JPY', kind: 'word' },
  { token: 'yen', code: 'JPY', kind: 'word' },
  { token: '$', code: 'USD', kind: 'symbol' },
  { token: '달러', code: 'USD', kind: 'word' },
  { token: 'usd', code: 'USD', kind: 'word' },
  { token: '€', code: 'EUR', kind: 'symbol' },
  { token: '유로', code: 'EUR', kind: 'word' },
  { token: 'eur', code: 'EUR', kind: 'word' },
  { token: '₩', code: 'KRW', kind: 'symbol' },
  { token: '원', code: 'KRW', kind: 'word' },
  { token: 'krw', code: 'KRW', kind: 'word' },
] as const

export function currencyCodeForToken(raw: string): string | null {
  const t = raw.toLowerCase()
  const hit = CURRENCY_TOKEN.find((c) => c.token.toLowerCase() === t)
  return hit ? hit.code : null
}

/**
 * The currency WORDS `foldClosedEnd` accepts as a numeral's confirming marker
 * (T3 fix round 1, I2) — derived from `CURRENCY_TOKEN`, never re-listed, so a
 * new currency is covered the moment it joins that table.
 *
 * Three exclusions, each for its own reason:
 *  - SYMBOLS (`¥`, `$`, `₩`): not word characters, so a numeral already
 *    closes at one without needing to be folded past a boundary.
 *  - `원`: `CLOSED_END_SUFFIX` already matches it one pass earlier, WITH a
 *    whitespace skip this pass deliberately does not have (`3만 원`).
 *  - LATIN codes (`jpy`, `usd`): this is the KOREAN currency-word set, since
 *    the thing being closed is a Hangul place-value compound — nobody writes
 *    `4천jpy`, and letting latin tokens in gave the fold reach into unrelated
 *    text (`45.60usd` read a `60` closed by `usd` at an interior offset).
 *
 * Longest-first so a future token that prefixes another cannot short-match.
 */
const CLOSED_END_CURRENCY_WORDS: readonly string[] = CURRENCY_TOKEN.filter(
  (c) =>
    c.kind === 'word' &&
    !CLOSED_END_SUFFIX.includes(c.token as never) &&
    isHangulSyllable(c.token[0]),
)
  .map((c) => c.token)
  .sort((a, b) => b.length - a.length)

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const SYMBOL_CHARS = CURRENCY_TOKEN.filter((c) => c.kind === 'symbol').map(
  (c) => c.token,
)
const WORD_TOKENS = CURRENCY_TOKEN.filter((c) => c.kind === 'word').map(
  (c) => c.token,
)
// Built from CURRENCY_TOKEN so the alternation can't drift from the lookup
// table — one alternation group, per the assistant/ directory rule.
const SYMBOL_PREFIX_RE = new RegExp(
  `^(${SYMBOL_CHARS.map(escapeRegex).join('|')})\\s*(\\d[\\d,]*(?:\\.\\d+)?)`,
)
const SUFFIX_RE = new RegExp(
  `^(\\d[\\d,]*(?:\\.\\d+)?)\\s*(${WORD_TOKENS.join('|')})(?![A-Za-z0-9])`,
  'i',
)
const BARE_RE = /^\d[\d,]*(?:\.\d+)?/

/** Reads one Sino-Korean/Arabic numeral starting at `from`. Null when there isn't one. */
export function readHangulNumber(
  input: string,
  from: number,
): { value: bigint; end: number } | null {
  if (isWordChar(input[from - 1])) return null // start boundary

  let pos = from
  let total = 0n
  let section = 0n
  let chunkNum = 0n
  let chunkDen = 1n
  let haveChunk = false
  let consumed = false
  let smallRankCeiling: bigint | null = null
  let bigRankCeiling: bigint | null = null
  // True immediately after a BIG_UNIT closes a section, until the next
  // token is consumed — the only state in which a whitespace run may bridge
  // into a following DIGIT (C2 rule b).
  let justClosedSection = false
  // Every position where a SMALL_UNIT or BIG_UNIT legitimately closed a
  // section — a point at which the reading so far is already a complete,
  // valid number. If the walk continues past one of these (chasing a digit
  // that turns out not to lead anywhere, e.g. the "5" in "3만 5명" or the
  // "이" in "3만이야") and then fails the end boundary, we back off to the
  // most recent checkpoint instead of losing the whole reading (C2 fix
  // round 2: bridging into a counter/particle must not void "3만").
  const checkpoints: Array<{ end: number; value: bigint }> = []
  // True when the pending chunk's coefficient came from a Sino-Korean digit
  // syllable (일-구), not an Arabic digit run. A trailing one of these with
  // no unit behind it is exactly the 만일/만사/천사/백일/삼만이/천만에요/
  // 천만다행/억만장자 decoy shape (a common word's own trailing syllable
  // happens to double as a digit) — round 2's C2 fix must not silently add
  // it in as a units-place digit.
  let chunkFromHangulDigit = false

  while (pos < input.length) {
    const ch = input[pos]

    if (isDigitChar(ch)) {
      if (haveChunk) break // a digit run can't follow a pending chunk with no unit between
      let j = pos
      while (isDigitChar(input[j])) j++
      const intEnd = j
      let fracLen = 0
      let hasDot = false
      if (input[j] === '.' && isDigitChar(input[j + 1])) {
        let k = j + 1
        while (isDigitChar(input[k])) k++
        // only keep the fraction if it's immediately consumed by a unit
        if (
          SMALL_UNIT[input[k]] !== undefined ||
          BIG_UNIT[input[k]] !== undefined
        ) {
          hasDot = true
          fracLen = k - (j + 1)
          j = k
        }
      }
      const digits =
        input.slice(pos, intEnd) +
        (hasDot ? input.slice(intEnd + 1, intEnd + 1 + fracLen) : '')
      chunkNum = BigInt(digits)
      chunkDen = hasDot ? 10n ** BigInt(fracLen) : 1n
      haveChunk = true
      chunkFromHangulDigit = false
      consumed = true
      justClosedSection = false
      pos = j
      continue
    }

    if (HANGUL_DIGIT[ch] !== undefined) {
      if (haveChunk) break
      chunkNum = HANGUL_DIGIT[ch]
      chunkDen = 1n
      haveChunk = true
      chunkFromHangulDigit = true
      consumed = true
      justClosedSection = false
      pos += 1
      continue
    }

    if (SMALL_UNIT[ch] !== undefined) {
      const u = SMALL_UNIT[ch]
      if (smallRankCeiling !== null && u >= smallRankCeiling) break
      let added: bigint
      if (haveChunk) {
        const num = chunkNum * u
        if (num % chunkDen !== 0n) break
        added = num / chunkDen
      } else {
        added = u
      }
      section += added
      smallRankCeiling = u
      haveChunk = false
      chunkNum = 0n
      chunkDen = 1n
      chunkFromHangulDigit = false
      consumed = true
      justClosedSection = false
      pos += 1
      checkpoints.push({ end: pos, value: total + section })
      continue
    }

    if (BIG_UNIT[ch] !== undefined) {
      const U = BIG_UNIT[ch]
      if (bigRankCeiling !== null && U >= bigRankCeiling) break
      let contribution: bigint
      if (haveChunk && chunkDen !== 1n) {
        const num = chunkNum * U
        if (num % chunkDen !== 0n) break
        contribution = section * U + num / chunkDen
      } else {
        const coef = section + (haveChunk ? chunkNum : 0n)
        contribution = coef === 0n ? U : coef * U
      }
      total += contribution
      section = 0n
      haveChunk = false
      chunkNum = 0n
      chunkDen = 1n
      chunkFromHangulDigit = false
      bigRankCeiling = U
      smallRankCeiling = null
      consumed = true
      justClosedSection = true
      pos += 1
      checkpoints.push({ end: pos, value: total + section })
      continue
    }

    if (isWhitespace(ch)) {
      let j = pos
      while (isWhitespace(input[j])) j++
      const next = input[j]
      // (a) a coefficient is pending and the run bridges to the unit it
      //     belongs to: "5 만원" = 5*10000, not "5" then a bare "만원".
      const bridgeToUnit =
        haveChunk &&
        (SMALL_UNIT[next] !== undefined || BIG_UNIT[next] !== undefined)
      // (b) a section just closed and the run bridges to a new digit that
      //     starts the next section: "3만 5천원" = 30000+5000. Never bridges
      //     into a bare UNIT here — that would wrongly pull "천천히" into
      //     "5만 천천히 줄게".
      const bridgeToDigit =
        justClosedSection &&
        (isDigitChar(next) || HANGUL_DIGIT[next] !== undefined)
      if (bridgeToUnit || bridgeToDigit) {
        pos = j
        continue
      }
      break
    }

    break
  }

  if (!consumed) return null

  const naturalEnd = pos
  const danglingHangulChunk = haveChunk && chunkFromHangulDigit

  if (danglingHangulChunk) {
    if (naturalEnd === input.length) {
      // Nothing follows the dropped Sino-Korean digit at all — the whole
      // string might be one intentional numeral we'd otherwise misread by
      // truncating it (이십오 = 25, not 20; 십일 = 11, not 10), with no
      // independent evidence (more sentence text) that dropping it is safe.
      // "Never a confidently wrong number" outranks salvaging a shorter
      // read — this replaces round 4's "accept the checkpoint outright at
      // EOS" (which is exactly what let 만일/이십오 through ungated).
      return null
    }
    // More text follows the dropped digit — fall through with naturalValue
    // forced to null below, so the digit-gated backoff search is what
    // decides this one (that's what keeps "3만이야" at 30000: its
    // checkpoint "3만" has a real digit, unlike "만일"'s bare "만").
  }

  const naturalValue = danglingHangulChunk
    ? null
    : total + section + (haveChunk ? chunkNum : 0n)

  if (naturalValue !== null) {
    const after = input[naturalEnd]
    const closedBySuffix = foldClosedSuffix(input, naturalEnd) !== naturalEnd
    const boundaryOk =
      after === undefined || !isWordChar(after) || closedBySuffix
    if (boundaryOk) {
      // A bare implied-1 reading (no digit anywhere in the whole span) is
      // only trustworthy when 원 or a CLOSED_END_SUFFIX word independently
      // confirms it's a quantity — a lone "억"/"만"/"천"/"십"/"백" with
      // nothing else around it is not money (the old regex required
      // 만\s*원, never a bare 만, for the implicit-1 case; "헐 억" is not
      // ₩100,000,000). No earlier checkpoint can rescue this case either:
      // if no digit appears anywhere in [from, naturalEnd), none appears in
      // any earlier checkpoint's span within that same range.
      if (DIGIT_CHAR.test(input.slice(from, naturalEnd)) || closedBySuffix) {
        return { value: naturalValue, end: naturalEnd }
      }
      return null
    }
  }

  // Boundary failed (or the natural value was invalidated by a dangling
  // Hangul-origin digit with more text still to come) — the ONLY fallback
  // considered is the single MOST RECENT checkpoint, never an earlier one.
  // Scanning backward through multiple checkpoints can silently truncate a
  // longer, fully legitimate multi-section reading: "3만5천에" closes
  // "3만"=30000 and then "3만5천"=35000 (the real value) before failing on
  // "에" — falling through past the most recent ("3만5천", excluded
  // because it coincides with the failing position) to the earlier "3만"
  // checkpoint (which DOES have a digit) would silently report 30000 for a
  // 35000 sentence, exactly the "confidently wrong number" this reader
  // exists to refuse. Consulting only the last checkpoint converts that
  // (and 5천만에/3천만에/1억5천만에/5천백에/2천만다행 and siblings) to a
  // safe `null` instead. Do not relax `cp.end <` to `<=` — that reopens
  // 오만가지/오만상/3만나자, where the checkpoint DOES coincide with the
  // failing position and must stay excluded.
  const cp = checkpoints[checkpoints.length - 1]
  if (
    cp !== undefined &&
    cp.end < naturalEnd &&
    DIGIT_CHAR.test(input.slice(from, cp.end))
  ) {
    return cp
  }
  return null
}

/**
 * Exported for `chat-parse/items.ts`, which reuses this SAME full-sentence
 * scan (rather than a second, drifting copy of the glued-run/max-span edge
 * cases already proven here — e.g. "3만5천원" must scan as ONE candidate,
 * never two) to tell an item quantity apart from a real item amount.
 */
export interface AmountCandidate {
  amount: string
  currency: string | null
  start: number
  end: number
}

/** Digit / Hangul-digit / Hangul-unit characters — the vocabulary a numeral
 *  COMPOUND is built from. Not exported; only `scanAmountCandidates`'s C1
 *  glued-run skip below needs this exact union. */
const NUMERAL_RUN_CHARS = '0123456789' + HANGUL_DIGIT_CHARS + HANGUL_UNIT_CHARS
function isNumeralRunChar(ch: string | undefined): boolean {
  return ch !== undefined && NUMERAL_RUN_CHARS.includes(ch)
}

export function scanAmountCandidates(input: string): AmountCandidate[] {
  const found: AmountCandidate[] = []
  let i = 0
  while (i < input.length) {
    const hangul = readHangulNumber(input, i)
    if (
      hangul &&
      hangul.value > 0n &&
      hasPlaceValueUnit(input.slice(i, hangul.end))
    ) {
      // T3 fix round 1 (I2): the folded marker decides the currency — `4천엔`
      // is JPY, `3만원` is KRW, and a compound closed by a pure quantity
      // marker or by nothing at all (`3만씩`, `4만`) keeps the Hangul
      // compound's long-standing KRW default.
      const folded = foldClosedEnd(input, hangul.end)
      found.push({
        amount: hangul.value.toString(),
        currency: folded.currency ?? 'KRW',
        start: i,
        end: folded.end,
      })
      i = folded.end
      continue
    }

    // C1: `readHangulNumber` attempted a compound reading starting at `i`
    // and FAILED (`hangul === null`, distinct from "succeeded but wasn't
    // money" above) — e.g. "3만5천으로" nulls per the last-checkpoint rule
    // (docs/SOLVED.md). Without this, the bare-digit fallback below
    // re-enters INSIDE the failed compound char-by-char and finds a bare
    // "3" (glued to a following 만) and later a bare "5" (glued to a
    // preceding 만 / following 천) — a digit glued to an adjacent Hangul
    // digit/unit character is never a standalone amount on its own; the
    // compound it's part of already had its one chance via
    // `readHangulNumber` and lost. So the WHOLE glued run (digits + Hangul
    // digit/unit chars) is skipped in one jump before any regex below gets
    // a chance at a sub-piece of it. A PURE Arabic-digit run has no failed
    // compound to protect against (nothing Hangul was ever glued to it) —
    // it still falls through to the ordinary bare-digit path unchanged
    // ("35000으로" -> 35000, hangul nulls the same way but the run is
    // digits-only, so it is not skipped here).
    if (hangul === null && isNumeralRunChar(input[i])) {
      let j = i
      while (isNumeralRunChar(input[j])) j++
      if (/[^0-9]/.test(input.slice(i, j))) {
        i = j
        continue
      }
    }

    const rest = input.slice(i)

    const sym = SYMBOL_PREFIX_RE.exec(rest)
    if (sym) {
      found.push({
        amount: sym[2].replace(/,/g, ''),
        currency: currencyCodeForToken(sym[1]),
        start: i,
        end: i + sym[0].length,
      })
      i += sym[0].length
      continue
    }

    const suf = SUFFIX_RE.exec(rest)
    if (suf) {
      found.push({
        amount: suf[1].replace(/,/g, ''),
        currency: currencyCodeForToken(suf[2]),
        start: i,
        end: i + suf[0].length,
      })
      i += suf[0].length
      continue
    }

    if (isDigitChar(input[i]) && !isDigitChar(input[i - 1])) {
      const bare = BARE_RE.exec(rest)!
      found.push({
        amount: bare[0].replace(/,/g, ''),
        currency: null,
        start: i,
        end: i + bare[0].length,
      })
      i += bare[0].length
      continue
    }

    i += 1
  }
  return found
}

/**
 * Korean correction connector: "OLD 말고/이 아니라/이 아니고 NEW" rejects the
 * candidate immediately BEFORE the connector — the replaced value, not the
 * new one.
 */
function isRejectedByKoreanConnector(input: string, end: number): boolean {
  let j = end
  while (isWhitespace(input[j])) j++
  if (input.startsWith('말고', j)) return true
  if (input[j] === '이' || input[j] === '가') j++
  while (isWhitespace(input[j])) j++
  return input.startsWith('아니라', j) || input.startsWith('아니고', j)
}

/**
 * English correction connector: "NEW not OLD" rejects the candidate
 * immediately AFTER "not" — the rejected value, not the new one. (Reverse
 * of the Korean connector's direction.)
 */
function isRejectedByEnglishNot(input: string, start: number): boolean {
  const before = input.slice(0, start).trimEnd()
  return /(^|[^a-z])not$/i.test(before)
}

/**
 * Reads an amount out of a CONFIRM_MODIFY reply fragment — a whole reply
 * that may carry correction framing around the number (`4만원으로 바꿔줘`,
 * `3만원 말고 4만원`, `no I meant 50`), not a single isolated value. Scans
 * the entire fragment for every amount candidate and returns the LAST
 * surviving one (the correction target), after dropping any candidate a
 * correction connector marks as the rejected old value.
 *
 * Unlike `extractAmount`, a short bare number is accepted with no digit-count
 * floor: the open card already guarantees the message is about an amount.
 * `defaultCurrency` is used only when the winning candidate carries no
 * currency signal of its own (a bare number); a Hangul compound is always
 * KRW, and a symbol/suffix candidate always uses its own detected code.
 *
 * Task 3 (open-card currency edit): `defaultCurrency` may be `null` for
 * callers that need to know whether the fragment NAMED a currency at all —
 * `classify()`'s CONFIRM_MODIFY amount slot only carries one when the reply
 * said so, since a bare number must leave the open card on its own currency
 * rather than silently resetting it to the chat default. Passing a code keeps
 * the original defaulting behaviour byte for byte.
 */
export function readAmountFragment(
  s: string,
  defaultCurrency: string | null,
): { amount: string; currency: string | null } | null {
  const candidates = scanAmountCandidates(s)
  const surviving = candidates.filter(
    (c) =>
      !isRejectedByKoreanConnector(s, c.end) &&
      !isRejectedByEnglishNot(s, c.start),
  )
  const last = surviving[surviving.length - 1]
  if (!last) return null
  return { amount: last.amount, currency: last.currency ?? defaultCurrency }
}
