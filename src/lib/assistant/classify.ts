/**
 * classify() — spec §2.3's precedence ladder (P0-P6), control flow only.
 *
 * Every token/frame branched on comes from a lexicon data file
 * (`./lexicons`) or from `chat-parse` (delegated to, never reimplemented).
 * Where a needed token was missing from T2's lexicon data, it was ADDED
 * there with tier/freq and a comment (see `lexicons/expense-signal.ts`,
 * `lexicons/modify.ts`'s `MODIFY_DISCONTINUOUS_FRAMES`/`fragmentGated`,
 * `lexicons/query.ts`'s `the total` row, and `lexicons/noise.ts`) rather
 * than inlined here.
 *
 * Round 2 (reviewer fixes): the P2 fragment gate is now a REAL §2.4
 * implementation (`isFragment`, strips every consumed span and checks if
 * only particles/punctuation remain), not the round-1 `extractAmount===null`
 * proxy. `chat-parse` now exports `hasPayVerb`/`hasSplitKeyword` so P5's
 * signal check shares the SAME vocabulary `parse()` itself uses, instead of
 * a second, drifting mirror.
 *
 * Purity: no DB, no I/O, no React — same law as settlement/chat-parse.
 */

import { parse } from '../chat-parse'
import { extractAmount } from '../chat-parse/amount'
import { tokenize } from '../chat-parse/engine/tokenizer'
import { hasSplitKeyword } from '../chat-parse/index'
import { EXTRA_CURRENCY_TOKENS, findAmounts } from '../chat-parse/parsers/amount'
import { findEditAction } from '../chat-parse/parsers/edit'
import { findPeople, findPeopleWithActor } from '../chat-parse/parsers/people'
import { findReference } from '../chat-parse/parsers/reference'
import { findMembers, findMembersWithActor, hasPayVerb } from '../chat-parse/people'
import type { MemberHit } from '../chat-parse/people'
import {
  CURRENCY_TOKEN,
  HANGUL_DIGIT_CHARS,
  HANGUL_UNIT_CHARS,
  readAmountFragment,
  scanAmountCandidates,
} from './hangul-number'
import {
  CONFIRM_TOKENS,
  D7_SETTLE_PROGRESS_SUBJECTS,
  GUIDED_TOPICS,
  HISTORY_NOUNS,
  SMALL_TALK_LEADS,
  SMALL_TALK_STEMS,
  SMALL_TALK_TAILS,
  HISTORY_SHOW_VERBS,
  SMALL_TALK_TOKENS,
  DECOY_PHRASES,
  HELP_MARKERS,
  HOLD_TOKENS,
  MODIFY_DISCONTINUOUS_FRAMES,
  MODIFY_PATTERNS,
  NEGATE_TOKENS,
  NEITHER_TOKENS,
  PAY_VERB_STEMS,
  QUERY_MARKERS,
  VERBALIZING_SUFFIXES,
} from './lexicons'
import {
  FRAGMENT_FILLER_WORDS,
  FRAGMENT_NOISE_CHARS,
  FRAGMENT_TRAILING_WORDS,
  P1_TRAILING_STRIP_CHARS,
} from './lexicons/noise'
import type { ModifyPatternEntry } from './lexicons/modify'
import type { QueryMarkerEntry, QueryMarkerRole } from './lexicons/query'
import { hasLeadingBoundaryPhrase, hasPhrase, hasWordPhrase } from './match'
import { normalize } from './normalize'
import type { Normalized } from './normalize'
import type {
  AssistantContext,
  HistoryFilters,
  Classified,
  ConfirmModifySlots,
  Intent,
  ParsedExpense,
} from './types'

// Currency tokens the fragment check strips — sourced from hangul-number.ts's
// own CURRENCY_TOKEN table (the single owner), not retyped.
//
// T3 fix round 1 (I1): SYMBOL tokens are stripped too. The earlier version was
// word-kind only, reasoning that "symbols never appear alone as content" —
// which is true, and is precisely why leaving them IN the remainder was the
// bug rather than a safeguard: `$50으로` typed at an open card stripped the
// digits and the particle but kept a lone `$`, so the fragment check said "real
// content survived" and the message superseded the card with a junk `$` draft.
//
// T3 fix round 2: `불` (the everyday Korean word for a dollar) is stripped too,
// but it is NOT in `CURRENCY_TOKEN`, because that table also feeds
// `hangul-number.ts`'s `SUFFIX_RE`, which has no Hangul boundary check —
// `50불고기` would scan as $50. Stripping is safe where scanning is not: this
// list only ever answers "is this leftover scrap accounted for?".
//
// T3 fix round 3: that asymmetry has a consequence worth naming separately,
// which is why the strip-only tokens keep their own list. For every OTHER
// currency token, "the fragment check saw it" implies "the amount scanner
// could have seen it too". For a strip-only token it does not: the scanner is
// blind to `불`, so `오만 불` becomes a fragment carrying the scanner's
// currency-blind KRW reading. `tryModify` step 3 refuses to emit that.
const STRIP_ONLY_CURRENCY_TOKENS = ['불'] as const
const CURRENCY_STRIP_TOKENS = [
  ...CURRENCY_TOKEN.map((c) => c.token),
  ...STRIP_ONLY_CURRENCY_TOKENS,
]
const AMOUNT_CHAR_RE = new RegExp(
  `[0-9${HANGUL_DIGIT_CHARS}${HANGUL_UNIT_CHARS}]`,
  'gu',
)

// Widened to the shared interface types: the `as const satisfies` arrays in
// lexicons/ are typed as a union of exact literal members, so TS won't let a
// `.find()` result access a property (`op`/`split`/`fragmentGated`/
// `currencyCode`) that only SOME members declare. The data
// itself is unchanged — this is a type-level view only.
const MODIFY_PATTERNS_ALL: readonly ModifyPatternEntry[] = MODIFY_PATTERNS
const QUERY_MARKERS_ALL: readonly QueryMarkerEntry[] = QUERY_MARKERS

// ===================================================================
// P1/HOLD/NEITHER — whole-input equality helpers (§2.3 P1, §2.7)
// ===================================================================

/** review M8: trailing `!`/`.` runs never carry meaning for P1's whole-token check — NEVER `?` (§3.11 keeps it meaningful on its own). */
function stripTrailingPunct(s: string): string {
  let out = s
  while (
    out.length > 0 &&
    (P1_TRAILING_STRIP_CHARS as readonly string[]).includes(out[out.length - 1])
  ) {
    out = out.slice(0, -1)
  }
  return out
}

/**
 * review I6 (ruling): case is folded ONLY here, for P1's whole-input
 * equality (`No`/`OK`/`Sure`/`Yep`/`Wait` all work). P2/P3 matching
 * (`hasPhrase`/`matchesEither` below) stays case-sensitive — collision #20
 * needs the `I` vs `we` pronoun distinction to survive, which case-folding
 * would erase (`i` becomes indistinguishable from stray lowercase text).
 */
function eitherEqualsToken(norm: Normalized, token: string): boolean {
  const t = normalize(token)
  const text = stripTrailingPunct(norm.text).toLowerCase()
  const shadow = stripTrailingPunct(norm.shadow).toLowerCase()
  const tText = stripTrailingPunct(t.text).toLowerCase()
  const tShadow = stripTrailingPunct(t.shadow).toLowerCase()
  return text === tText || shadow === tShadow
}

// ===================================================================
// P2 — CONFIRM_MODIFY (§2.3, §2.4, §2.6)
// ===================================================================

type ModifyStep = ConfirmModifySlots | { needsCompanion: true } | null

/**
 * review I3: P2 matching consults both the spaced text AND the whitespace-
 * removed shadow ('다 같이' must work), unlike QUERY's boundary-checked en
 * matcher — MODIFY stays a plain substring check either way. Also case-
 * folded ('N빵' must resolve the same as 'n빵') — P2's own vocabulary
 * (split/participant/null/amount-noun markers) has no pronoun-style
 * discriminator the way P3's `I`/`we` does (review I6), so there is no
 * collision #20-style reason to withhold folding here.
 */
function matchesModifyPattern(norm: Normalized, pattern: string): boolean {
  const p = normalize(pattern)
  return (
    norm.text.toLowerCase().includes(p.text.toLowerCase()) ||
    norm.shadow.toLowerCase().includes(p.shadow.toLowerCase())
  )
}

/**
 * spec §2.4, implemented for real (review C1): strips every span the
 * parser consumes — member hits, amount-like content, and every recognized
 * MODIFY_PATTERNS/MODIFY_DISCONTINUOUS_FRAMES marker (ANY field, not just
 * the one under consideration — §2.6's `반반 아니고 다같이` needs `아니고`
 * treated as recognized noise even though `다같이` is the winning field) —
 * and reports whether only particles/punctuation are left. Tried against
 * both the spaced text and the whitespace-removed shadow (review I3); a
 * match in EITHER counts as a fragment.
 */
function isFragment(norm: Normalized, ctx: AssistantContext): boolean {
  return isFragmentIn(norm.text, ctx) || isFragmentIn(norm.shadow, ctx)
}

