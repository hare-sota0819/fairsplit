import { SPLIT_ENTRIES_EN, PAY_VERB_ENTRIES_EN } from '../en/lexicon'
import { readEnglishNumber } from '../en/numbers'
import type { ParseHit } from '../engine/hits'
import type { Token } from '../engine/tokens'
import { readClauseForm } from '../ko/attributive'
import { fuseEnding } from '../ko/inflect'
import {
  PAY_VERBALIZER,
  PAY_VERB_ENDING,
  isAmbiguousStemEnding,
  PAY_VERB_ENTRIES,
  SPLIT_ENTRIES_KO,
  type PayVerbEntry,
} from '../ko/lexicon-verbs'
import type { SplitEntry, SplitMode } from '../types'

/**
 * Pay-verb and split-expression parsers over `Token[]`.
 *
 * Both return HITS WITH EXACT SPANS, never a boolean and never a regex sweep
 * over the sentence (backlog #5). That is the whole point: description
 * scrubbing removes the spans hits actually consumed — the matched verb's own
 * span included — so text no hit claimed survives untouched. "나도 껴줘" has
 * no pay verb and no split keyword, so nothing is removed from it, where the
 * old global NOISE regex ate 나도 out of any sentence it appeared in.
 *
 * Spans cover the FULL inflected form: 결제했어 is one hit spanning the whole
 * hangul run, not 결제 with 했어 left behind for a caller to trip over (the
 * trailing-어 artifact pinned in the current index.test.ts as "물어보고 어").
 */

export type SplitValue = { mode: SplitMode; n?: number }
export type SplitHit = ParseHit<'split', SplitValue>
export type PayVerbHit = ParseHit<'payverb', { stem: string }>
export type ParseLocale = 'ko' | 'en' | 'both'

// --- korean pay verbs -------------------------------------------------------

interface KoSurface {
  /** The exact text to match in a token. */
  surface: string
  entry: PayVerbEntry
  /** This surface is a FUSED form (쏘 -> 쏜/쏠/쏨), not the bare stem. A fused
   *  form is unambiguous by construction — the fusion is what makes it a verb
   *  — so an `ambiguous` entry's extra restriction applies only to the bare
   *  stem it was written for. */
  fused: boolean
}

/**
 * A stem's matchable surfaces: the stem itself, plus the FUSED forms a
 * vowel-final stem takes when its ending is a bare consonant — 쏘 → 쏜(다)/
 * 쏠(게)/쏨. Generated from the stem by the ending grammar (ko/inflect.ts),
 * never listed in the lexicon, so the same stem covers every fused form
 * without any of them being written down.
 */
function surfacesOf(entry: PayVerbEntry): KoSurface[] {
  const surfaces: KoSurface[] = [{ surface: entry.stem, entry, fused: false }]
  if (entry.kind === 'verb-form') {
    for (const jong of ['ㄴ', 'ㄹ', 'ㅁ']) {
      const fused = fuseEnding(entry.stem, jong)
      if (fused !== null && fused !== entry.stem) surfaces.push({ surface: fused, entry, fused: true })
    }
  }
  return surfaces
}

/** Longest first, so a longer stem always wins at the same position. */
const KO_SURFACES: readonly KoSurface[] = PAY_VERB_ENTRIES.flatMap(surfacesOf).sort(
  (a, b) => b.surface.length - a.surface.length,
)

/**
 * How confident a pay-verb match at this continuation is, or null when the
 * continuation disqualifies it entirely.
 *
 * A `verbal-noun` stem must be verbalized by the 하-family (backlog #2:
 * 계산서/계산기 are nouns, and their 서/기 is not a verbalizer). Standing
 * alone it is a noun too — "계산 누가 했어" — but a bare 계산/결제 in this
 * domain is a payment mention worth reporting at LOWER confidence, which lets
 * a refiner drop it against any real verb elsewhere in the sentence.
 */
function confidenceFor(entry: PayVerbEntry, rest: string, fused: boolean): number | null {
  if (entry.kind === 'verbal-noun') {
    if (rest === '') return 0.6
    return PAY_VERBALIZER.test(rest) ? 1 : null
  }
  if (entry.ambiguous && !fused) return isAmbiguousStemEnding(rest) ? 1 : null
  if (rest === '') return 1
  return PAY_VERB_ENDING.test(rest) ? 1 : null
}

