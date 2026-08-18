/**
 * Dialogue-state types — the conversation memory layer (L1 of
 * docs/handoff/C-conversation-layer.md). Pure data: no I/O, no React,
 * same law as src/lib/settlement.
 *
 * Design lineage: slot-frame stack from Rasa Forms, reference/revise
 * operations from MS "Dialogue as Dataflow Synthesis", both re-derived
 * by hand in TS — no framework import (research verdict, docs/STATUS.md
 * 2026-08-14).
 */

/** What kind of thing a conversation can mention and later refer back to. */
export type EntityKind = 'person' | 'expense' | 'item' | 'amount'

/**
 * One mention, registered the turn it happened. `id` is the stable
 * handle resolution returns: a member id for a person, an expense id
 * for a saved expense, the line's name for an item, a decimal string
 * for an amount.
 */
export interface Entity {
  kind: EntityKind
  id: string
  /** Display text as it was said ("수이수이", "아까 술값"). */
  label: string
  /** Turn number of the mention (see DialogueState.turn). */
  turn: number
  /** Who said it — assistant mentions count for reference too ("걔"
   *  can point at a name the BOT just used in an answer). */
  by: 'user' | 'assistant'
}

/**
 * Result of resolving a reference ("걔", "그 사람", "아까 그거").
 * `ambiguous` is a first-class outcome, not a failure: the policy layer
 * turns it into a specific clarifying question (guard G4) instead of
 * guessing.
 */
export type Resolution =
  | { kind: 'hit'; entity: Entity }
  | { kind: 'ambiguous'; candidates: Entity[] }
  | { kind: 'none' }