function isFragmentIn(text: string, ctx: AssistantContext): boolean {
  const hits = findMembers(text, ctx.members)
  const memberSpans = hits.map((h) => ({ start: h.start, end: h.end }))
  // Final-review I1: a pay-verb slice immediately trailing a bound name —
  // the SAME per-hit "name -> next hit" window `lastPayerCorrection` below
  // already uses to resolve a payer correction — is recognized §2.4
  // content too, not leftover. Needed so the payer step (Step 4) can be
  // fragment-gated without breaking `MODIFY_CORPUS`'s bare payer-correction
  // rows ('유나가 냈어'/'철수가 결제했어'): the whole trailing verb-phrase
  // WINDOW is treated as consumed, not just the bare PAY_VERB keyword
  // substring — Korean verb endings (냈->냈어, 결제->결제했어) are not
  // otherwise in any strip list, so stripping only the keyword would leave
  // a non-empty residue and wrongly fail the fragment check anyway.
  const payVerbSpans = hits.flatMap((h) => {
    const nextStart =
      hits.find((h2) => h2.start > h.start)?.start ?? text.length
    const slice = text.slice(h.end, nextStart)
    return hasPayVerb(slice) ? [{ start: h.end, end: nextStart }] : []
  })
  const spans = [...memberSpans, ...payVerbSpans].sort(
    (a, b) => b.start - a.start,
  )
  let rest = text
  for (const s of spans) rest = rest.slice(0, s.start) + ' ' + rest.slice(s.end)

  // Case-folded from here on (matches matchesModifyPattern/lastMatchIndex
  // — 'N빵' must strip the same as 'n빵'); member-span removal above still
  // used the ORIGINAL casing (findMembers does its own case-insensitive
  // compare internally, position-wise unaffected either way).
  rest = rest.toLowerCase()

  // Recognized MARKERS strip first, BEFORE the amount/currency char-class
  // pass: some markers contain characters that char-class alone would also
  // eat out from under them (엔빵'S 엔 is also the JPY currency word; 다같
  // 이'S 이 is also the Sino-Korean digit syllable for "two") — stripping
  // digit/currency chars first would fragment those markers and make them
  // unmatchable afterward.
  for (const p of MODIFY_PATTERNS_ALL) {
    if (p.locale === ctx.locale)
      rest = rest.split(p.pattern.toLowerCase()).join(' ')
  }
  for (const f of MODIFY_DISCONTINUOUS_FRAMES) {
    if (f.locale === ctx.locale) {
      rest = rest
        .split(f.prefix.toLowerCase())
        .join(' ')
        .split(f.suffix.toLowerCase())
        .join(' ')
    }
  }
  for (const w of FRAGMENT_FILLER_WORDS) {
    if (w.locale === ctx.locale)
      rest = rest.split(w.word.toLowerCase()).join(' ')
  }

  rest = rest.replace(AMOUNT_CHAR_RE, '')
  for (const c of CURRENCY_STRIP_TOKENS)
    rest = rest.split(c.toLowerCase()).join('')

  for (const ch of FRAGMENT_NOISE_CHARS) rest = rest.split(ch).join('')

  // Trailing-only strip, to a FIXPOINT, AFTER the noise-char pass above
  // (noise.ts's own FRAGMENT_TRAILING_WORDS doc comment has the full
  // reasoning: safe only from the END, never as a substring anywhere else,
  // and longest-first so `해주세요` doesn't get stranded mid-word by a
  // premature bare-`요` match). The list is small and locale-scoped, so a
  // `some()` re-scan per removal is cheap and keeps the loop obviously
  // correct rather than clever.
  const trailing = FRAGMENT_TRAILING_WORDS.filter(
    (w) => w.locale === ctx.locale,
  )
  let strippedTrailing = true
  while (strippedTrailing) {
    strippedTrailing = false
    for (const w of trailing) {
      if (rest.endsWith(w.word)) {
        rest = rest.slice(0, rest.length - w.word.length)
        strippedTrailing = true
        break
      }
    }
  }

  return rest.length === 0
}

/** shadow-space "last occurrence" position — comparable across patterns regardless of internal spacing (review I3/I5), case-folded (review I3: 'N빵'). -1 when not found. */
function lastMatchIndex(norm: Normalized, pattern: string): number {
  return norm.shadow
    .toLowerCase()
    .lastIndexOf(normalize(pattern).shadow.toLowerCase())
}

/** review I5/M9: last-wins among every matching split pattern (`반반 아니고 다같이` -> the LAST one, `다같이`/everyone). */
function findLastSplit(
  norm: Normalized,
  ctx: AssistantContext,
): ModifyPatternEntry | null {
  let best: { entry: ModifyPatternEntry; pos: number } | null = null
  for (const p of MODIFY_PATTERNS_ALL) {
    if (p.field !== 'split' || p.locale !== ctx.locale) continue
    const pos = lastMatchIndex(norm, p.pattern)
    if (pos === -1) continue
    if (best === null || pos > best.pos) best = { entry: p, pos }
  }
  return best?.entry ?? null
}

interface ParticipantCandidate {
  readonly op: 'remove' | 'add' | 'only'
  readonly pos: number
  /** §2.3-named markers (빼줘/제외/포함/remove) bypass the fragment check; everything else (review C1) needs it. */
  readonly unconditional: boolean
}

/** review I5/M10: last-wins among every matching participant-op pattern/frame, tagged with whether it needs the fragment check. */
function findLastParticipant(
  norm: Normalized,
  ctx: AssistantContext,
): ParticipantCandidate | null {
  let best: ParticipantCandidate | null = null
  for (const p of MODIFY_PATTERNS_ALL) {
    if (p.field !== 'participants' || p.locale !== ctx.locale) continue
    const pos = lastMatchIndex(norm, p.pattern)
    if (pos === -1) continue
    if (best === null || pos > best.pos) {
      best = { op: p.op!, pos, unconditional: !p.fragmentGated }
    }
  }
  for (const f of MODIFY_DISCONTINUOUS_FRAMES) {
    if (f.locale !== ctx.locale) continue
    if (
      !startsWithWord(norm.text, f.prefix) ||
      !endsWithWord(norm.text, f.suffix)
    ) {
      continue
    }
    const pos = lastMatchIndex(norm, f.suffix)
    if (best === null || pos > best.pos) {
      best = { op: f.op, pos, unconditional: false }
    }
  }
  return best
}

/** The member hit nearest the winning marker's shadow-space position (review I5/M10: `민수 포함 유나 빼줘` -> 빼줘 wins, 유나 is nearest to it). */
function nearestHit(
  hits: readonly MemberHit[],
  norm: Normalized,
  pos: number,
): MemberHit {
  if (pos < 0) return hits[hits.length - 1]
  let best = hits[0]
  let bestDist = Infinity
  for (const h of hits) {
    const hPos = norm.shadow.indexOf(
      normalize(norm.text.slice(h.start, h.end)).shadow,
    )
    const dist = hPos === -1 ? Infinity : Math.abs(hPos - pos)
    if (dist < bestDist) {
      best = h
      bestDist = dist
    }
  }
  return best
}

function startsWithWord(text: string, word: string): boolean {
  const re = new RegExp(`^${escapeRegex(word)}\\b`, 'i')
  return re.test(text)
}
function endsWithWord(text: string, word: string): boolean {
  const re = new RegExp(`\\b${escapeRegex(word)}$`, 'i')
  return re.test(text)
}
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** review I5/M9: last-wins among every member+pay-verb pairing (`유나가 냈어 아니 철수가 냈어` -> 철수, the LAST correction). */
function lastPayerCorrection(
  text: string,
  ctx: AssistantContext,
): { id: string } | null {
  const hits = findMembers(text, ctx.members)
  let winner: { id: string } | null = null
  for (const h of hits) {
    const nextStart =
      hits.find((h2) => h2.start > h.start)?.start ?? text.length
    const slice = text.slice(h.end, nextStart)
    if (hasPayVerb(slice)) winner = { id: h.id }
  }
  return winner
}

/** Does the text carry a currency token the AMOUNT SCANNER cannot see? See
 *  `STRIP_ONLY_CURRENCY_TOKENS`.
 *
 *  T3 fix round 4 (B2): a strip-only token counts only when it is ADJACENT to
 *  a numeral (whitespace allowed between them) — `오만 불`, `5만불로`. The
 *  round-3 check was a raw `text.includes('불')`, which swept up everyday
 *  words that merely CONTAIN the syllable: `불고기 40000으로 바꿔줘` asked
 *  "얼마로 바꿀까요?" instead of applying ₩40,000, because guard 1 saw the 불
 *  of 불고기 and the strict parser (rightly) had bound no currency. 불 names a
 *  dollar only as a counter after a number; anywhere else it is a syllable. */
const STRIP_ONLY_ADJACENT_RES = STRIP_ONLY_CURRENCY_TOKENS.map(
  (token) =>
    new RegExp(
      `[0-9${HANGUL_DIGIT_CHARS}${HANGUL_UNIT_CHARS}]\\s*${escapeRegex(token)}`,
      'u',
    ),
)
function hasStripOnlyCurrencyToken(text: string): boolean {
  return STRIP_ONLY_ADJACENT_RES.some((re) => re.test(text))
}

/** Does the text name THIS currency? The one currency fact neither reader can
 *  invent — both of them hardcode KRW for a bare Hangul compound, so "a
 *  currency was named" cannot be taken on their word alone.
 *
 *  T3 fix round 4 (B1): two changes from round 3's `namesAnyCurrencyToken`.
 *
 *  1. The token set covers everything `parse()` can bind from — CURRENCY_TOKEN
 *     plus `EXTRA_CURRENCY_TOKENS` (the English words, £/gbp, 불) — not just
 *     the Hangul scanner's table. With the Hangul-only set, "make it 50
 *     dollars" at a ¥ card had its USD silently dropped and applied as ¥50
 *     (dollars/bucks/quid/won all affected; euros/yen/usd survived only
 *     because `eur`/`yen`/`usd` happen to be their substrings).
 *
 *  2. The check is CODE-MATCHED, not any-token: the emitted currency must be
 *     traceable to a token in the text that names THAT currency. The
 *     any-token version, once widened, would hand the blind spot right back
 *     through the other lexicon: `오만 quid으로 바꿔줘` carries the scanner's
 *     currency-blind KRW as its candidate, and `quid` — a currency token, just
 *     not a KRW one, and invisible to the ko parse — would have re-admitted
 *     it. GBP-in-the-text is not license to emit KRW.
 *
 *  Strip-only tokens (`불`) go through the numeral-adjacency check above
 *  instead of a raw `includes`, for the B2 reason: `숯불 4만으로` must not
 *  let the 불 of 숯불 admit anything. */
const NAMEABLE_CURRENCY_TOKENS: ReadonlyArray<{ token: string; code: string }> =
  [
    ...CURRENCY_TOKEN.map((c) => ({ token: c.token, code: c.code })),
    ...EXTRA_CURRENCY_TOKENS.filter(
      (e): e is { token: string; code: string } => e.code !== null,
    ),
  ]
function textNamesCurrencyCode(text: string, code: string): boolean {
  const lower = text.toLowerCase()
  return NAMEABLE_CURRENCY_TOKENS.some((t) => {
    if (t.code !== code) return false
    if ((STRIP_ONLY_CURRENCY_TOKENS as readonly string[]).includes(t.token)) {
      return hasStripOnlyCurrencyToken(text)
    }
    return lower.includes(t.token.toLowerCase())
  })
}

