import { extractAmount } from './amount'
import { tokenize } from './engine/tokenizer'
import { isVerbAttributive } from './ko/attributive'
import { ACTOR_WORD, findPeople, findPeopleWithActor } from './parsers/people'
import { findPayVerbs } from './parsers/split'
import type { ChatMember } from './types'

export interface MemberHit {
  id: string
  start: number
  /** Includes a trailing particle so span removal leaves clean text. */
  end: number
}

/**
 * Every pay-verb mention in `input`, as spans. The single reader of the
 * pay-verb vocabulary for this whole layer.
 *
 * This used to be a regex — `/냈|냄|결제|계산|샀|쐈|paid|bought/i` — and the
 * regex was wrong in both directions at once, which no amount of tuning it
 * could fix. It MISSED every lexicon verb it did not happen to list
 * (지불했어, 사줬어, 긁었어, 쏜다: all read as "nobody paid", so the payer
 * silently fell back to the actor), and it FALSE-FIRED on 계산서 (the bill —
 * a noun), crediting whoever was named nearby. `findPayVerbs` answers both:
 * the stems come from `ko/lexicon-verbs.ts` and are combined with the ending
 * grammar rather than enumerated, and a verbal noun only counts when the
 * 하-family actually verbalizes it (backlog #2).
 */
function payVerbHits(input: string) {
  return findPayVerbs(tokenize(input), input, 'both')
}

/**
 * Whether `input` contains a pay-verb. Exported for
 * `src/lib/assistant/classify.ts`'s P5 ladder gate (spec §2.3), which needs
 * the SAME recognition `resolvePayer` uses rather than a second, drifting
 * copy — now literally the same call, not two definitions kept in step by
 * hand.
 *
 * A BARE `계산`/`결제` with no verbalizer still counts (the parser reports it
 * at reduced confidence: it may be the noun "the bill"), which is the
 * looseness `lexicons/expense-signal.ts` layers its own suffix gate on top of
 * for the assistant's stricter purposes. What no longer counts is 계산서 /
 * 계산기 / 계산대 — a verbal noun carrying a NOUN-forming suffix, which the
 * old regex could not distinguish and this one never sees as a verb at all.
 */
export function hasPayVerb(input: string): boolean {
  return payVerbHits(input).length > 0
}
/**
 * Particles that mark "with"/"to" (companion/dative), not the subject.
 * A name ending in one of these is never a payer candidate: "민수랑 냈어"
 * means paid WITH Minsu, not that Minsu paid. Mirrors parsers/people.ts's
 * WITH_JOSA set — kept as a regex here since resolvePayer only has the
 * MemberHit span (id/start/end), not a PersonHit's `role`, and re-deriving
 * "does this hit's own captured text end in a with-josa" from the span is
 * simpler than re-tokenizing/re-running findPeople just to recover role.
 */
const NON_SUBJECT_TAIL = /(이랑|랑|하고|과|와|한테|에게|한테서|에게서)$/
/**
 * The same relation on the other side of the name: English marks it with a
 * preposition BEFORE the noun, and `parsers/people.ts` binds that preposition
 * into the person's span (`WITH_PREPOSITION`), so a with-marked English hit
 * is one whose own captured text STARTS with the marker.
 */
const NON_SUBJECT_LEAD = /^with\b/i

/**
 * findMembers/resolvePayer are the byte-identical adapter surface over the
 * token-based binder (parsers/people.ts's findPeople) — see that file for
 * the actual name/josa/honorific recognition. This file only re-tokenizes,
 * maps PersonHit -> MemberHit, and keeps the payer-resolution policy that
 * was always specific to this layer (pay-verb proximity, actor fallback).
 */
export function findMembers(input: string, members: ChatMember[]): MemberHit[] {
  const tokens = tokenize(input)
  return findPeople(tokens, input, members)
    .map((h) => ({ id: h.memberId, start: h.start, end: h.end }))
    .sort((a, b) => a.start - b.start)
}

/**
 * `findMembers`, counting the typer's own first-person mentions as a hit for
 * `actorId` — the adapter form of `findPeopleWithActor` (see there for why
 * this is a separate entry point rather than the default).
 */
export function findMembersWithActor(
  input: string,
  members: ChatMember[],
  actorId: string,
): MemberHit[] {
  return findPeopleWithActor(tokenize(input), input, members, actorId)
    .map((h) => ({ id: h.memberId, start: h.start, end: h.end }))
    .sort((a, b) => a.start - b.start)
}

// Clause-boundary recognition is DELEGATED to ko/attributive.ts
// (`isVerbAttributive`), which reads a token as (ending grammar + stem
// lexicon) rather than matching a literal list of endings.
//
// Task 4 shipped that literal list and logged four review rounds of its
// consequences (docs/SOLVED.md [2026-08-13]): the ending alone cannot answer
// this question. 추천한 (verb, a boundary) and 시원한 (adjective, NOT a
// boundary) are identical down to the syllable; 한 alone is the determiner
// "one"; 원/잔/반/건 are currency and counter words that merely end in a
// ㄴ-final syllable; 식당에서's 서 is a location particle and 술하고's 하고 the
// companion josa. Only the STEM's class separates them, which is what the
// recognizer consults — and unknown reads as null (no boundary), so a word
// neither lexicon knows can never become a wrong boundary.
//
// Task 8 flipped the two residuals Task 4 pinned as known-wrong, in BOTH
// directions at once, which is the evidence that the mechanism is right and
// not just re-tuned: 고른 (non-하다 past attributive) is now a boundary, so
// "유나가 고른 식당에서 민수랑 냈어" credits the actor; 시원한 (하다-adjective
// attributive) is now NOT one, so "유나가 시원한 맥주 샀어" credits 유나.
// -(으)면서/-(으)니까 stay non-boundaries by omission from the ending
// grammar, preserving Task 4's same-subject ruling.

