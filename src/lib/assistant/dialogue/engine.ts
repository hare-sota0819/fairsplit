import { jongseongOf } from '../../chat-parse/ko/inflect'
import { findMembers } from '../../chat-parse/people'
import type { ChatMember } from '../../chat-parse/types'
import { emptySalience, findPronounReference, registerEntities, resolveEntity } from './salience'
import type { SalienceList } from './salience'
import type { Entity } from './types'

/**
 * Dialogue memory — what the conversation has said so far, carried by the
 * composer across turns (docs/handoff/C-conversation-layer.md, L1 step 1).
 * Pure data + pure transitions; the composer owns WHEN to observe and the
 * React ref that holds it.
 */
export interface DialogueMemory {
  turn: number
  salience: SalienceList
}

export function emptyMemory(): DialogueMemory {
  return { turn: 0, salience: emptySalience() }
}

/**
 * Registers one user utterance: every member the sentence names becomes a
 * salient person for later "걔/그 사람" resolution. Amounts/expenses are
 * NOT registered here — saved expenses are registered explicitly by the
 * composer at save time (they get real ids there), and the saved-expense
 * reference family (아까 그거) already resolves through the context-command
 * machinery, not through this memory.
 */
export function observeUserUtterance(
  memory: DialogueMemory,
  input: string,
  members: ChatMember[],
): DialogueMemory {
  const turn = memory.turn + 1
  const mentions: Entity[] = findMembers(input, members).map((h) => ({
    kind: 'person',
    id: h.id,
    label: input.slice(h.start, h.end),
    turn,
    by: 'user',
  }))
  return { turn, salience: registerEntities(memory.salience, mentions) }
}

/** Registers people the ASSISTANT named in its reply (e.g. a payer ack) —
 *  "걔" can point at a name the bot just used. */
export function observeAssistantMention(
  memory: DialogueMemory,
  memberIds: readonly string[],
  members: ChatMember[],
): DialogueMemory {
  const mentions: Entity[] = memberIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is ChatMember => m !== undefined)
    .map((m) => ({
      kind: 'person' as const,
      id: m.id,
      label: m.name,
      turn: memory.turn,
      by: 'assistant' as const,
    }))
  return { ...memory, salience: registerEntities(memory.salience, mentions) }
}

export type ReferenceOutcome =
  /** No reference expression in the utterance — pass the text through. */
  | { kind: 'none'; text: string }
  /** Resolved: the pronoun span is REWRITTEN to the member's name, so every
   *  downstream parser sees an ordinary named sentence. */
  | { kind: 'resolved'; text: string; memberId: string }
  /** A reference with two equally recent candidates — ask, never guess
   *  (guard G4). */
  | { kind: 'ambiguous'; names: string[] }
  /** A reference with nothing to point at — ask who they mean. */
  | { kind: 'unknown' }

/**
 * Resolves a person reference ("걔가 냈어") against the dialogue memory by
 * rewriting the span to the resolved member's NAME — "민수가 냈어" — which
 * is the cheapest correct integration: resolvePayer, participants, modify
 * slots and queries all already understand named sentences, so nothing
 * downstream changes.
 *
 * 걔/쟤/그 사람 never mean the SPEAKER — the actor is excluded from
 * resolution. Expense references (아까 그거) are deliberately left alone:
 * the EDIT_EXPENSE reference machinery reads those in the original text.
 */
export function resolvePersonReference(
  memory: DialogueMemory,
  input: string,
  members: ChatMember[],
  actorId: string,
): ReferenceOutcome {
  const ref = findPronounReference(input)
  if (ref === null || ref.kind !== 'person') return { kind: 'none', text: input }
  // A literal member name inside the sentence beats memory: "걔" alongside
  // "민수가" is odd but possible; only the pronoun span itself is resolved.
  const resolution = resolveEntity(memory.salience, 'person', {
    excludeIds: [actorId],
  })
  if (resolution.kind === 'none') return { kind: 'unknown' }
  if (resolution.kind === 'ambiguous') {
    const names = resolution.candidates
      .map((c) => members.find((m) => m.id === c.id)?.name ?? c.label)
      .filter((n) => n !== '')
    return { kind: 'ambiguous', names }
  }
  const member = members.find((m) => m.id === resolution.entity.id)
  if (!member) return { kind: 'unknown' }
  const rest = fixJosa(member.name, input.slice(ref.end))
  const text = input.slice(0, ref.start) + member.name + rest
  return { kind: 'resolved', text, memberId: member.id }
}

/**
 * Josa allomorph pairs that select on the PRECEDING syllable's 받침. The
 * pronoun the name replaces had its own phonology ("그 사람이" → 사람 has a
 * 받침, 유나 does not), so the josa that followed it may disagree with the
 * substituted name — "유나이 결제했어" — and every downstream matcher would
 * miss the name+josa bind. Longest form first so 이랑 wins over 이.
 */
const JOSA_PAIRS: ReadonlyArray<[withFinal: string, withoutFinal: string]> = [
  ['이랑', '랑'],
  ['이', '가'],
  ['은', '는'],
  ['을', '를'],
  ['과', '와'],
  ['아', '야'],
]

function fixJosa(name: string, rest: string): string {
  const hasFinal = jongseongOf(name[name.length - 1]) !== ''
  for (const [withFinal, withoutFinal] of JOSA_PAIRS) {
    const present = rest.startsWith(withFinal)
      ? withFinal
      : rest.startsWith(withoutFinal)
        ? withoutFinal
        : null
    if (present === null) continue
    // Only a josa at a word boundary counts — a Hangul character right
    // after it means the "josa" is the first syllable of another word
    // (걔 + "은행에…"), which must not be rewritten.
    const after = rest[present.length]
    if (after !== undefined && /[가-힣]/.test(after)) continue
    return (hasFinal ? withFinal : withoutFinal) + rest.slice(present.length)
  }
  return rest
}