/**
 * Did the SENTENCE name a currency, or is `parse()` merely reporting the
 * group's default?
 *
 * `ParsedExpense.currency` cannot tell those apart — it is `defaultCurrency`
 * in both cases — and the CONFIRM_MODIFY amount slot has to, because "named
 * nothing" is what leaves an open card on its own currency (a bare `4000`
 * typed at a ¥ card must not reprice it in ₩). Rather than add a flag to a
 * shared parser type, ask the parser the question directly: re-read the same
 * sentence with a different default and see whether the answer moves. It moves
 * exactly when nothing in the text bound a currency.
 *
 * `XTS` is ISO 4217's reserved code for testing, so it can never collide with
 * a real group default; `XXX` ("no currency") stands in on the one input where
 * it could.
 *
 * KNOWN BLIND SPOT (fix round 3, named rather than papered over): a Korean
 * place-value compound answers "named" even when no currency word appears.
 * `parse()` treats `3만`/`삼만` as a money reading in its own right
 * (`KOREAN_COMPOUND_IS_MONEY`, chat-parse/parsers/amount.ts) and hardcodes KRW
 * for it regardless of the default, so the probe below cannot move the answer
 * and this oracle reports a currency the sentence never said. Both readers
 * make the same assumption, so re-asking cannot expose it — which is exactly
 * why the CALLER additionally requires a currency token to be present in the
 * text before it emits any currency at all. Fixing it at the source would mean
 * changing what a bare Hangul compound means to every consumer of
 * `scanAmountCandidates` (`chat-parse/items.ts` included), which is not this
 * task's to change.
 */
function sentenceNamesCurrency(
  text: string,
  ctx: AssistantContext,
  parsed: ParsedExpense,
): boolean {
  const probe = ctx.defaultCurrency === 'XTS' ? 'XXX' : 'XTS'
  return parse(text, { ...ctx, defaultCurrency: probe }).currency === parsed.currency
}

/**
 * The ITEMS card's one modify slot — a price for a named line ("콜라는
 * 500엔", "우동 900"), or a bare amount when exactly one line is still
 * unpriced (nothing else it could mean). 2026-08-14 live-app fix round:
 * before this, ANY typed follow-up while the items card was open destroyed
 * the card (classified as a fresh EXPENSE_ENTRY).
 *
 * An amount in the reply is REQUIRED before a line name binds anything —
 * "콜라는 수탉이 마셨어" names a line but carries no price, and claiming it
 * as an (empty) price edit would swallow a sentence this slot cannot honor;
 * it falls through to the guided reply instead.
 */
function tryItemPrice(
  input: string,
  norm: Normalized,
  lines: ReadonlyArray<{ key: number; name: string; unpriced: boolean }>,
  ctx: AssistantContext,
): Extract<ConfirmModifySlots, { field: 'itemPrice' }> | null {
  const read = readAmountFragment(input, null)
  if (!read) return null
  // Longest name first — "와규 안심" must beat "와규" in the same reply.
  const named = [...lines]
    .filter((l) => l.name !== '')
    .sort((a, b) => b.name.length - a.name.length)
    .find((l) => input.includes(l.name))
  if (named) {
    return {
      field: 'itemPrice',
      key: named.key,
      amount: read.amount,
      ...(read.currency !== null ? { currency: read.currency } : {}),
    }
  }
  const unpriced = lines.filter((l) => l.unpriced)
  if (unpriced.length === 1 && isFragment(norm, ctx)) {
    return {
      field: 'itemPrice',
      key: unpriced[0].key,
      amount: read.amount,
      ...(read.currency !== null ? { currency: read.currency } : {}),
    }
  }
  return null
}

/**
 * R4 — a typed assignment for one line of the open items card. Fires only
 * when the sentence names a LINE plus a PERSON (member or self-mention) or
 * a share-out word; an amount is the price slot's business and is checked
 * before this. Never guesses: name-only sentences fall through.
 */
const ITEM_ASSIGN_SIGNAL_RE =
  /먹|마시|마셨|드셨|시켰|시킨|나눠|나눴|가져|챙겨|(?<![가-힣])꺼(?![가-힣])|(?<![가-힣])거(?![가-힣])|몫/
const ITEM_SHARE_RE = /하나씩|씩|나눠|나누|같이|반반|각자|다같이/

function tryItemAssign(
  input: string,
  lines: ReadonlyArray<{ key: number; name: string; unpriced: boolean }>,
  ctx: AssistantContext,
): Extract<ConfirmModifySlots, { field: 'itemAssign' }> | null {
  // An amount present means a price statement — not ours.
  if (scanAmountCandidates(input).length > 0) return null
  const named = [...lines]
    .filter((l) => l.name !== '')
    .sort((a, b) => b.name.length - a.name.length)
    .find((l) => input.includes(l.name))
  if (!named) return null
  // Only the clause about THIS line: cut at the next OTHER line's topic so
  // "콜라는 수탉이 마시고 우동은 내가" assigns 콜라 to 수탉, not to both.
  const start = input.indexOf(named.name)
  let end = input.length
  for (const other of lines) {
    if (other.key === named.key || other.name === '') continue
    const at = input.indexOf(other.name, start + named.name.length)
    if (at !== -1 && at < end) end = at
  }
  const clause = input.slice(start, end)
  // The possessive 꺼 glues to the name ("수탉꺼") and is not a josa, so the
  // binder would reject the whole token — soften it to a boundary for the
  // PERSON search only (the signal check keeps the original clause).
  const clauseForPeople = clause.replace(/꺼/g, ' ')
  const memberIds = [
    ...new Set(
      findPeopleWithActor(
        tokenize(clauseForPeople),
        clauseForPeople,
        ctx.members,
        ctx.actorId,
      ).map((h) => h.memberId),
    ),
  ]
  if (memberIds.length > 0 && ITEM_ASSIGN_SIGNAL_RE.test(clause)) {
    return { field: 'itemAssign', key: named.key, memberIds, shareAll: false }
  }
  // Bare "<line> <person>꺼" has the possessive itself as the signal; a
  // person named with NO signal at all stays unclaimed (fall through).
  if (memberIds.length > 0 && /꺼|거(?![가-힣])|몫/.test(clause)) {
    return { field: 'itemAssign', key: named.key, memberIds, shareAll: false }
  }
  if (memberIds.length === 0 && ITEM_SHARE_RE.test(clause)) {
    return { field: 'itemAssign', key: named.key, memberIds: [], shareAll: true }
  }
  return null
}