/**
 * Whether the WHOLE token is better explained as an inflected form of some
 * OTHER verb — one whose stem is not a pay verb at all.
 *
 * This is the guard on matching a pay stem INSIDE a word (k > 0). 보낸 ("sent",
 * attributive) contains 낸, and 보낸 is not a payment: it is 보내 + ㄴ, and
 * ko/attributive.ts can say so, because 보내 is in the verb lexicon and the
 * ending grammar explains the rest.
 *
 * SCOPE, precisely: `readClauseForm` reads ATTRIBUTIVE and CONNECTIVE forms
 * (보낸/보내는/보내던/보내고), not finite pasts — so 보냈어 still reports a pay
 * verb and still credits the name in front of it. That is a narrower rule than
 * "보내다 is never a payment", deliberately: 송금 IS a payment in this domain,
 * and the case the guard exists for is the EMBEDDED CLAUSE ("유나가 보낸 돈
 * 민수가 냈어"), where crediting the wrong person is the actual harm. The
 * finite-past neighbour is pinned as a known row in the Task 11 corpus.
 *
 * The question is asked with the machinery that already answers it, not with a
 * denylist of syllables that may precede a pay stem — the same "read it as
 * (lexicon + grammar), never enumerate the product" rule the rest of this file
 * follows.
 *
 * A glued compound whose head is an ordinary noun is untouched, because no
 * verb lexicon explains it: 저녁계산했어, 밥값냈어, 택시비냈어 all still report
 * their verb. And the check is skipped entirely at k === 0, where the token
 * STARTS with the pay stem and there is no other word for it to be part of.
 */
function isAnotherVerbsForm(text: string, entry: PayVerbEntry): boolean {
  const form = readClauseForm(text)
  return form !== null && form.stem !== entry.stem
}

/**
 * The first pay verb inside one hangul token, spanning from the stem to the
 * END of the token.
 *
 * The stem is looked for at every position, not only at the token's start: a
 * glued "저녁계산했어" must still report the verb (and leave 저녁 in the
 * description). The one exception is an `ambiguous` stem, which matches only
 * where the token starts — see the two guards at the top of the loop. The known cost of that, unchanged from the regex this
 * replaces, is a stem that is a real substring of an unrelated verb: 보냈어
 * ("sent") contains 냈, and 보낸 ("sent", attributive) contains 낸. Both read
 * as pay verbs. In this domain that is arguably benign rather than merely
 * tolerable — "민수한테 3만원 보냈어" IS a payment (송금), and the payer it
 * resolves is the right one; the misfire only matters for a non-money
 * sending ("사진 보냈어"), where the worst case is a payer prefill the
 * confirm card shows and the user can correct.
 */
function payVerbInToken(token: Token): PayVerbHit | null {
  const text = token.text
  for (let k = 0; k < text.length; k++) {
    for (const { surface, entry, fused } of KO_SURFACES) {
      if (!text.startsWith(surface, k)) continue
      if (k > 0 && isAnotherVerbsForm(text, entry)) continue
      // An `ambiguous` stem only matches where the token STARTS. 내 is one
      // syllable and sits inside a great many ordinary words whose remainder
      // is perfectly good ending material — 안내자, 안내대, 끝내지, 끝내어,
      // 티내네, 제내지, 방송내보내다니 — and no continuation can separate
      // those from a payment, because 내자 ("let's pay") and 안내자 ("a
      // guide") have the SAME continuation. Position can.
      //
      // The cost is glued NOUN+내고 ("밥값내고", "돈내고", "회비내고"), which
      // now reports no verb — a documented known loss, pinned in the Task 11
      // corpus. It restores the pre-branch behaviour for those (the bare 내
      // stem did not exist before this task) and it is what buys the 17
      // false fires the sweep found. Unambiguous stems are untouched, so a
      // glued 밥값냈어 still reports its verb.
      if (k > 0 && entry.ambiguous) continue
      const confidence = confidenceFor(entry, text.slice(k + surface.length), fused)
      if (confidence === null) continue
      return {
        type: 'payverb',
        start: token.start + k,
        end: token.end,
        value: { stem: entry.stem },
        confidence,
      }
    }
  }
  return null
}