/**
 * Masks every amount mention in `text` (space-fills each span extractAmount
 * finds, repeatedly) so a currency/counter word is never scanned as a
 * clause-boundary candidate. Kept as defense in depth even though the
 * recognizer already reads 원/잔/반/건 as null — a currency/counter shape
 * whose stem happens to collide with the verb lexicon never reaches it.
 * `'KRW'` is a fixed
 * placeholder default currency for this masking call only (resolvePayer
 * doesn't receive the group's real defaultCurrency) — harmless, since
 * extractAmount's Korean-numeral rule (rule 1, the common case: 3만원 etc.)
 * always returns `currency: 'KRW'` regardless of the default passed in, and
 * every other rule only needs the SPAN, not the currency value, for masking
 * purposes here.
 */
function maskAmounts(text: string): string {
  let masked = text
  // A gap realistically carries at most one amount mention; a small bound
  // guards against ever looping on a pathological repeated match.
  for (let i = 0; i < 5; i++) {
    const hit = extractAmount(masked, 'KRW')
    if (!hit) break
    masked = masked.slice(0, hit.start) + ' '.repeat(hit.end - hit.start) + masked.slice(hit.end)
  }
  return masked
}

/**
 * Clause-boundary detector for the SAME-CLAUSE payer rule (backlog #3):
 * true if a hangul token inside `input.slice(from, to)` — not itself part
 * of any span in `hits`, and with every amount mention masked out first —
 * is a VERB's attributive/connective form (ko/attributive.ts). Such a token
 * sitting between a candidate subject and the pay-verb ("추천한" in "유나가
 * 추천한 식당에서 … 냈어") means the candidate is the subject of an EMBEDDED
 * clause, not of the pay-verb itself, so it must not override the actor.
 * An ADJECTIVE's attributive form ("시원한 맥주") modifies the next noun and
 * is deliberately NOT a boundary.
 */
function hasClauseBoundary(
  input: string,
  hits: MemberHit[],
  from: number,
  to: number,
): boolean {
  if (from >= to) return false
  const gap = maskAmounts(input.slice(from, to))
  for (const t of tokenize(gap)) {
    if (t.kind !== 'hangul') continue
    const absStart = from + t.start
    const absEnd = from + t.end
    if (hits.some((h) => absStart < h.end && absEnd > h.start)) continue
    if (isVerbAttributive(t.text)) return true
  }
  return false
}

export function resolvePayer(
  input: string,
  hits: MemberHit[],
  actorId: string,
): { payerId: string; payerHit: MemberHit | null } {
  // Pay-verb mentions are tried in order, and the FIRST one that has an
  // eligible subject decides. The first verb still wins whenever it names a
  // payer, which is the original rule ("which name is nearest BEFORE the
  // verb"); what changed is what happens when it names nobody. A pay stem can
  // false-fire on an ordinary word early in a sentence — 쏘나타 opens with the
  // stem 쏘 — and that misfire used to blind the rule to the REAL verb further
  // along, silently crediting the actor ("쏘나타 렌트비 유나가 냈어" → me
  // instead of 유나). Reading past a verb that resolves nobody costs nothing:
  // a verb with a subject in front of it is exactly the clause the payer
  // policy is looking for.
  const verbs = payVerbHits(input)
  if (verbs.length === 0) return { payerId: actorId, payerHit: null }
  const isWith = (h: MemberHit) => {
    const own = input.slice(h.start, h.end)
    return NON_SUBJECT_TAIL.test(own) || NON_SUBJECT_LEAD.test(own)
  }
  for (const verb of verbs) {
    const resolved = payerForVerb(input, hits, verb.start, isWith)
    if (resolved) return { payerId: resolved.id, payerHit: resolved }
  }
  return { payerId: actorId, payerHit: null }
}

function payerForVerb(
  input: string,
  hits: MemberHit[],
  verbStart: number,
  isWith: (h: MemberHit) => boolean,
): MemberHit | null {
  const actor = ACTOR_WORD.exec(input.slice(0, verbStart))
  const actorPos = actor ? actor.index : -1

  // Controller-ruled combined rule (fix round 2):
  //  1. Find the hit nearest the pay-verb, of ANY role.
  //  2. If that nearest hit is subject/plain-marked (not with-tailed) AND
  //     no clause-boundary token sits between it and the verb, it's payer.
  //  3. Otherwise (nearest is with-tailed, or none exists) fall back to
  //     the nearest SUBJECT/plain-marked hit before the verb; it wins only
  //     under the same no-boundary condition.
  //  4. Neither applies -> actor.
  // This is what distinguishes "유나가 민수랑 냈어" (유나 wins: 민수랑 is
  // just a companion phrase in the SAME clause as 냈어) from "유나가
  // 추천한 식당에서 민수랑 냈어" (유나 does NOT win: 추천한 is a clause
  // boundary between her and the verb, so no name in the verb's own
  // clause is eligible and the actor keeps the payer role) — and also
  // from "민수가 유나한테 카드로 결제했어" (민수, the nearest-overall's
  // being with-tailed 유나한테 falls back to 민수, the nearest subject).
  const before = hits.filter((h) => h.end <= verbStart)
  const nearestAny = before.at(-1) ?? null

  let candidate: MemberHit | null
  if (nearestAny && !isWith(nearestAny)) {
    candidate = hasClauseBoundary(input, hits, nearestAny.end, verbStart) ? null : nearestAny
  } else {
    const subject = before.filter((h) => !isWith(h)).at(-1) ?? null
    candidate = subject && !hasClauseBoundary(input, hits, subject.end, verbStart) ? subject : null
  }

  return candidate && candidate.start > actorPos ? candidate : null
}