function tryModify(norm: Normalized, ctx: AssistantContext): ModifyStep {
  const locale = ctx.locale

  // Step 1: SPLIT (§2.4 fragment list) — always fragment-gated.
  const splitCandidate = findLastSplit(norm, ctx)
  if (splitCandidate && isFragment(norm, ctx)) {
    return { field: 'split', split: splitCandidate.split! }
  }

  // Step 2: PARTICIPANT ops — §2.3-named ones (빼줘/제외/포함/remove) are
  // unconditional; the rest (빼고/minus/without/everyone but/just me and/
  // take...out) require the real fragment check (collision: `민수 빼고
  // 다들 정산했어?` must fall through, not misread as a removal).
  const participantCandidate = findLastParticipant(norm, ctx)
  if (
    participantCandidate &&
    (participantCandidate.unconditional || isFragment(norm, ctx))
  ) {
    const hits = findMembersWithActor(norm.text, ctx.members, ctx.actorId)
    if (participantCandidate.op === 'only') {
      if (hits.length > 0) {
        return {
          field: 'participants',
          op: 'only',
          memberIds: [...new Set([ctx.actorId, ...hits.map((h) => h.id)])],
        }
      }
      // §2.6: bare "just me and" (op:'only', no name) — no §4.7 slot fits
      // an incomplete 'only' the way `memberId:null` fits remove/add below,
      // so this stays the generic GUIDED ask.
      return { needsCompanion: true }
    }
    if (hits.length > 0) {
      const target = nearestHit(hits, norm, participantCandidate.pos)
      return {
        field: 'participants',
        op: participantCandidate.op,
        memberId: target.id,
      }
    }
    // Final-review I4: bare 빼줘/제외/포함/minus/without/everyone but (no
    // bound name) — a concrete slot with `memberId: null`, not
    // `needsCompanion`. The old `needsCompanion` path routed through
    // UNKNOWN's generic GUIDED reply, which opened with `cardOpenAck`
    // ("you've still got a card open...") and an `escape` link that would
    // ABANDON the very card being edited — same class of bug `split:'half'`
    // had before `halfSplitReply` fixed it. `ChatComposer.applyModify`
    // resolves the "ask who" reply itself without touching the draft.
    return {
      field: 'participants',
      op: participantCandidate.op,
      memberId: null,
    }
  }

  // Step 3: AMOUNT — always resolved via readAmountFragment (§5.3's
  // decimal-string, correction-aware reader). Trusted when either (a) the
  // message is nothing but the amount (isFragment), or (b) an unconditional
  // null-connective is present (`아니 그게 아니라 4만원` — the surrounding
  // filler ("아니 그게") isn't itself recognized vocabulary, so isFragment
  // alone would reject it; the connective's presence is what justifies it,
  // per §2.3's literal "carries an explicit correction frame" OR-clause).
  const hasNullConnective = MODIFY_PATTERNS_ALL.some(
    (p) =>
      p.field === null &&
      p.locale === locale &&
      matchesModifyPattern(norm, p.pattern),
  )
  // Task 3 (docs/PROMPT.md [2026-08-14] decision 2): `null` instead of
  // `ctx.defaultCurrency` — the slot must be able to say "this reply named NO
  // currency" (a bare "4000"), which is what leaves the open card on its own.
  // Defaulting here would have made every bare number claim the chat default
  // and silently reset a foreign card back to KRW.
  const amt = readAmountFragment(norm.text, null)
  const amountNoun = MODIFY_PATTERNS_ALL.find(
    (p) =>
      p.field === 'amount' &&
      p.locale === locale &&
      matchesModifyPattern(norm, p.pattern),
  )
  // A pattern that NAMES the amount field ("change the amount to", 금액) is at
  // least as strong a licence to read the number as a field-less connective
  // ("make it", "change it to") — it says the same thing and says which field.
  // Task 11 fix round 1: without this, naming the field got the user LESS,
  // resolving to `amount: null` (an "and how much?" round trip) where the
  // vaguer phrasing resolved to the value.
  //
  // Fix round 2 (ruling): that licence is taken ONLY when the amount parser
  // agrees. `readAmountFragment` is a deliberately loose reader for card
  // REPLIES, where the whole message is already known to be about the amount —
  // it reads the last number it can see, counter and all, so "금액을 3명으로
  // 나눠줘" ("split the amount three ways") handed it a 3. The field noun does
  // not make a sentence a fragment, so the loose reading needs corroboration
  // from the strict one: `parse()` is the same machinery that already knows
  // 3명 is a headcount and "3 people" is not money.
  //
  // Consequence worth naming (fix round 3): `parse()` carries its own
  // disqualifiers with it, including the year band — so a card reply naming a
  // price in 1000-2100 with no confirming word after it ("change the amount
  // 2000 please") does not agree, and the slot comes back null. The card then
  // asks "얼마로 바꿀까요?", one extra round trip, and the user's next message
  // ("2000") is a fragment that resolves outright. Accepted: the alternative
  // is a second, looser definition of what counts as money, living in the
  // classifier, disagreeing with the parser.
  // Both reads below are LAZY (fix round 3): `tryModify` reaches step 3 on
  // every message typed at an open card, and most of them take neither amount
  // branch — running two `parse()` passes unconditionally made every payer,
  // split and participant edit pay for a currency question nobody asked.
  let strictMemo: ParsedExpense | undefined
  const strictParse = (): ParsedExpense =>
    (strictMemo ??= parse(norm.text, ctx))
  let namedMemo: boolean | undefined
  const strictNamedCurrency = (): boolean =>
    (namedMemo ??= sentenceNamesCurrency(norm.text, ctx, strictParse()))
  const parserAgrees = amt !== null && strictParse().amount === amt.amount
  if (amt && (isFragment(norm, ctx) || hasNullConnective || (amountNoun !== undefined && parserAgrees))) {
    // Task 3: the currency rides along from the SAME candidate the value came
    // from, and only when that candidate carried one of its own — the exact
    // binding `parsers/edit.ts`'s `changeAmount` uses for a SAVED expense.
    //
    // T3 fix round 2 (N1): when the STRICT parser read the SAME amount, its
    // currency wins. The two readers genuinely disagreed on a spaced `3만 엔`
    // — the fragment scanner is a substring walk that falls back to the Hangul
    // compound's KRW default, while `parse()` has the tokenizer, the josa
    // detacher and the full currency lexicon and correctly says JPY. The loose
    // one was winning on the card path, which repriced a ¥ card in ₩ at ~10x
    // with no ask. This is the same "one of these two is wrong, and it is the
    // looser one" argument the `parserAgrees` gate above already makes about
    // the VALUE, applied to the currency that comes with it.
    //
    // Guarded by `sentenceNamesCurrency`, and ONLY able to override upward:
    // when the strict parser did not actually bind a currency marker, whatever
    // the fragment scanner saw stands. That asymmetry is deliberate — the
    // strict parser refuses an UNGRAMMATICAL marker (`40000 엔로`: 로 is not a
    // valid allomorph after consonant-final 엔, so its josa detacher rejects
    // the binding and it falls back to the default), and a typo must not
    // silently reprice the card in the group's own currency.
    //
    // T3 fix round 3, guard 1 — a STRIP-ONLY currency token with no binding.
    // `불` is stripped by the fragment check but invisible to the amount
    // scanner, so `오만 불` ("50 grand in dollars") arrives here looking like a
    // clean fragment whose currency is KRW — which is not what the user said,
    // it is what the scanner says whenever it sees a Hangul compound. When the
    // strict parser cannot bind a currency either (it reads no amount at all
    // from `오만 불`), nobody in this system actually knows the currency, so
    // the card ASKS instead of confidently applying ₩50,000. `삼만 불` is
    // unaffected: `parse()` does read it, binds USD, and the slot carries USD.
    if (hasStripOnlyCurrencyToken(norm.text) && !strictNamedCurrency()) {
      return { field: 'amount', amount: null }
    }
    // T3 fix round 3, guard 2 — the KOREAN_COMPOUND_IS_MONEY blind spot (see
    // `sentenceNamesCurrency`). A bare `4만` names no currency, but BOTH
    // readers hardcode KRW for a Hangul compound, so the oracle cannot see
    // that and the slot used to reprice a ¥ card in ₩. Requiring a token for
    // THE EMITTED CURRENCY to actually appear in the text is the check
    // neither reader can fake (round 4: code-matched, both lexicons — see
    // `textNamesCurrencyCode`): no token, no currency key, and the card keeps
    // its own — the same answer a bare `40000` has always given.
    const currency =
      parserAgrees && strictNamedCurrency()
        ? strictParse().currency
        : amt.currency
    const named =
      currency !== null && textNamesCurrencyCode(norm.text, currency)
    return {
      field: 'amount',
      amount: amt.amount,
      ...(named ? { currency } : {}),
    }
  }
  // T3 fix round 2 (`불`): the message is nothing BUT recognized vocabulary
  // (`isFragment`), yet the fragment scanner found no amount in it while the
  // STRICT parser did. That only happens where the scanner is blind and the
  // parser is not — today: `5만불로` ("50 grand in dollars"), since `불` cannot
  // join `CURRENCY_TOKEN` without also joining `SUFFIX_RE`, which has no Hangul
  // boundary check (`50불고기` would scan as $50). Deferring to the parser
  // there turns a card-destroying $50,000 junk draft into the edit the user
  // asked for.
  //
  // Gated on `isFragment` ALONE — never on `hasNullConnective` or the amount
  // noun, which is what leaves T11's ruled safe-miss (`금액 3만5천에 바꿔줘`
  // → ask again, don't guess) exactly where it was: that sentence is not a
  // fragment. The strict parser is STRICTLY tighter than the fragment scanner,
  // so this can only reach inputs the scanner could not see at all.
  if (amt === null && isFragment(norm, ctx) && strictParse().amount !== null) {
    // Guard 2 applies here too: `삼만이` reaches this branch (the scanner
    // cannot read it, `parse()` can) and would otherwise carry the Hangul
    // compound's hardcoded KRW onto a ¥ card, which is the same wrong-currency
    // class as everything else this round.
    const named =
      strictNamedCurrency() &&
      textNamesCurrencyCode(norm.text, strictParse().currency)
    return {
      field: 'amount',
      amount: strictParse().amount,
      ...(named ? { currency: strictParse().currency } : {}),
    }
  }
  if (amountNoun) return { field: 'amount', amount: null }

  // Step 4: PAYER — chat-parse's own pay-verb resolution (last-wins across
  // every member+verb pairing), or a correction connective sitting between
  // two bound names (`민수 말고 철수` — the LAST name is the replacement).
  // Final-review I1: `verbWinner` is now fragment-gated like every other
  // field — it was the one field NOT gated, so a fresh expense sentence
  // that merely happens to contain a bound name + pay-verb ('택시 8500원
  // 유나가 냄', card open) corrupted the open card's payer and swallowed
  // the whole taxi expense instead of superseding the card with a NEW
  // EXPENSE_ENTRY. A bare payer correction ('유나가 냈어' alone) stays a
  // fragment via the pay-verb-slice consumption above and is unaffected.
  const verbWinner = lastPayerCorrection(norm.text, ctx)
  if (verbWinner && isFragment(norm, ctx)) {
    return { field: 'payer', memberId: verbWinner.id }
  }
  const hits = findMembers(norm.text, ctx.members)
  if (hits.length >= 2 && hasNullConnective) {
    return { field: 'payer', memberId: hits[hits.length - 1].id }
  }

  // Step 5: generic "something's wrong" connective (§2.3's own list —
  // unconditional, marker presence alone suffices regardless of filler).
  const nullMarker = MODIFY_PATTERNS_ALL.find(
    (p) =>
      p.field === null &&
      p.locale === locale &&
      matchesModifyPattern(norm, p.pattern),
  )
  if (nullMarker) {
    // Final-review I4: bare `말고` (nothing else) used to route through
    // `needsCompanion` -> UNKNOWN's generic GUIDED reply (cardOpenAck + a
    // card-abandoning escape link — the same class of bug the participants
    // case above had). `{field: null}` already resolves to EXACTLY the
    // right reply with no further plumbing: `ChatComposer.applyModify`'s
    // `field === null` branch is `composeConfirm({kind:'askWhatToChange'})`
    // with no draft mutation — the halfSplitReply precedent applied here
    // costs nothing extra, since every OTHER field:null connective already
    // took this exact path.
    return { field: null }
  }

  // Step 5.5 (round-2 review I3 side effect): a bare "name(들)+만" fragment
  // with a card open ('민수랑 유나만' — "just Minsu and Yuna") reads as a
  // participants-only change, the same semantics as en's `just me and Sam`
  // (§2.3's fragment gate: it must not leak to QUERY_PAIRWISE just because
  // 랑/만 are also query particles — see tryQuery's I3 fix). Requires the
  // LAST bound name's consumed span to end exactly at the message's own
  // end with 만 (people.ts's particle consumption), not merely "만 occurs
  // somewhere" — otherwise checked BEFORE step 6 so a single name ending in
  // 만 ('유나만' alone) reads as "just Yuna", not a payer correction.
  const last = hits[hits.length - 1]
  if (
    hits.length > 0 &&
    isFragment(norm, ctx) &&
    norm.text.endsWith('만') &&
    last.end === norm.text.length
  ) {
    return {
      field: 'participants',
      op: 'only',
      memberIds: [...new Set([ctx.actorId, ...hits.map((h) => h.id)])],
    }
  }

  // Step 6 (review C1): a bare, unambiguous member mention with nothing
  // else in the message ('유나' alone, card open) is itself a fragment —
  // the only field a lone name naturally maps to is the payer.
  if (hits.length === 1 && isFragment(norm, ctx)) {
    return { field: 'payer', memberId: hits[0].id }
  }

  return null
}

// ===================================================================
// P3 — QUERY_* (§2.5's five-intent sub-order)
// ===================================================================

function matchesEither(
  norm: Normalized,
  marker: string,
  locale: 'ko' | 'en',
): boolean {
  // en uses the boundary-checked matcher (collision #21: `we` ⊂ `owe`/
  // `owes`/`square`); ko does not — Korean particles/endings glue directly
  // onto a marker with no boundary at all (얼마+지, 남았+어), so a boundary
  // requirement there would reject the normal case, not the trap.
  if (locale === 'en') {
    return (
      hasWordPhrase(norm.text, marker) ||
      hasWordPhrase(norm.shadow, normalize(marker).shadow)
    )
  }
  return (
    hasPhrase(norm.text, marker) ||
    hasPhrase(norm.shadow, normalize(marker).shadow)
  )
}

interface RoleCheck {
  readonly hit: boolean
  /** True when this locale/intent has zero markers for the role — the AND-
   * leg is vacuously satisfied rather than an unreachable hard requirement
   * (spec §2.5's EN "my balance" bullet names no en 얼마-equivalent word,
   * and query.ts's data has no en `amountWord` row for that intent). */
  readonly vacuous: boolean
}

