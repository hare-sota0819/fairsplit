import type { ParseHit } from '../engine/hits'
import type { Token } from '../engine/tokens'
import { detachJosa } from '../ko/josa'
import { isEditActionWord } from './edit'
import type { PersonHit } from './people'

/**
 * Reference parser: the part of a context command that points at an expense
 * that already exists ("아까 그 술값에", "yesterday's taxi", "그거").
 *
 * A reference is TWO pieces of information, and they are read separately:
 *  - `window` — how far back to look, straight off the reference word itself.
 *    It is a CLOSED set (아까/방금/그거/어제 + en that/earlier/yesterday's),
 *    enumerated here in full; an unknown word yields no reference at all,
 *    which is what keeps ordinary chat from ever reaching an EDIT intent.
 *  - `keyword` — the noun the reference is ABOUT (술값, taxi), or null when
 *    the sentence names none ("그거 3만원으로 바꿔줘"). Never guessed: only a
 *    plain noun immediately after the reference qualifies, and generic
 *    stand-ins (거/지출/expense/one) are stopwords, not keywords.
 *
 * `resolveReference` (assistant/context-commands.ts) is what turns the pair
 * into candidate expenses. This file decides nothing about which expense is
 * meant — it does not even see the expense list.
 */

export type TimeWindow = 'today' | 'yesterday' | 'recent'

export type ReferenceHit = ParseHit<'reference', { window: TimeWindow; keyword: string | null }>

interface ReferenceEntry {
  surface: string
  window: TimeWindow
  script: 'ko' | 'en'
}

/**
 * The closed reference set.
 *
 * 그거/그것 take an ordinary josa (그거를/그것도), which the josa grammar
 * handles; 그건/그걸 are CONTRACTIONS (그거+는, 그거+를) that no josa split can
 * produce, so they are listed as their own surfaces. 아까/방금 mean "a moment
 * ago" — the same device-local DAY, hence `today` rather than a clock window
 * this layer has no way to honour (the resolver works in whole local days,
 * like the rest of the repo's date handling).
 *
 * DELIBERATELY EXCLUDED: 이거/이것/this ("this one"). Korean 이- points at
 * what is in front of the speaker — the card on screen, the message just
 * typed — not at something in the past, which is what 그- does. With a card
 * open, `이거 취소해줘` is the card's own cancel (P1/P2 territory, and this
 * rung never runs there anyway); with NO card open there is nothing present
 * for it to point at, so admitting it would turn every `이거 취소해줘` into a
 * blind edit of whatever happens to be newest. It IS listed in edit.ts's
 * `KO_EXPENSE_OBJECT`, where its only job is to say that a removal targets
 * the expense rather than a person — a much weaker claim than pointing at a
 * specific row.
 */
const REFERENCE_ENTRIES: readonly ReferenceEntry[] = [
  { surface: '아까', window: 'today', script: 'ko' },
  { surface: '방금', window: 'today', script: 'ko' },
  { surface: '어제', window: 'yesterday', script: 'ko' },
  { surface: '어저께', window: 'yesterday', script: 'ko' },
  { surface: '그거', window: 'recent', script: 'ko' },
  { surface: '그것', window: 'recent', script: 'ko' },
  { surface: '그건', window: 'recent', script: 'ko' },
  { surface: '그걸', window: 'recent', script: 'ko' },
  { surface: 'that', window: 'recent', script: 'en' },
  { surface: 'earlier', window: 'today', script: 'en' },
  { surface: 'yesterday', window: 'yesterday', script: 'en' },
]

/** Longest-first, so 어저께 wins over a hypothetical shorter prefix. */
const KO_ENTRIES = REFERENCE_ENTRIES.filter((e) => e.script === 'ko').sort(
  (a, b) => b.surface.length - a.surface.length,
)
const EN_ENTRIES = REFERENCE_ENTRIES.filter((e) => e.script === 'en')

/**
 * Demonstratives that may sit between the reference word and its noun ("아까
 * 그 술값", "the one from earlier"), plus the English determiners of the same
 * frame. Skipped on the way to the keyword; never keywords themselves.
 */
const KO_FILLER = ['그', '저', '이']
const EN_FILLER = ['the', 'one', 'from', 'a', 'my', 'our']

/**
 * Words that end the keyword search with NO keyword.
 *
 * Two kinds, both meaning "the sentence named no category here":
 *  - generic stand-ins for the expense itself (거/지출/expense/thing) — "that
 *    expense" names no category, so the resolver falls back to the plain time
 *    window; treating `expense` as a keyword would match no note at all and
 *    turn every English cancel into a forced 'none'.
 *  - the English prepositions that introduce the CHANGE, not the expense
 *    ("set that to 40 dollars", "make that 30 bucks") — `to`/`of`/`for` are
 *    never a category, and taking one as the keyword had exactly the failure
 *    above: a guaranteed 'none' where a plain `recent` window would have
 *    resolved.
 */
const KEYWORD_STOPWORDS = [
  '거',
  '것',
  '건',
  '지출',
  '내역',
  '돈',
  'expense',
  'expenses',
  'thing',
  'it',
  'this',
  'purchase',
  'charge',
  'to',
  'of',
  'for',
]

/** The possessive that English hangs on a date word ("yesterday's taxi"). */
const POSSESSIVE_PUNCT = ["'", '’']

/** A span another parser already accounted for. Structural on purpose — both
 *  `PersonHit` and an amount `ParseHit` satisfy it, so this file imports
 *  neither shape's owner just to name it. */
interface ClaimedSpan {
  start: number
  end: number
}

