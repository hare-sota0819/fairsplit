import { FUNDING_WORDS_EN } from '../en/lexicon'
import { findAmounts, type AmountValue } from '../parsers/amount'
import { findActorMentions, findPeople, type ActorHit, type PersonHit } from '../parsers/people'
import {
  findPayVerbs,
  findSplit,
  type ParseLocale,
  type PayVerbHit,
  type SplitHit,
  type SplitValue,
} from '../parsers/split'
import type { ParseContext } from '../types'
import type { ParseHit } from './hits'
import { refineHits, type RefineKey, type Span } from './refine'
import { tokenize } from './tokenizer'
import type { Token } from './tokens'

/**
 * The pipeline: tokenize once, run every parser over the same token stream,
 * refine away the overlaps, and report what the sentence yielded.
 *
 * It decides NOTHING about the expense. `parse()` (../index.ts) is what turns
 * these slots into a payer, a participant set and a description; this file's
 * only opinions are "which of two overlapping readings survives" (delegated
 * wholesale to engine/refine.ts) and "which characters were consumed."
 *
 * `consumed` is the description rule made data: the description is the input
 * minus these spans, so a word survives exactly when no parser claimed it.
 * That is why the spans of things `parse()` never reports — a self-mention
 * ("내가"), the funding keyword — are in here too: they were READ, so they are
 * not part of what was bought. It also means there is no global noise regex
 * anywhere any more (backlog #5): the old one ate 결제했 and left a stranded
 * 어 behind, because a regex list of stems cannot know where an inflected form
 * ends. A hit's span does.
 */

export type AmountHit = ParseHit<'amount', AmountValue>
export type FundingHit = ParseHit<'funding', { source: 'NEW_CASH_WALLET' }>

export interface Slots {
  amounts: AmountHit[]
  people: PersonHit[]
  payVerbs: PayVerbHit[]
  splits: SplitHit[]
  /**
   * Funding-source keywords (현금/cash). Not in the brief's slot list, added
   * because the description rule already forces the pipeline to know where
   * they are: having found them, reporting them costs nothing, while making
   * `parse()` re-scan the sentence for the same words would be a second copy
   * of the vocabulary and a second chance to disagree with this one.
   */
  funding: FundingHit[]
  /**
   * First-person self-mentions that survived refinement (one inside a
   * member's span — 유나도's 나도 — loses the overlap and is NOT here).
   * `parse()` reads only their presence: a surviving self-mention plus at
   * least one named member restricts participants to the named set.
   */
  actors: ActorHit[]
  /** spans consumed by any accepted hit — description = input minus these. */
  consumed: Span[]
}

// --- funding ----------------------------------------------------------------

/**
 * Funding vocabulary — the words `parse()`'s `funding` field has always read.
 * Korean matches as a substring (Hangul has no word boundary, and 현금영수증
 * still says cash); English matches a WHOLE latin token, which is what the
 * `\b`-wrapped regex this replaces did.
 *
 * A member NAMED "Cash" collides with the English entry, and the refiner
 * settles it the right way with no special case — by two different routes
 * depending on the sentence, with the same outcome:
 *  - No preposition before the name ("Cash paid for lunch"): both hits claim
 *    the IDENTICAL span at the identical confidence, so `PRIORITY` is what
 *    decides, and `person` outranks `funding`.
 *  - A `with` before it ("split it with Cash"): the person hit has absorbed
 *    the preposition (parsers/people.ts), so the spans are no longer equal —
 *    the person hit starts earlier and is longer, and `PRIORITY` is never
 *    consulted at all; (start, length) alone settles it.
 * Either way the group member wins and the sentence does not silently become
 * a cash-wallet expense. (A group with no such member is unaffected: no
 * person hit exists to compete.)
 */
const FUNDING_WORDS: ReadonlyArray<{ text: string; script: 'ko' | 'en' }> = [
  { text: '현금', script: 'ko' },
  // The English half comes from en/lexicon.ts, because parsers/amount.ts reads
  // the same list — a funding word after a bare number confirms it is a price
  // ("hotel 1200 cash"). Two readers, one vocabulary.
  ...FUNDING_WORDS_EN.map((text) => ({ text, script: 'en' as const })),
]