function anyRole(
  markers: readonly QueryMarkerEntry[],
  intent: string,
  role: QueryMarkerRole,
  norm: Normalized,
  locale: 'ko' | 'en',
): RoleCheck {
  const roleMarkers = markers.filter(
    (m) => m.intent === intent && m.role === role,
  )
  if (roleMarkers.length === 0) return { hit: true, vacuous: true }
  return {
    hit: roleMarkers.some((m) => matchesEither(norm, m.marker, locale)),
    vacuous: false,
  }
}

/**
 * QUERY_MY_SPENDING's `firstPerson` role, live-bug found while auditing
 * §3.7's GROUP_TOTAL corpus: ko's bare `나` marker (a single syllable) is
 * also the LAST syllable of `얼마나` ("how much/many") — `우리 얼마나
 * 썼어?` (a §3.7 GROUP_TOTAL row) was misreading as QUERY_MY_SPENDING
 * because `matchesEither`'s plain-substring ko matching found `나` inside
 * `얼마나`. en already can't have this problem (`matchesEither` uses the
 * both-sides-boundary `hasWordPhrase` for en unconditionally), so only ko
 * gets the leading-boundary-only check here (logged in docs/SOLVED.md).
 */
function firstPersonHit(
  markers: readonly QueryMarkerEntry[],
  norm: Normalized,
  locale: 'ko' | 'en',
): RoleCheck {
  const roleMarkers = markers.filter(
    (m) => m.intent === 'QUERY_MY_SPENDING' && m.role === 'firstPerson',
  )
  if (roleMarkers.length === 0) return { hit: true, vacuous: true }
  if (locale === 'en') {
    return {
      hit: roleMarkers.some((m) => matchesEither(norm, m.marker, locale)),
      vacuous: false,
    }
  }
  return {
    hit: roleMarkers.some(
      (m) =>
        hasLeadingBoundaryPhrase(norm.text, m.marker) ||
        hasLeadingBoundaryPhrase(norm.shadow, normalize(m.marker).shadow),
    ),
    vacuous: false,
  }
}

/**
 * Round-2 review (I1) — spec §2.6's "정산 얼마 남았어" worked example: a
 * D-7 subject word (모두/우리/누가/아직) combined with the literal
 * "정산...남았" frame is a settlement-PROGRESS question the app has no
 * state to answer, not the actor's own D-1 balance — even though `우리`
 * would otherwise satisfy GROUP_TOTAL's groupMarker+amountWord AND, and
 * `모두`/`아직`/`누가` would otherwise fall through to MY_BALANCE via
 * `정산`+`얼마`. `다들` is handled by the broader `다들 정산` DECOY_PHRASES
 * row (it also needs to cover `다들 정산 완료했어?`, which has no `남았`
 * at all), so it is intentionally excluded from this narrower check.
 */
function isD7SettleProgressQuestion(
  norm: Normalized,
  ctx: AssistantContext,
): boolean {
  if (ctx.locale !== 'ko') return false
  if (!norm.text.includes('정산') || !norm.text.includes('남았')) return false
  return D7_SETTLE_PROGRESS_SUBJECTS.some((s) => norm.text.includes(s))
}

/**
 * QUERY_HISTORY recognition — see lexicons/history.ts for the vocabulary
 * and the two accepted shapes (noun+show-verb, or essentially-bare noun).
 * 기록 immediately followed by 하/해/했/중 is the VERB "record", not the
 * noun, and never fires.
 */
/**
 * Normalized social-act matcher (2026-08-16, '안녕안녕' owner screenshot):
 * strips punctuation/emoji/whitespace and leading vocatives, then requires
 * the WHOLE remainder to be one stem repeated 1..n times with an optional
 * tail. Whole-remainder is what keeps '하이볼 8000원' and '안녕 커피
 * 5000원' out. Case-folded for latin stems.
 */
function matchSocialStem(input: string): 'greeting' | 'thanks' | 'farewell' | null {
  let text = input
    .toLowerCase()
    .replace(/[\s!?.,~^ㅋㅎ]+$/g, '')
    .replace(/[!?.,^]+/g, '')
    .replace(/[\p{Extended_Pictographic}]/gu, '')
    .trim()
  if (text === '') return null
  // Leading vocatives/interjections ("셈아 안녕", "야 안녕", "아 안녕").
  for (;;) {
    const lead = SMALL_TALK_LEADS.find(
      (l) => text.startsWith(l + ' ') || (text.startsWith(l) && text.length > l.length && /[\s]/.test(text[l.length] ?? '')),
    )
    if (!lead) break
    text = text.slice(lead.length).trim()
  }
  // A trailing vocative ("안녕 셈아").
  text = text.replace(/\s+(셈아|셈)$/g, '').trim()
  const compact = text.replace(/\s+/g, '')
  if (compact === '') return null
  for (const { stem, act } of SMALL_TALK_STEMS) {
    const st = stem.replace(/\s+/g, '')
    if (!compact.startsWith(st)) continue
    let rest = compact
    let reps = 0
    while (rest.startsWith(st)) {
      rest = rest.slice(st.length)
      reps++
    }
    if (reps === 0) continue
    // Optional tail (repeatable ~), nothing else.
    for (;;) {
      const tail = SMALL_TALK_TAILS.find((t) => rest.startsWith(t))
      if (!tail) break
      rest = rest.slice(tail.length)
    }
    if (rest === '') return act
  }
  return null
}

/**
 * ACTION_CREATE_WALLET — a wallet noun plus a creation verb ("지갑
 * 만들래", "엔화 지갑 추가해줘", "create a yen wallet"). Currency and
 * wallet type ride along when the sentence names them; the card asks for
 * the rest. A creation verb is what separates this from QUERY_WALLET's
 * remaining-word AND-group ("지갑 얼마 남았어"), so the two never race.
 */
const WALLET_NOUN_RE = /지갑|월렛|wallet/i
const WALLET_CREATE_RE = /만들|맹글|추가|개설|생성|새로|파줘|create|add|new|open/i
const WALLET_TYPE_WORDS: ReadonlyArray<{
  re: RegExp
  type: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID'
}> = [
  { re: /현금|캐시|cash/i, type: 'CASH' },
  { re: /교통|트래블|카드|card/i, type: 'TRAVEL_CARD' },
  { re: /선불|프리페이드|prepaid/i, type: 'OTHER_PREPAID' },
]
const WALLET_CURRENCY_WORDS: ReadonlyArray<{ re: RegExp; code: string }> = [
  { re: /엔화|엔|yen|jpy/i, code: 'JPY' },
  { re: /달러|불(?![가-힣])|usd|dollar/i, code: 'USD' },
  { re: /유로|eur/i, code: 'EUR' },
  { re: /원화|krw/i, code: 'KRW' },
  { re: /파운드|gbp|pound/i, code: 'GBP' },
]

function tryCreateWallet(norm: Normalized): Classified | null {
  const text = norm.text
  if (!WALLET_NOUN_RE.test(text) || !WALLET_CREATE_RE.test(text)) return null
  const currency = WALLET_CURRENCY_WORDS.find((w) => w.re.test(text))?.code ?? null
  const walletType = WALLET_TYPE_WORDS.find((w) => w.re.test(text))?.type ?? null
  return { intent: 'ACTION_CREATE_WALLET', currency, walletType }
}

/** First-person words that scope QUERY_HISTORY to "MY records" — checked
 *  against the text WITH the noun already removed (내역/사용내역 contain
 *  the syllable 내 themselves). Lives here, not in lexicons/history.ts:
 *  the lexicon files are DATA-only by contract (no regex literals). */
const HISTORY_MINE_RE = /(?<![가-힣])(내|나|저|제)(?![가-힣])|\bmy\b|\bi\b/i

/**
 * PAST consumption/purchase forms — what a history question says happened
 * ("수탉이랑 먹은 거", "커피 산 거"). Attributive/past only, so "뭐
 * 먹을까" (a plan) never reads as history. Single-syllable forms carry
 * boundary guards: 산 must not fire inside 부산, 간 inside 시간, 낸
 * inside 보낸.
 */
const CONSUMED_RE =
  /먹은|먹었|마신|마셨|시킨|시켰|나눈|나눴|긁은|긁었|결제한|결제했|샀|썼|냈|(?<![가-힣])산(?![가-힣])|(?<![가-힣])간(?![가-힣])|(?<![가-힣])낸(?![가-힣])|(?<![가-힣])쓴(?![가-힣])|(?<![가-힣])낀(?![가-힣])|갔/
/** PAY-verb subset of the above — a SUBJECT member + one of these means
 *  "expenses 수탉 PAID", not "shared with 수탉". */
const PAID_RE = /샀|(?<![가-힣])산(?![가-힣])|냈|(?<![가-힣])낸(?![가-힣])|결제|긁|쐈|지불/
/**
 * "give me the list" request markers — imperative, interrogative, or
 * bare-plural, in the shapes the variation corpus attests (보야줘 keeps
 * the owner's own typo working; 뭐 있/뭐뭐/샀더라 are the interrogative
 * family).
 */
const LIST_REQUEST_RE =
  /보여|보야|봐봐|줘봐|모아|정리|목록|리스트|전부|싹|것들|뭐 ?있|뭐뭐|뭐 ?샀|샀더라|뭐 ?먹었|뭐 ?마셨|알려|볼래|보자|(?<![가-힣])다(?![가-힣])|show|list|what did/i
/** The 얼마-gate override needs an EXPLICIT list word — "목록으로 줘"
 *  overrides, a bare 내역+얼마 question does not. */
const EXPLICIT_LIST_RE = /목록|리스트|보여|정리|모아|줘봐/
/** Nouns that never work as a keyword filter — grammatical props and the
 *  history nouns themselves. */
const KEYWORD_STOP = new Set([
  '거',
  '것',
  '것들',
  '지출',
  '지출들',
  '돈',
  '내역',
  '기록',
  '목록',
  '리스트',
  '전부',
  '어제',
  '오늘',
  '이번',
  '같이',
  '관련',
])

