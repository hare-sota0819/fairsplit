import { reconcileSplit, runPipeline } from './engine/pipeline'
import { removeSpans } from './engine/refine'
import { tokenize } from './engine/tokenizer'
import { findSplit } from './parsers/split'
import { resolvePayer } from './people'
import type { MemberHit } from './people'
import type { ParseContext, ParsedExpense } from './types'

export type { ChatMember, ParseContext, ParsedExpense } from './types'

/**
 * Whether `input` contains a split/evenly keyword (엔빵/n빵/다같이/반반/half/
 * evenly/…). Exported for `src/lib/assistant/classify.ts`'s P5 ladder gate
 * (spec §2.3) — the SAME recognition `parse()` itself uses for
 * `participantIds`/`description`, not a second, drifting copy of this
 * vocabulary. That is now literally true rather than merely intended: both
 * read `findSplit`, so the vocabulary lives in ONE place (ko/lexicon-verbs.ts
 * + en/lexicon.ts) and the n-ways grammar comes along for free.
 *
 * FULL-confidence hits only. A split expression the lexicon itself is unsure
 * about — `each`, which is a split signal in "20 bucks each" and an ordinary
 * distributive in "each receipt" — must not on its own trip P5's ladder gate
 * into opening an expense card. Confidence is the lexicon's way of saying "I
 * saw it, but do not act on this alone"; this predicate is exactly a
 * caller acting on it alone, so it reads only the certain hits. `parse()`'s
 * participant logic still sees every hit, because there the split word is
 * corroborated by the rest of the sentence.
 *
 * Cash/funding is deliberately NOT included: `parse()`'s own
 * `funding: 'NEW_CASH_WALLET'` is already an observable result field, so a
 * caller checking for a cash signal reads that instead of needing a
 * predicate here.
 */
export function hasSplitKeyword(input: string): boolean {
  return findSplit(tokenize(input), input).some((h) => h.confidence >= 1)
}

/**
 * Parses one free-form chat sentence into a draft expense. Pure function:
 * no DB, no I/O — the UI is responsible for everything past this point,
 * including validating `amount` with parseAmountToMinor (src/lib/format.ts)
 * before save. A hit here is a syntactically-plausible money mention, not a
 * validated one (e.g. more fractional digits than the currency allows) —
 * parse() never drops it, it just passes the raw string through. The UI must
 * treat a rejected amount the same as `missing: ['amount']`, i.e. ask.
 *
 * Every reading comes from `runPipeline` (engine/pipeline.ts); this function
 * is the POLICY on top of it and nothing else — which hit becomes `amount`,
 * who the participants are, what is left over as a description.
 *
 * ## The description contract (controller ruling, T8 fix round 1)
 *
 * `description` is the input MINUS every span the parse consumed, whitespace
 * collapsed. There is no keyword sweep and no noise list: a word survives
 * exactly when no hit claimed it. Consumed = amounts, member hits (including
 * a Korean josa or a bound English preposition), pay-verb spans covering the
 * FULL inflected form, split expressions, funding keywords, and first-person
 * self-mentions.
 *
 * Three consequences of that rule are DELIBERATE, not oversights:
 *
 *  - **English prepositions bind into the person's span.** `with` immediately
 *    before a bound name is part of that name's hit — the mirror of Korean's
 *    companion josa, which marks the same relation after the noun instead of
 *    before it. "paid $45 for lunch with Sam" → `"for lunch"`, with no
 *    stranded "with". (`WITH_PREPOSITION`, parsers/people.ts.)
 *  - **Commas are RETAINED.** The old noise regex stripped every `,` in the
 *    sentence; keeping them was ruled an improvement, because a comma is
 *    ordinary punctuation of the description itself — "lunch, dinner 3000" →
 *    `"lunch, dinner"`, which is what the user wrote.
 *  - **A dangling coordinator can survive.** `and` is NOT bound into a person
 *    span (it is a conjunction, not a preposition — see `WITH_PREPOSITION`'s
 *    note and the open ruling), so "paid $30 for lunch with Sam and Alex"
 *    describes `"for lunch and"`: `with Sam` and `Alex` are both consumed and
 *    the `and` that joined them is not. Known and accepted; the leftover is
 *    cosmetic and visible on the confirm card, never a wrong save.
 */