function koEntryAt(token: Token): ReferenceEntry | null {
  for (const entry of KO_ENTRIES) {
    if (token.text === entry.surface) return entry
    if (!token.text.startsWith(entry.surface)) continue
    // A josa is the only thing allowed to ride along: 어제부터/그거를 are the
    // reference word, 아까워 (an adjective that merely starts with 아까) is
    // not. `detachJosa` is the repo's mined inventory — no second list here.
    const split = detachJosa(token.text)
    if (split && split.stem === entry.surface) return entry
  }
  return null
}

function enEntryAt(token: Token): ReferenceEntry | null {
  const lowered = token.text.toLowerCase()
  return EN_ENTRIES.find((entry) => entry.surface === lowered) ?? null
}

function entryAt(token: Token): ReferenceEntry | null {
  if (token.kind === 'hangul') return koEntryAt(token)
  if (token.kind === 'latin') return enEntryAt(token)
  return null
}

/** The word a candidate keyword token really is: its Korean stem with any
 *  josa detached (술값에 → 술값), or the case-folded latin token. */
function keywordOf(token: Token): string {
  if (token.kind !== 'hangul') return token.text.toLowerCase()
  return detachJosa(token.text)?.stem ?? token.text
}

function isFiller(token: Token): boolean {
  const word = keywordOf(token)
  if (token.kind === 'hangul') return KO_FILLER.includes(word)
  return EN_FILLER.includes(word)
}

/**
 * The noun the reference is about, starting the search just past the
 * reference word.
 *
 * Only the FIRST content word after the reference qualifies, and only when it
 * is a plain noun: an action word ("아까 취소해줘"), a generic stand-in ("that
 * expense"), another reference word ("아까 그거"), a number or any punctuation
 * ends the search with null. That narrowness is the point — a keyword is used
 * to NARROW the candidate list, so a wrong one silently hides the expense the
 * user meant, while no keyword at all just shows them the window.
 *
 * A span another parser already claimed is SKIPPED, not taken and not treated
 * as a boundary. Two kinds, for the same reason:
 *  - `findPeople`'s member spans: in "아까 민수 술값에 유나도 껴줘" the 민수 is
 *    who the edit is about, and the noun the reference points at is the 술값
 *    behind it.
 *  - `findAmounts`'s amount spans: in "그거 삼만원으로 바꿔줘" the 삼만원 is what
 *    the expense is being changed TO, not what it is about — taken as the
 *    keyword it matches no note and forces a `'none'` on a sentence the plain
 *    `recent` window resolves. (A digit-written amount was already safe: the
 *    `digits` branch below ends the search with no keyword. A Korean
 *    number-word is one ordinary hangul token, so only the claimed-span check
 *    catches it.)
 *
 * Both span lists are passed in rather than re-derived — one number parser and
 * one name parser, read here, never a second copy of either.
 */
function findKeyword(
  tokens: Token[],
  from: number,
  people: readonly PersonHit[],
  amounts: readonly ClaimedSpan[],
): { keyword: string; end: number } | null {
  const overlaps = (token: Token, span: ClaimedSpan): boolean =>
    token.start < span.end && token.end > span.start
  const claimed = (token: Token): boolean =>
    people.some((hit) => overlaps(token, hit)) ||
    amounts.some((hit) => overlaps(token, hit))
  let i = from
  while (i < tokens.length) {
    const token = tokens[i]
    if (token.kind === 'space' || claimed(token)) {
      i += 1
      continue
    }
    if (token.kind === 'punct') {
      // Only the possessive apostrophe is skipped ("yesterday's taxi");
      // anything else is a real boundary the reference does not reach past.
      if (!POSSESSIVE_PUNCT.includes(token.text)) return null
      i += 1
      if (tokens[i]?.kind === 'latin' && tokens[i].text.toLowerCase() === 's') i += 1
      continue
    }
    if (token.kind === 'digits') return null
    if (isFiller(token) || entryAt(token) !== null) {
      i += 1
      continue
    }
    if (isEditActionWord(token)) return null
    const keyword = keywordOf(token)
    if (keyword === '' || KEYWORD_STOPWORDS.includes(keyword)) return null
    return { keyword, end: token.end }
  }
  return null
}

/**
 * The sentence's reference expression, or null when it carries none.
 *
 * The LEFTMOST reference wins: "어제 그거 취소해줘" is about yesterday, and the
 * 그거 that follows is the same expense said twice, not a second, vaguer
 * reference that should widen the window back out.
 *
 * The hit's span covers the reference word plus its keyword, so a caller
 * scrubbing consumed spans is not left holding "아까 그 술값에".
 *
 * `people` and `amounts` are optional — the hits the caller already has from
 * `findPeople`/`findAmounts`, used only to skip a name or a written amount
 * standing between the reference and its noun. Omitting either costs only
 * those cases and nothing else.
 */
export function findReference(
  tokens: Token[],
  // Every span here is built from the tokens' own start/end arithmetic, so the
  // raw input is never re-scanned; the parameter keeps the signature uniform
  // with the other parsers in this directory (and with the brief).
  _input: string,
  people: readonly PersonHit[] = [],
  amounts: readonly ClaimedSpan[] = [],
): ReferenceHit | null {
  for (let i = 0; i < tokens.length; i++) {
    const entry = entryAt(tokens[i])
    if (!entry) continue
    const keyword = findKeyword(tokens, i + 1, people, amounts)
    return {
      type: 'reference',
      start: tokens[i].start,
      end: keyword?.end ?? tokens[i].end,
      value: { window: entry.window, keyword: keyword?.keyword ?? null },
      confidence: 1,
    }
  }
  return null
}