function tryHistory(norm: Normalized, ctx: AssistantContext): Classified | null {
  const lower = norm.text.toLowerCase()
  const listRequest = LIST_REQUEST_RE.test(lower)
  // A money-amount question belongs to the number-answering ladder —
  // UNLESS the sentence also EXPLICITLY asks for the list ("얼마짜리들이야
  // 목록으로 줘"), where the list wins.
  if (/얼마|how much/.test(lower) && !EXPLICIT_LIST_RE.test(lower)) return null

  // --- Path 1: the plain history noun ("사용내역", "내 기록 보여줘") ----
  const noun = HISTORY_NOUNS.filter((n) => n.locale === ctx.locale).find((n) => {
    const at = lower.indexOf(n.marker)
    if (at === -1) return false
    if (n.marker === '기록' && /^(하|해|했|중)/.test(lower.slice(at + n.marker.length))) {
      return false
    }
    return true
  })

  // --- Filter signals (R2a: '수탉과 먹은 지출 다 보여줘' family) --------
  const tokens = tokenize(norm.text)
  const people = findPeople(tokens, norm.text, ctx.members)
  const consumed = CONSUMED_RE.test(norm.text)
  const related = /관련/.test(norm.text)
  // findReference's surfaces serve the EDIT flow (아까/방금/그거); a
  // history question also says plain 오늘, which that closed set omits.
  const reference = findReference(tokens, norm.text, people)
  const window =
    reference?.value.window ??
    (/오늘|(?<![a-z])today/i.test(norm.text)
      ? ('today' as const)
      : /어제|어저께|yesterday/i.test(norm.text)
        ? ('yesterday' as const)
        : null)

  const filters: HistoryFilters = {}
  if (people.length > 0 && (consumed || related)) {
    const person = people[0]
    // Subject josa + a pay verb = they PAID; any companion marking (랑/
    // 하고/과), a bare name, or a non-pay consume verb = shared WITH them.
    if (person.role === 'subject' && PAID_RE.test(norm.text)) {
      filters.payerId = person.memberId
    } else {
      filters.companionId = person.memberId
    }
  }
  if (window !== null && window !== 'recent') {
    filters.window = window
  }
  // Keyword: the noun right around a consumption verb ("커피 산 거",
  // "마신 커피") or marked with 지출 ("커피 지출만") — never a member
  // name, never a grammatical prop.
  const memberSpans = people.map((p) => norm.text.slice(p.start, p.end))
  const keywordFrom = (m: RegExpExecArray | null): string | null => {
    const word = m?.[1]
    if (!word) return null
    if (KEYWORD_STOP.has(word)) return null
    if (memberSpans.some((s) => s.startsWith(word)) ) return null
    if (ctx.members.some((mm) => mm.name === word)) return null
    return word
  }
  const kw =
    keywordFrom(/([가-힣]{2,8})(?:을|를)?\s*(?:값)?\s*(?=산 |산거|산 거|마신|먹은|시킨|쓴 |쓴거|쓴 거)/.exec(norm.text)) ??
    keywordFrom(/(?:산|마신|먹은|시킨|쓴)\s+([가-힣]{2,8})/.exec(norm.text)) ??
    keywordFrom(/([가-힣]{2,8})\s*지출/.exec(norm.text))
  if (kw !== null) filters.keyword = kw

  const hasFilters = Object.keys(filters).length > 0

  if (!noun) {
    // No history noun: filters alone may still carry the question, but
    // ONLY as an explicit list request with a past consumption frame —
    // "수탉이랑 먹은 거 싹 다" fires, "수탉이랑 뭐 먹을까" never does.
    // 지출 itself is an expense signal ("커피 지출만 모아줘", "오늘 지출
    // 뭐 있어") even with no consumption verb.
    const expenseFrame = consumed || related || /지출/.test(norm.text)
    if (!hasFilters || !listRequest || !expenseFrame) return null
    return { intent: 'QUERY_HISTORY', scope: 'group', filters }
  }

  const rest = lower.replace(noun.marker, ' ')
  const showVerb =
    HISTORY_SHOW_VERBS.some(
      (v) => v.locale === ctx.locale && rest.includes(v.marker),
    ) || listRequest
  if (!showVerb && !hasFilters) {
    // Essentially-bare noun: after removing the noun, first-person words,
    // and filler/particles, (almost) nothing may remain.
    const residue = rest
      .replace(HISTORY_MINE_RE, ' ')
      .replace(/우리|전체|좀|다|것|거|요|은|는|을|를|이|가|의|\s|[?.!~]/g, '')
    if (residue.length > 1) return null
  }
  const mine = HISTORY_MINE_RE.test(rest)
  return { intent: 'QUERY_HISTORY', scope: mine ? 'mine' : 'group', filters }
}

function tryQuery(norm: Normalized, ctx: AssistantContext): Classified | null {
  // Query sentences are QUESTIONS about an unknown amount — none of the
  // attested QUERY_CORPUS rows carry a literal parseable amount. Gating out
  // real-amount inputs here is what keeps an ordinary expense fragment like
  // `기름값 4만원 민수랑 반반` (member + 랑, which is ALSO the PAIRWISE
  // dative particle) from being mistaken for `QUERY_PAIRWISE`.
  if (extractAmount(norm.text, ctx.defaultCurrency) !== null) return null

  // §2.6/§6 ruled-always-UNKNOWN phrases (D-7 정산 진행 상태, 모임통장/회비,
  // denomination/budget/conversion questions, one thin-signal en
  // ambiguity) — checked FIRST. Several of these would otherwise
  // false-positive into a real query AND-group below (`다들 정산 얼마
  // 남았어` carries both a payFrame `정산` and amountWord `얼마`; `이번 달
  // 회비 총 얼마 걷혔어` carries both a groupMarker `총` and amountWord
  // `얼마`) — §2.6's own worked example rules these must never be answered
  // as if they were the D-1/D-3 question they textually resemble.
  const decoy = DECOY_PHRASES.find(
    (d) => d.locale === ctx.locale && matchesEither(norm, d.phrase, ctx.locale),
  )
  if (decoy) {
    return { intent: 'UNKNOWN', hold: false, suggest: decoy.suggest }
  }
  // Round-2 review (I1): the D-7 subject+정산 frame — §2.6's own
  // "정산 얼마 남았어" ruling names 다들(covered above)/모두/우리/누가/아직
  // as the subject words that force a D-7 (settlement-progress) reading;
  // NARROWLY scoped to sentences that literally combine `정산` with a
  // remaining-word (`남았`), since `우리`/`아직`/`누가` are each legitimate
  // signals in other, unrelated attested rows.
  if (isD7SettleProgressQuestion(norm, ctx)) {
    return {
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
    }
  }

  const ms = QUERY_MARKERS_ALL.filter((m) => m.locale === ctx.locale)

  // 0. HISTORY — "show me the record" (owner screenshot 2026-08-14:
  // 사용내역/내 기록 fell to the confused menu). Checked first so "내가 쓴
  // 내역 보여줘" answers with the LIST it asked for rather than
  // MY_SPENDING's single total — but it politely steps aside for any
  // sentence carrying 얼마/how much, which is asking for a NUMBER and
  // belongs to the ladder below.
  const history = tryHistory(norm, ctx)
  if (history) return history

  // 1. WALLET — (walletNoun OR walletCurrencyName) AND walletRemaining.
  const walletNoun = ms.find(
    (m) =>
      m.intent === 'QUERY_WALLET' &&
      (m.role === 'walletNoun' || m.role === 'walletCurrencyName') &&
      matchesEither(norm, m.marker, ctx.locale),
  )
  const walletRemaining = anyRole(
    ms,
    'QUERY_WALLET',
    'walletRemaining',
    norm,
    ctx.locale,
  )
  if (walletNoun && walletRemaining.hit) {
    return { intent: 'QUERY_WALLET', currency: walletNoun.currencyCode ?? null }
  }

  // 2. PAIRWISE — a bound member name AND (particle OR owe-frame OR §2.6's
  // negated-completion/pay-back frame: 안 냈/안 보냈/pay me back/paid me
  // back). All QUERY_PAIRWISE roles OR together here by design — §2.5's
  // sub-order names two roles in prose, but nothing in the AND-group model
  // requires treating them separately, and §2.6 adds a third by the same
  // "named -> pairwise" mechanism.
  //
  // Round-2 review (I3): a bound name plus a BARE companion/dative particle
  // (한테/에게/랑/이랑) alone is NOT enough — `민수랑 밥 먹었어` ("ate
  // dinner with Minsu") has a name and a particle but is not a question at
  // all, and used to wrongly fire QUERY_PAIRWISE. Now also requires at
  // least one query-marker hit that ISN'T just the particle — an
  // interrogative/얼마/owe-frame/정산/etc, from ANY intent's role, not only
  // PAIRWISE's own. `firstPerson` is excluded too, found live while
  // verifying this fix: `민수랑 유나만` matched MY_SPENDING's bare `나`
  // marker INSIDE the member name `유나` itself (유+나+만), which is the
  // same class of substring collision `firstPersonHit`'s leading-boundary
  // check exists for elsewhere — bare 나/내가/제가 was never in the
  // reviewer's own valid-signal list (interrogative/얼마/owe-frame/정산)
  // anyway. Verified against all 47 §3.6 main+확장 rows (26+3 ko, 15+3 en):
  // every one already carries 얼마, an oweFrame (주면/줘야/받을/owe/square/
  // settle), 정산, or a negatedFrame (안 냈/안 보냈/pay me back/paid me
  // back) alongside the particle, so none needed the particle ALONE to
  // fire — this tightening costs nothing against the attested table
  // (details in task-4-report.md).
  const hits = findMembers(norm.text, ctx.members)
  const oweOrParticle = ms.some(
    (m) =>
      m.intent === 'QUERY_PAIRWISE' &&
      matchesEither(norm, m.marker, ctx.locale),
  )
  // `paidVerb` is excluded for the same reason `firstPerson` is, found by the
  // Task 11 corpus: 냈/샀/썼 are what an EXPENSE says, not what a QUESTION
  // asks. "유나가 민수랑 냈어" ("Yuna paid, with Minsu") carries a name, a
  // companion 랑, and the paidVerb 냈 — and no question at all — yet used to
  // come back as "how do Yuna and I stand?". The reviewer's own valid-signal
  // list for this gate was interrogative / 얼마 / owe-frame / 정산; a bare
  // paid-verb was never on it, and MY_SPENDING still reads paidVerb in its own
  // AND-group below, where a firstPerson marker corroborates it.
  const nonParticleQuerySignal = ms.some(
    (m) =>
      m.role !== 'pairwiseParticle' &&
      m.role !== 'firstPerson' &&
      m.role !== 'paidVerb' &&
      matchesEither(norm, m.marker, ctx.locale),
  )
  if (hits.length > 0 && oweOrParticle && nonParticleQuerySignal) {
    return { intent: 'QUERY_PAIRWISE', memberId: hits[0].id }
  }

  // 3. MY_SPENDING — firstPerson AND paidVerb; the view slot narrows to
  // 'ahead'/'consumed' when a further marker names that specific
  // sub-question, defaulting to 'paid'.
  const firstPerson = firstPersonHit(ms, norm, ctx.locale)
  const paidVerb = anyRole(
    ms,
    'QUERY_MY_SPENDING',
    'paidVerb',
    norm,
    ctx.locale,
  )
  if (
    firstPerson.hit &&
    paidVerb.hit &&
    !(firstPerson.vacuous && paidVerb.vacuous)
  ) {
    const ahead = ms.some(
      (m) =>
        m.intent === 'QUERY_MY_SPENDING' &&
        m.role === 'aheadFrame' &&
        matchesEither(norm, m.marker, ctx.locale),
    )
    const consumed = ms.some(
      (m) =>
        m.intent === 'QUERY_MY_SPENDING' &&
        m.role === 'consumedFrame' &&
        matchesEither(norm, m.marker, ctx.locale),
    )
    return {
      intent: 'QUERY_MY_SPENDING',
      view: ahead ? 'ahead' : consumed ? 'consumed' : 'paid',
    }
  }

  // 4. GROUP_TOTAL — a dedicated transfersFrame ("who owes X") answers the
  // settle-up-plan sub-question directly (view:'transfers'), structurally
  // different from "how much" (the usual groupMarker AND amountWord,
  // view:'total').
  const transfersFrame = ms.some(
    (m) =>
      m.intent === 'QUERY_GROUP_TOTAL' &&
      m.role === 'transfersFrame' &&
      matchesEither(norm, m.marker, ctx.locale),
  )
  if (transfersFrame) {
    return { intent: 'QUERY_GROUP_TOTAL', view: 'transfers' }
  }
  const groupMarker = anyRole(
    ms,
    'QUERY_GROUP_TOTAL',
    'groupMarker',
    norm,
    ctx.locale,
  )
  const amountWord = anyRole(
    ms,
    'QUERY_GROUP_TOTAL',
    'amountWord',
    norm,
    ctx.locale,
  )
  if (
    groupMarker.hit &&
    amountWord.hit &&
    !(groupMarker.vacuous && amountWord.vacuous)
  ) {
    return { intent: 'QUERY_GROUP_TOTAL', view: 'total' }
  }

  // 5. MY_BALANCE — a dedicated whoFrame ("누구한테"/"who do I") answers the
  // "who do I pay" sub-question directly (view:'who'), structurally
  // different from "how much" (the usual amountWord AND balancePayFrame,
  // view:'amount'; en has no standalone amountWord marker at all — see
  // query.ts's data — so that leg is vacuously satisfied for en, matching
  // §2.5's prose which lists no en "얼마"-equivalent for this intent).
  const whoFrame = ms.some(
    (m) =>
      m.intent === 'QUERY_MY_BALANCE' &&
      m.role === 'whoFrame' &&
      matchesEither(norm, m.marker, ctx.locale),
  )
  if (whoFrame) {
    return { intent: 'QUERY_MY_BALANCE', view: 'who' }
  }
  const amountWord2 = anyRole(
    ms,
    'QUERY_MY_BALANCE',
    'amountWord',
    norm,
    ctx.locale,
  )
  const payFrame = anyRole(
    ms,
    'QUERY_MY_BALANCE',
    'balancePayFrame',
    norm,
    ctx.locale,
  )
  if (
    amountWord2.hit &&
    payFrame.hit &&
    !(amountWord2.vacuous && payFrame.vacuous)
  ) {
    return { intent: 'QUERY_MY_BALANCE', view: 'amount' }
  }

  return null
}