// --- english phrase matching ------------------------------------------------

/**
 * Matches `words` as consecutive latin tokens starting at token `i`, allowing
 * exactly the whitespace between them. Returns the index of the LAST token
 * matched, or null.
 *
 * Comparison is whole-token and case-folded, which is what makes "tabloid"
 * not match "tab": the tokenizer already grouped the maximal latin run, so
 * the token IS "tabloid".
 */
function matchWords(tokens: Token[], i: number, words: string[]): number | null {
  let j = i
  for (let w = 0; w < words.length; w++) {
    if (w > 0) {
      if (tokens[j]?.kind !== 'space') return null
      j += 1
    }
    const token = tokens[j]
    if (!token || token.kind !== 'latin' || token.text.toLowerCase() !== words[w]) return null
    j += 1
  }
  return j - 1
}

interface Phrase<T> {
  words: string[]
  entry: T
}

function phrasesOf<T>(entries: readonly T[], read: (entry: T) => string): Array<Phrase<T>> {
  return entries
    .map((entry) => ({ words: read(entry).split(' '), entry }))
    .sort((a, b) => b.words.length - a.words.length)
}

const EN_PAY_PHRASES = phrasesOf(PAY_VERB_ENTRIES_EN, (e) => e.phrase)
const EN_SPLIT_PHRASES = phrasesOf(SPLIT_ENTRIES_EN, (e) => e.text)

// --- entry points -----------------------------------------------------------

/**
 * Every pay-verb mention in `tokens`, left to right, one per hangul token /
 * english phrase. `[]` when the sentence claims no payment — "나도 껴줘" asks
 * to be included in a split, it does not say anyone paid.
 */
export function findPayVerbs(
  tokens: Token[],
  // Every span is built from the tokens' own start/end arithmetic, so the raw
  // input is never re-scanned; the parameter keeps the signature uniform with
  // the other parsers (and with the brief).
  _input: string,
  locale: ParseLocale,
): PayVerbHit[] {
  const hits: PayVerbHit[] = []
  const ko = locale !== 'en'
  const en = locale !== 'ko'

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (ko && token.kind === 'hangul') {
      const hit = payVerbInToken(token)
      if (hit) hits.push(hit)
      continue
    }
    if (en && token.kind === 'latin') {
      for (const { words, entry } of EN_PAY_PHRASES) {
        const last = matchWords(tokens, i, words)
        if (last === null) continue
        hits.push({
          type: 'payverb',
          start: token.start,
          end: tokens[last].end,
          value: { stem: entry.phrase },
          confidence: entry.confidence,
        })
        i = last
        break
      }
    }
  }

  return hits.sort((a, b) => a.start - b.start)
}

function splitHit(start: number, end: number, entry: SplitEntry): SplitHit {
  return {
    type: 'split',
    start,
    end,
    value: { mode: entry.mode },
    confidence: entry.confidence,
  }
}

/** A spaced entry ("다 같이") matched with any run of whitespace in place of
 * its own single space, so "다  같이" and a line-broken "다\n같이" hit too. */
function spacedPattern(text: string): RegExp {
  const parts = text.split(' ').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return new RegExp(parts.join('\\s+'), 'gu')
}

/** Every occurrence of a Korean split expression, as exact input spans. */
function koreanSplitHits(input: string): SplitHit[] {
  const hits: SplitHit[] = []
  for (const entry of SPLIT_ENTRIES_KO) {
    if (entry.text.includes(' ')) {
      for (const match of input.matchAll(spacedPattern(entry.text))) {
        hits.push(splitHit(match.index, match.index + match[0].length, entry))
      }
      continue
    }
    let from = input.indexOf(entry.text)
    while (from !== -1) {
      hits.push(splitHit(from, from + entry.text.length, entry))
      from = input.indexOf(entry.text, from + entry.text.length)
    }
  }
  return hits
}

