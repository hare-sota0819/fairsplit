import type { Entity, EntityKind, Resolution } from './types'

/**
 * The salience list — a recency-ordered registry of everything the
 * conversation has mentioned (by either side), which is what makes
 * "걔가 냈어" answerable. Centering theory reduced to practice
 * (docs/handoff/C-conversation-layer.md L1): resolution scans
 * newest-first for the first type-compatible entity; two candidates
 * from the SAME most-recent turn are reported as ambiguous so the
 * policy can ask (guard G4) instead of guessing.
 */
export interface SalienceList {
  entities: Entity[]
}

/** Bounded so dialogue state stays O(1) per conversation — beyond this
 *  depth a human would not say bare "걔" and expect to be understood
 *  either. */
const MAX_ENTITIES = 20

export function emptySalience(): SalienceList {
  return { entities: [] }
}

/**
 * Registers this turn's mentions. A re-mention of the same (kind, id)
 * REFRESHES recency rather than duplicating — saying 민수's name again
 * moves him back to the front of a human listener's attention too.
 */
export function registerEntities(list: SalienceList, mentions: Entity[]): SalienceList {
  const kept = list.entities.filter(
    (e) => !mentions.some((m) => m.kind === e.kind && m.id === e.id),
  )
  return { entities: [...mentions, ...kept].slice(0, MAX_ENTITIES) }
}

export interface ResolveConstraints {
  /** Ids the reference cannot mean — 걔 never refers to the speaker. */
  excludeIds?: string[]
}

export function resolveEntity(
  list: SalienceList,
  kind: EntityKind,
  constraints: ResolveConstraints,
): Resolution {
  const eligible = list.entities.filter(
    (e) => e.kind === kind && !(constraints.excludeIds ?? []).includes(e.id),
  )
  if (eligible.length === 0) return { kind: 'none' }
  const newestTurn = eligible[0].turn
  const sameTurn = eligible.filter((e) => e.turn === newestTurn)
  if (sameTurn.length > 1) return { kind: 'ambiguous', candidates: sameTurn }
  return { kind: 'hit', entity: eligible[0] }
}

// --- reference expressions --------------------------------------------------

export interface PronounReference {
  kind: EntityKind
  /** The matched span, for consumption by callers that rewrite input. */
  start: number
  end: number
}

/**
 * Person pronouns: 걔/쟤/그 사람(그사람)/그분/그 애. 걔/쟤 need no
 * boundary guard — no ordinary Korean word contains the syllable. The
 * 그-family requires its noun to follow immediately (spaced or glued),
 * which is what keeps 그사이/그날 from firing.
 */
const PERSON_REF_RE = /걔|쟤|그\s?사람|그분|그\s?애/

/**
 * Expense references: 아까 그거 / 아까 그 X / 그 술값-shaped "그 +
 * noun" only when anchored by 아까/방금/그때 (a bare "그거" alone is too
 * promiscuous — it also means "that thing you just said"). The anchored
 * form is exactly the shape the context-command parser (parsers/
 * reference.ts) already reads for saved-expense edits; this recognizer
 * exists for the DIALOGUE layer to resolve against unsaved frames too.
 */
const EXPENSE_REF_RE = /(?:아까|방금|그때)\s?(?:그거|그\s?[가-힣]{1,6})/

export function findPronounReference(text: string): PronounReference | null {
  const person = PERSON_REF_RE.exec(text)
  const expense = EXPENSE_REF_RE.exec(text)
  // Person wins a tie: "아까 걔가..." is about the person.
  if (person && (!expense || person.index <= expense.index)) {
    return { kind: 'person', start: person.index, end: person.index + person[0].length }
  }
  if (expense) {
    return { kind: 'expense', start: expense.index, end: expense.index + expense[0].length }
  }
  return null
}