// ===================================================================
// P5 — EXPENSE_ENTRY (§2.3 P5) — delegates wholesale to chat-parse's parse()
// ===================================================================

/**
 * `hasPayVerb` (chat-parse) is deliberately loose for `계산`/`결제` (a false
 * hit inside a noun like `계산서`/`계산기` is harmless for `resolvePayer`'s
 * purpose). At THIS gate it is not harmless — layers spec §3.1's
 * verbalizing-suffix rule on top, without duplicating `hasPayVerb`'s other
 * words (냈/냄/샀/쐈/paid/bought stay trusted as-is: removing the ambiguous
 * stems and checking if `hasPayVerb` still fires proves one of those was
 * the reason, independent of retyping the list).
 */
function hasGenuinePayVerb(text: string): boolean {
  if (!hasPayVerb(text)) return false
  const withoutStems = PAY_VERB_STEMS.reduce(
    (s, stem) => s.split(stem.word).join(''),
    text,
  )
  if (hasPayVerb(withoutStems)) return true
  for (const stem of PAY_VERB_STEMS) {
    let from = 0
    while (true) {
      const at = text.indexOf(stem.word, from)
      if (at === -1) break
      const after = text.slice(at + stem.word.length)
      if (VERBALIZING_SUFFIXES.some((s) => after.startsWith(s))) return true
      from = at + stem.word.length
    }
  }
  return false
}

/**
 * spec §2.3 P5's second OR-branch's "pay-verb hit," widened with two
 * additional signals also needed for §3.1's main table (documented, not
 * spec-literal): a real cash/wallet funding read (`parse()`'s own
 * `funding` field — no separate cash word list to duplicate/drift), and a
 * bare digit alongside a bound member name (`gas 40 bucks me and Sam` — no
 * pay-verb, no split word, but chat-parse's own 3+-digit floor rejects "40"
 * as a formal amount; requiring a digit, not just a name, is what keeps
 * `민수 빼고 다들 정산했어?`, which has no digit at all, from qualifying).
 * review I3: both `hasGenuinePayVerb`/`hasSplitKeyword` are tried against
 * the shadow too.
 */
function hasExpenseSignal(
  norm: Normalized,
  ctx: AssistantContext,
  parsed: ReturnType<typeof parse>,
): boolean {
  if (hasGenuinePayVerb(norm.text) || hasGenuinePayVerb(norm.shadow)) {
    return true
  }
  if (hasSplitKeyword(norm.text) || hasSplitKeyword(norm.shadow)) return true
  if (parsed.funding === 'NEW_CASH_WALLET') return true
  if (/\d/.test(norm.text) && findMembers(norm.text, ctx.members).length > 0) {
    return true
  }
  return false
}

// ===================================================================
// P4.5 — EDIT_EXPENSE (goat branch: context commands)
// ===================================================================

/**
 * A context command against an ALREADY-SAVED expense ("아까 그 술값에 민수도
 * 껴줘"), read entirely from the two new parsers — this function adds no
 * vocabulary of its own.
 *
 * Three conditions, all required, and each one is load-bearing:
 *  - NO card is open. With a card on screen the live interpretation of an
 *    edit is always the draft in front of the user, so P2/CONFIRM_MODIFY owns
 *    it (a bare `민수도 껴줘` with a card open must stay CONFIRM_MODIFY). The
 *    check lives in `classify()`'s control flow, not here.
 *  - A REFERENCE word is present. Without one the sentence is not pointing at
 *    anything, and an edit with nothing to edit is exactly the confidently
 *    wrong action this layer exists to refuse.
 *  - An ACTION binds. A reference alone ("아까 그 술값 얼마였지?") is a
 *    question, not an instruction.
 *
 * Placed BEFORE P5 rather than merely "before UNKNOWN": an edit sentence may
 * legitimately carry an amount ("그거 3만원으로 바꿔줘"), and P5 would open a
 * NEW expense card for it — booking a second 30,000원 instead of correcting
 * the first. Requiring reference AND action is what keeps ordinary expense
 * entry (which has neither) out of this rung.
 *
 * An amount NO action consumed hands the sentence back to P5 (controller
 * ruling). "어제 점심 3만원 민수도 추가해줘" is a new expense being entered with
 * its participants named in the same breath — the amount is the evidence that
 * a NEW expense is being described, and an edit that quietly discarded it
 * would lose the only number in the sentence. `changeAmount` is the one action
 * that consumes an amount, so it is unaffected: "그거 3만원으로 바꿔줘" stays an
 * edit.
 */
/**
 * Sentence boundaries, for the one-sentence rule below. A `.` BETWEEN DIGITS
 * is not one — "$5.00" and "3.5만원" are single numbers, and cutting them in
 * half would hand the amount parser two fragments.
 */
const SENTENCE_BREAK = /[.!?]+(?!\d)|\n+/

/**
 * An edit command lives in ONE sentence: it points at a saved expense and asks
 * for one change, in the same breath. So each sentence is read on its own and
 * the first that yields BOTH a reference and an action wins.
 *
 * Without that rule the two halves can come from anywhere in a long message,
 * and a message that is not addressed to this app at all can assemble one out
 * of unrelated parts. The Task 11 fuzz corpus has the worked example: a
 * five-sentence movie review whose first sentence says 방금 (a `today` window)
 * and 티비 (a keyword), and whose third says 넣어주라 (an add request) about
 * subtitles — read together, "add me to today's TV expense". Read one sentence
 * at a time, neither half is an edit and the message correctly resolves to
 * nothing.
 *
 * The cost is an edit deliberately spread over two sentences ("아까 그 술값
 * 있잖아. 민수도 껴줘"), which now asks instead of acting — the safe direction,
 * and the same one every other refusal in this layer takes.
 */
function tryEdit(input: string, ctx: AssistantContext): Classified | null {
  for (const sentence of input.split(SENTENCE_BREAK)) {
    const hit = tryEditInSentence(sentence, ctx)
    if (hit) return hit
  }
  return null
}

function tryEditInSentence(input: string, ctx: AssistantContext): Classified | null {
  const tokens = tokenize(input)
  const people = findPeopleWithActor(tokens, input, ctx.members, ctx.actorId)
  // Amounts are read BEFORE the reference so `findReference` can skip the
  // span they claimed: "그거 삼만원으로 바꿔줘" otherwise takes 삼만원 for the
  // keyword the reference is about, which matches no note and forces a
  // `'none'` on a sentence the plain `recent` window resolves (T10 mandate C).
  const amounts = findAmounts(tokens, input, ctx.defaultCurrency)
  const reference = findReference(tokens, input, people, amounts)
  if (!reference) return null
  const action = findEditAction(tokens, input, people, amounts)
  if (!action) return null
  if (action.kind !== 'changeAmount' && amounts.length > 0) return null
  return { intent: 'EDIT_EXPENSE', reference: reference.value, action }
}

// ===================================================================
// P4/P6 — HELP, UNKNOWN → GUIDED
// ===================================================================

function tryHelp(norm: Normalized, ctx: AssistantContext): boolean {
  return HELP_MARKERS.some(
    (m) => m.locale === ctx.locale && matchesEither(norm, m.marker, ctx.locale),
  )
}