export function parse(input: string, ctx: ParseContext): ParsedExpense {
  const slots = runPipeline(input, ctx, 'both')

  // The first MARKED mention wins, falling back to the first of any kind —
  // a bare number ("카톡 1234") must never outrank an explicit one ("5만원").
  // Same rule as amount.ts's `extractAmount`, which this replaces here.
  const hit = slots.amounts.find((h) => h.value.marked) ?? slots.amounts[0] ?? null

  const hits: MemberHit[] = slots.people.map((h) => ({
    id: h.memberId,
    start: h.start,
    end: h.end,
  }))
  const { payerId, payerHit } = resolvePayer(input, hits, ctx.actorId)

  const named = hits.filter((h) => h !== payerHit).map((h) => h.id)
  // `split.even.n` (an explicit "three ways" count) is READ and then DROPPED
  // here on purpose: `participantIds` can only ever hold real member ids, and
  // a count is not a set of people — "split three ways" in a group of five
  // says how many shares, not which members. Reconciling a count against the
  // actual roster is a decision for the consumer that has one (T9/T10's
  // context commands / confirm card), not for this function, which would have
  // to invent members to honour it.
  const split = reconcileSplit(slots.splits)
  // An even-split expression only OVERRIDES the people the sentence names when
  // the lexicon is certain it means the whole group. 엔빵/다같이/evenly say
  // that outright; 나눠 ("dividing") and English `each` are split signals with
  // an everyday second reading, and their confidence says so. So "간식값
  // 6000원 지훈이랑 나눠냈어" is the two people it names, while "택시 8500원
  // 유나가 냄 다같이" is still everyone. Same principle as `hasSplitKeyword`'s
  // full-confidence gate: an uncertain hit is never acted on ALONE, and here
  // the names are what contradict it.
  const certainEven = slots.splits.some((h) => h.value.mode !== 'half' && h.confidence >= 1)
  const everyone = ctx.members.map((m) => m.id)
  // A surviving self-mention ("나랑 유나가 먹음") is the typer naming
  // themselves alongside the members it names, so the NAMED SET — including a
  // named payer — is the participant set. Without it, a named payer alone
  // never shrinks participants ("유나가 계산" → everyone), which stays true.
  const selfNamed = slots.actors.length > 0 && hits.length > 0
  let participantIds: string[]
  if (split.half && named.length === 1) {
    participantIds = [...new Set([ctx.actorId, named[0]])]
  } else if ((named.length > 0 || selfNamed) && (split.even === null || !certainEven)) {
    participantIds = [
      ...new Set([ctx.actorId, ...named, ...(selfNamed ? hits.map((h) => h.id) : [])]),
    ]
  } else {
    participantIds = everyone
  }
  // Stable order: as the group lists members, so the UI pills never reshuffle.
  participantIds = everyone.filter((id) => participantIds.includes(id))

  // Description = the sentence minus every span the parse consumed. No
  // keyword sweep: a word survives exactly when no hit claimed it, which is
  // what keeps "나도 껴줘" intact and scrubs "결제했어" whole (the old regex
  // knew the stem 결제했 but not where the inflected form ended, and left the
  // trailing 어 behind as description text).
  const description = removeSpans(input, slots.consumed).replace(/\s+/g, ' ').trim()

  // How many DISTINCT amount mentions the sentence carries. Counts MARKED
  // hits only, so an item quantity ("3개") can never inflate it; a sentence
  // with no marked mention anywhere still counts a bare amount as one,
  // otherwise "점심 12000 민수랑 나" would read as zero amounts.
  const marked = slots.amounts.filter((h) => h.value.marked).length
  const amountMentions = marked > 0 ? marked : slots.amounts.length > 0 ? 1 : 0

  return {
    amount: hit?.value.amount ?? null,
    currency: hit?.value.currency ?? ctx.defaultCurrency,
    payerId,
    participantIds,
    description,
    funding: slots.funding.length > 0 ? 'NEW_CASH_WALLET' : 'PAY_AS_YOU_GO',
    missing: hit ? [] : ['amount'],
    amountMentions,
  }
}