function findFunding(tokens: Token[], input: string, locale: ParseLocale): FundingHit[] {
  const hits: FundingHit[] = []
  const hit = (start: number, end: number): FundingHit => ({
    type: 'funding',
    start,
    end,
    value: { source: 'NEW_CASH_WALLET' },
    confidence: 1,
  })
  for (const word of FUNDING_WORDS) {
    if (word.script === 'ko') {
      if (locale === 'en') continue
      let from = input.indexOf(word.text)
      while (from !== -1) {
        hits.push(hit(from, from + word.text.length))
        from = input.indexOf(word.text, from + word.text.length)
      }
      continue
    }
    if (locale === 'ko') continue
    for (const token of tokens) {
      if (token.kind !== 'latin') continue
      if (token.text.toLowerCase() === word.text) hits.push(hit(token.start, token.end))
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

// --- refinement -------------------------------------------------------------

type Tagged =
  | { kind: 'amount'; hit: AmountHit }
  | { kind: 'split'; hit: SplitHit }
  | { kind: 'person'; hit: PersonHit }
  | { kind: 'payverb'; hit: PayVerbHit }
  | { kind: 'funding'; hit: FundingHit }
  | { kind: 'actor'; hit: ActorHit }

/**
 * Tie-break order, consulted ONLY when two hits claim the identical span at
 * the identical confidence (see engine/refine.ts). It is deliberately not a
 * ranking of how much each parser is trusted — that is what `confidence` is
 * for; this exists so the same input always yields the same slots.
 */
const PRIORITY: Record<Tagged['kind'], number> = {
  amount: 0,
  split: 1,
  person: 2,
  payverb: 3,
  funding: 4,
  actor: 5,
}

function keyOf(tagged: Tagged): RefineKey {
  const { start, end } = tagged.hit
  const confidence = tagged.kind === 'person' ? 1 : tagged.hit.confidence
  return { start, end, confidence, priority: PRIORITY[tagged.kind] }
}

// --- entry point ------------------------------------------------------------

export function runPipeline(input: string, ctx: ParseContext, locale: ParseLocale): Slots {
  const tokens = tokenize(input)

  const tagged: Tagged[] = [
    ...findAmounts(tokens, input, ctx.defaultCurrency).map(
      (hit): Tagged => ({ kind: 'amount', hit }),
    ),
    ...findSplit(tokens, input).map((hit): Tagged => ({ kind: 'split', hit })),
    ...findPeople(tokens, input, ctx.members).map((hit): Tagged => ({ kind: 'person', hit })),
    ...findPayVerbs(tokens, input, locale).map((hit): Tagged => ({ kind: 'payverb', hit })),
    ...findFunding(tokens, input, locale).map((hit): Tagged => ({ kind: 'funding', hit })),
    ...findActorMentions(input).map((hit): Tagged => ({ kind: 'actor', hit })),
  ]

  const kept = refineHits(tagged, keyOf)
  const byStart = <T extends Span>(hits: T[]): T[] => hits.sort((a, b) => a.start - b.start)

  return {
    amounts: byStart(kept.flatMap((t) => (t.kind === 'amount' ? [t.hit] : []))),
    people: byStart(kept.flatMap((t) => (t.kind === 'person' ? [t.hit] : []))),
    payVerbs: byStart(kept.flatMap((t) => (t.kind === 'payverb' ? [t.hit] : []))),
    splits: byStart(kept.flatMap((t) => (t.kind === 'split' ? [t.hit] : []))),
    funding: byStart(kept.flatMap((t) => (t.kind === 'funding' ? [t.hit] : []))),
    actors: byStart(kept.flatMap((t) => (t.kind === 'actor' ? [t.hit] : []))),
    consumed: kept
      .map((t) => ({ start: t.hit.start, end: t.hit.end }))
      .sort((a, b) => a.start - b.start),
  }
}

// --- split reconciliation ---------------------------------------------------

/**
 * How the sentence's several split expressions read TOGETHER.
 *
 * `findSplit` is right to report each expression it sees, and right not to
 * merge them: "split it three ways" genuinely contains both a generic `split`
 * and an n-ways count, and only a caller that can also weigh the NAMES in the
 * sentence can say what the pair means. This is that caller's rule, and it is
 * two independent questions, not one:
 *
 *  - `even` — is the bill divided evenly, and across how many? An explicit
 *    count WINS over a bare "split"/"다같이" when both are present
 *    (controller ruling): the count is the more specific statement of the
 *    same intent, so "split it three ways" reads as n=3, not as two split
 *    expressions that have to be reconciled away.
 *  - `half` — 반반/절반/half is a SEPARATE axis, not another `even` value.
 *    It restricts to two people only when exactly one member is named
 *    (`parse()`'s HALF rule), and it has never interacted with the
 *    everyone-keyword branch. Collapsing both axes into one mode would
 *    silently change "다같이 반반" with one named member.
 */
export interface SplitReading {
  /** The one even-split expression governing participants, or null. */
  even: SplitValue | null
  /** A 반반/절반/half expression is present. */
  half: boolean
}

export function reconcileSplit(splits: readonly SplitHit[]): SplitReading {
  const nWays = splits.find((h) => h.value.mode === 'n-ways')
  const everyone = splits.find((h) => h.value.mode === 'everyone')
  return {
    even: nWays?.value ?? everyone?.value ?? null,
    half: splits.some((h) => h.value.mode === 'half'),
  }
}