/**
 * Round-2 review (I2) — §4.8's partial-hit ranking, a named T4 deliverable.
 * Reached only once EVERY earlier ladder step (P1-P5, plus P6's own
 * DECOY_PHRASES/D-7/NEITHER_TOKENS checks) has already declined: nothing
 * fully resolved, but some intent's DISTINGUISHING marker role partially
 * matched anyway (`내 지갑` never completes WALLET's walletNoun+
 * walletRemaining AND, but `지갑` alone is still a real signal worth
 * surfacing). Ranked by §4.8's stated priority order
 * (PAIRWISE > WALLET > MY_SPENDING > GROUP_TOTAL > MY_BALANCE >
 * EXPENSE_ENTRY > HELP), capped at 3. Zero partial hits keeps the existing
 * single `['HELP']` fallback — the §3 tables' own zero-signal rows
 * (`커피 2`, `ok`, …) are pinned to exactly that value, not a padded
 * 3-item triple (recorded as an erratum in docs/DECISIONS.md).
 *
 * Role choices are deliberately narrower than the full AND-group, each
 * picked to avoid re-breaking an already-pinned `suggest:['HELP']` row:
 * - WALLET signals on walletNoun/walletCurrencyName only — NOT
 *   walletRemaining (남았/있어/left/balance are too generic alone;
 *   `계산기 어디 있어?`'s pinned `['HELP']` would otherwise flip).
 * - GROUP_TOTAL signals on groupMarker only — NOT amountWord (얼마 is
 *   shared with MY_BALANCE; a bare `얼마` is meant to suggest MY_BALANCE
 *   per the reviewer's own worked example, not GROUP_TOTAL).
 * - MY_SPENDING signals on paidVerb only — NOT firstPerson (bare
 *   나/내가/제가 are too generic, and firstPerson already has its own
 *   `얼마나` substring trap, see docs/SOLVED.md).
 * - MY_BALANCE signals on amountWord OR balancePayFrame OR whoFrame.
 * - PAIRWISE signals on a bound member name alone (a name WAS mentioned,
 *   even when I3's tightened gate correctly declined to answer it).
 * - EXPENSE_ENTRY signals per §4.8's own rule verbatim: `parse()` found an
 *   amount or a genuine pay-verb hit.
 */
function rankedGuidedSuggest(
  norm: Normalized,
  ctx: AssistantContext,
  parsed: ReturnType<typeof parse>,
): readonly Intent[] {
  const ms = QUERY_MARKERS_ALL.filter((m) => m.locale === ctx.locale)
  const roleHit = (intent: string, roles: readonly QueryMarkerRole[]) =>
    ms.some(
      (m) =>
        m.intent === intent &&
        roles.includes(m.role) &&
        matchesEither(norm, m.marker, ctx.locale),
    )
  const signals: ReadonlyArray<readonly [Intent, boolean]> = [
    ['QUERY_PAIRWISE', findMembers(norm.text, ctx.members).length > 0],
    [
      'QUERY_WALLET',
      roleHit('QUERY_WALLET', ['walletNoun', 'walletCurrencyName']),
    ],
    ['QUERY_MY_SPENDING', roleHit('QUERY_MY_SPENDING', ['paidVerb'])],
    ['QUERY_GROUP_TOTAL', roleHit('QUERY_GROUP_TOTAL', ['groupMarker'])],
    [
      'QUERY_MY_BALANCE',
      roleHit('QUERY_MY_BALANCE', [
        'amountWord',
        'balancePayFrame',
        'whoFrame',
      ]),
    ],
    [
      'EXPENSE_ENTRY',
      parsed.amount !== null ||
        hasGenuinePayVerb(norm.text) ||
        hasGenuinePayVerb(norm.shadow),
    ],
  ]
  const ranked = signals
    .filter(([, hit]) => hit)
    .map(([intent]) => intent)
    .slice(0, 3)
  return ranked.length > 0 ? ranked : ['HELP']
}

// ===================================================================
// Entry point
// ===================================================================

export function classify(input: string, ctx: AssistantContext): Classified {
  const norm = normalize(input)

  // HOLD — spec §2.6: never a cancel, checked whole-input only (collision
  // #6: `wait no, 50` must NOT hold just because it starts with `wait`).
  const holdHit = HOLD_TOKENS.find(
    (t) => t.locale === ctx.locale && eitherEqualsToken(norm, t.token),
  )
  if (holdHit) return { intent: 'UNKNOWN', hold: true, suggest: [] }

  // Social acts — whole-input equality only, and only with no card open
  // (mid-card, 확인/취소 vocabulary keeps priority and a greeting inside a
  // task sentence never matches whole-input anyway). Owner screenshot
  // 2026-08-14: "안녕" must be greeted back, not answered with the
  // confused-ack menu.
  if (ctx.openCard === null) {
    const social =
      SMALL_TALK_TOKENS.find(
        (t) => t.locale === ctx.locale && eitherEqualsToken(norm, t.token),
      )?.act ?? matchSocialStem(input)
    if (social) return { intent: 'SMALL_TALK', act: social }

    // Chat actions (prime directive 2026-08-14: everything doable in the
    // app must be doable in chat). "지갑 만들래/엔화 지갑 추가해줘" opens
    // the wallet-create card with whatever slots the sentence stated.
    const wallet = tryCreateWallet(norm)
    if (wallet) return wallet
  }

  if (ctx.openCard !== null) {
    // P1
    const yes = CONFIRM_TOKENS.find(
      (t) => t.locale === ctx.locale && eitherEqualsToken(norm, t.token),
    )
    // A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차"): the dedicated
    // crossCurrency card kind (round-2 review M11) is gone — a foreign-
    // currency parse is an ordinary `confirm` card now, so CONFIRM_YES
    // always confirms it, same as any other card. No `OpenCard` kind left
    // needs special-casing here any more.
    if (yes) return { intent: 'CONFIRM_YES' }
    const no = NEGATE_TOKENS.find(
      (t) => t.locale === ctx.locale && eitherEqualsToken(norm, t.token),
    )
    if (no) return { intent: 'CONFIRM_NO_CANCEL' }

    // NEITHER (cardOpen) — appendix-G traps that must stay ambiguous, not YES/NO.
    const neither = NEITHER_TOKENS.find(
      (t) =>
        t.context === 'cardOpen' &&
        t.locale === ctx.locale &&
        eitherEqualsToken(norm, t.token),
    )
    if (neither)
      return { intent: 'UNKNOWN', hold: false, suggest: neither.suggest }

    // P2
    if (ctx.openCard.kind === 'items') {
      // The items card offers two modify slots — a per-line price and a
      // per-line assignment; price wins when an amount is present. The
      // draft-field family below has no defined meaning against it.
      const ip = tryItemPrice(input, norm, ctx.openCard.lines, ctx)
      if (ip) return { intent: 'CONFIRM_MODIFY', ...ip }
      const ia = tryItemAssign(input, ctx.openCard.lines, ctx)
      if (ia) return { intent: 'CONFIRM_MODIFY', ...ia }
    } else {
      const m = tryModify(norm, ctx)
      if (m) {
        if ('needsCompanion' in m) {
          return { intent: 'UNKNOWN', hold: false, suggest: ['CONFIRM_MODIFY'] }
        }
        return { intent: 'CONFIRM_MODIFY', ...m }
      }
    }
  }

  // P3
  // R4 QUERY_EXPLAIN — checked BEFORE tryQuery: its sentences often carry a
  // literal amount ("왜 내가 만원이야"), which tryQuery's no-amount gate
  // would silently eat. A why/how-word plus a settlement/money context word
  // is required; bare 왜 ("왜 안 와?") never fires.
  if (
    ctx.openCard === null &&
    /왜|어째서|어떻게|근거|why|how come/i.test(norm.text) &&
    /내가|내 몫|몫|이만큼|이렇게 나|계산|나온 거|나왔|많이 내|owe|charged|share/i.test(
      norm.text,
    )
  ) {
    return { intent: 'QUERY_EXPLAIN' }
  }
  const q = tryQuery(norm, ctx)
  if (q) return q

  // P4
  if (tryHelp(norm, ctx)) return { intent: 'HELP' }

  // P4.5 — context commands. Only reachable with NO card open (an open card
  // owns every edit-shaped sentence, per P2), and only when the sentence both
  // POINTS at a saved expense and ASKS for something. Runs on the raw input,
  // like P5's `parse()` — the new parsers work off spans in the original
  // string, which `normalize()`'s shadow would invalidate.
  if (ctx.openCard === null) {
    const edit = tryEdit(input, ctx)
    if (edit) return edit
  }

  // P5 — delegates wholesale to parse(); classify() never re-specifies
  // entry. review I2: restores the spec conjunct (amount OR (non-empty
  // description AND a genuine expense signal)) — a bare member/split-word/
  // cash-word mention with nothing else (empty description) never opens an
  // expense card on its own.
  const parsed = parse(input, ctx)
  if (
    parsed.amount !== null ||
    (parsed.description !== '' && hasExpenseSignal(norm, ctx, parsed))
  ) {
    return { intent: 'EXPENSE_ENTRY', parsed }
  }

  // P6 — review M12: with a card open, the two live interpretations are
  // still confirm/cancel, not a HELP pointer (the noCard NEITHER_TOKENS
  // family — 글쎄/음/흠/... — is scoped to no-card GUIDED reads by its own
  // naming, so it's skipped entirely once a card is open).
  if (ctx.openCard === null) {
    const decoy = NEITHER_TOKENS.find(
      (t) =>
        t.context === 'noCard' &&
        t.locale === ctx.locale &&
        eitherEqualsToken(norm, t.token),
    )
    if (decoy) return { intent: 'UNKNOWN', hold: false, suggest: decoy.suggest }
    // Topic-engaged UNKNOWN (2026-08-14): "정산할래" names the domain
    // without a request — the reply opens engaged with the topic instead
    // of the confused ack. Detection is a substring on the normalized
    // text: the topic word colors the reply, it claims nothing else.
    const topic = GUIDED_TOPICS.find(
      (t) =>
        t.locale === ctx.locale &&
        (norm.text.toLowerCase().includes(t.pattern) ||
          norm.shadow.toLowerCase().includes(t.pattern)),
    )
    return {
      intent: 'UNKNOWN',
      hold: false,
      suggest: rankedGuidedSuggest(norm, ctx, parsed),
      ...(topic ? { topic: topic.topic } : {}),
    }
  }
  return {
    intent: 'UNKNOWN',
    hold: false,
    suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
  }
}