/**
 * "three ways" / "4 ways" — an n-ways split read as a GRAMMAR: any number
 * `readEnglishNumber` can read, followed by the word `way(s)`. Not a list of
 * literal phrases, so "seventeen ways" works for the same reason "three ways"
 * does.
 *
 * The count must be 2 or more: a one-way split is not a split at all, and
 * "one way street"/"1 way" are ordinary English that would otherwise report a
 * confident, meaningless `{mode:'n-ways', n:1}`.
 *
 * The SINGULAR `way` is accepted because "three way split" is idiomatic and
 * nothing else in the sentence would carry the count — verified: dropping it
 * loses that phrase's `n` entirely rather than recovering it elsewhere. The
 * n >= 2 guard is what makes the singular safe.
 */
function nWaysHits(tokens: Token[]): SplitHit[] {
  const hits: SplitHit[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'latin' && tokens[i].kind !== 'digits') continue
    const number = readEnglishNumber(tokens, i)
    if (!number || number.scale !== 0 || number.value < 2n) continue
    let j = i + number.tokenCount
    if (tokens[j]?.kind === 'space') j += 1
    const word = tokens[j]
    if (!word || word.kind !== 'latin') continue
    const lowered = word.text.toLowerCase()
    if (lowered !== 'ways' && lowered !== 'way') continue
    hits.push({
      type: 'split',
      start: number.start,
      end: word.end,
      value: { mode: 'n-ways', n: Number(number.value) },
      confidence: 1,
    })
    i = j
  }
  return hits
}

/**
 * "split three ways" is ONE split expression, not a generic split next to a
 * count: the n-ways hit absorbs an immediately preceding everyone-mode
 * keyword (only whitespace between them) so the sentence yields a single hit
 * carrying the count, and its span covers the whole phrase for scrubbing.
 *
 * Only an ADJACENT pair merges. "split it three ways" keeps two hits — an
 * everyone-mode `split` and an n-ways `three ways` — because the words
 * between them are not this parser's to consume. Both are honest readings of
 * the same intent, and reconciling a sentence's several split hits into one
 * participant decision belongs to the caller (Task 8), which is also the only
 * layer that can weigh them against the NAMES it found.
 */
function absorbPrecedingSplitWord(hits: SplitHit[], input: string): SplitHit[] {
  const byStart = [...hits].sort((a, b) => a.start - b.start)
  const absorbed = new Set<SplitHit>()
  const out: SplitHit[] = []
  for (let i = 0; i < byStart.length; i++) {
    const hit = byStart[i]
    if (absorbed.has(hit)) continue
    const next = byStart[i + 1]
    if (
      hit.value.mode === 'everyone' &&
      next?.value.mode === 'n-ways' &&
      input.slice(hit.end, next.start).trim() === ''
    ) {
      absorbed.add(next)
      out.push({ ...next, start: hit.start })
      continue
    }
    out.push(hit)
  }
  return out
}

/** Drops a hit whose span is already covered by a longer, earlier-kept one. */
function dropOverlaps(hits: SplitHit[]): SplitHit[] {
  const ordered = [...hits].sort((a, b) => a.start - b.start || b.end - a.end)
  const kept: SplitHit[] = []
  for (const hit of ordered) {
    if (kept.some((k) => hit.start < k.end && hit.end > k.start)) continue
    kept.push(hit)
  }
  return kept
}

/**
 * Every split/evenly expression in the sentence, with its exact span and what
 * it means. Recognizes the full vocabulary `hasSplitKeyword` (index.ts) has
 * always accepted — 엔빵/n빵/다같이/모두/전부/나눠/나누자/반반/절반/evenly/
 * everyone/split/all together/half — plus the n-ways grammar, and keeps that
 * vocabulary's one deliberate exclusion: bare 같이 (see SPLIT_ENTRIES_KO).
 */
export function findSplit(tokens: Token[], input: string): SplitHit[] {
  const hits: SplitHit[] = [...koreanSplitHits(input), ...nWaysHits(tokens)]

  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].kind !== 'latin') continue
    for (const { words, entry } of EN_SPLIT_PHRASES) {
      const last = matchWords(tokens, i, words)
      if (last === null) continue
      hits.push(splitHit(tokens[i].start, tokens[last].end, entry))
      i = last
      break
    }
  }

  return dropOverlaps(absorbPrecedingSplitWord(hits, input))
}
