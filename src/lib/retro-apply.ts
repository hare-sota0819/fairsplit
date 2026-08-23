import type { RetroProposal } from '@/lib/retro-proposal'

/**
 * Applying an approved retroactive change — planned as data, written through a
 * narrow interface.
 *
 * The spec's demand is that a partially updated state must never be
 * observable, "even transiently". Two things deliver that, and they are
 * different things:
 *
 *  1. Every write goes through ONE `prisma.$transaction`. That is what makes
 *     the rollback real, and it is Postgres's job, not this module's.
 *  2. This module must never write anywhere else. Nothing here touches the
 *     global Prisma client — every effect goes through the `RetroWriter` it is
 *     handed — so there is no second connection for a half-finished change to
 *     leak out of, and a step that throws stops the steps after it.
 *
 * (2) is what a unit test can actually hold this code to, and
 * `retro-apply.test.ts` does: it hands in a writer that fails at step k and
 * asserts nothing after k was attempted and the failure propagated out to the
 * caller that owns the transaction.
 *
 * On the scale of the recalculation: because a freeze is stored as a per-
 * portion RATE and every balance is re-derived from those rates, approving a
 * change rewrites only the expense it is about. No other expense's frozen
 * value can move, since rates come from exchange records and nothing here
 * touches one. The impacted checkpoints are still all recorded — an edit that
 * moves a timestamp hands the expense from one checkpoint to another, and both
 * of their balances change — but they change by re-derivation, with no stored
 * total anywhere to update. That is the payoff the spec asked for when it
 * ruled out storing balance totals.
 */

export type RetroDecision =
  'APPROVED' | 'AUTO_APPROVED' | 'REJECTED' | 'EXPIRED'

/** The audit entry every terminal outcome appends — refusals included. */
export interface RetroAuditEntry {
  kind: `RETRO_CHANGE_${RetroDecision}`
  requestId: string
  expenseId: string
  changeKind: 'EDIT' | 'CANCEL' | 'RESTORE'
  requestedById: string
  /** Every checkpoint whose balance this change moves. */
  checkpointIds: string[]
  /** Each stakeholder and what they said; null is "never answered". */
  stakeholders: {
    memberId: string
    response: 'APPROVED' | 'REJECTED' | null
  }[]
  /** Per member, `after - before` in settlement minor units, as strings. */
  balanceDiff: Record<string, string>
  /** EDIT only: what was proposed. */
  proposal: RetroProposal | null
}

/** What an approved change does to the expense itself. */
export type RetroEffect =
  | { kind: 'EDIT'; proposal: RetroProposal }
  | { kind: 'CANCEL' }
  | { kind: 'RESTORE' }

export interface RetroPlan {
  requestId: string
  expenseId: string
  /** Who is performing the decision; null for an expiry nobody performed. */
  actorId: string | null
  decision: RetroDecision
  decidedAt: Date
  /** Present only when the decision applies the change. */
  effect: RetroEffect | null
  audit: RetroAuditEntry
}

/**
 * Every effect an approval has, in the order it must happen.
 *
 * The order is not cosmetic: the freeze columns are written with the funding
 * rows that carry them, and `frozenAtCheckpointId` — the flag that claims
 * "this is settled" — goes last, so it is never true before the rates it
 * promises exist.
 */
export interface RetroWriter {
  /** Delete this expense's participants, items and funding rows. */
  clearExpenseChildren(expenseId: string): Promise<void>
  /** Rewrite the expense and recreate its children from the proposal. */
  writeProposal(expenseId: string, proposal: RetroProposal): Promise<void>
  /** Soft delete or restore. */
  setCancelled(
    expenseId: string,
    cancelled: boolean,
    byMemberId: string,
  ): Promise<void>
  /** The "settled" flag, written last. */
  setFrozenAt(expenseId: string, checkpointId: string | null): Promise<void>
  /** Close the request out. */
  decideRequest(
    requestId: string,
    decision: RetroDecision,
    decidedAt: Date,
  ): Promise<void>
  /** Append-only; called exactly once per terminal outcome. */
  appendAudit(entry: RetroAuditEntry, actorId: string | null): Promise<void>
}

/**
 * Run a plan. Every await goes through `writer`, so whatever transaction the
 * caller opened is the only place any of this lands — and a throw from any
 * step leaves the rest unattempted for that transaction to roll back.
 */
export async function applyRetroPlan(
  writer: RetroWriter,
  plan: RetroPlan,
): Promise<void> {
  const effect = plan.effect
  if (effect !== null) {
    if (effect.kind === 'EDIT') {
      await writer.clearExpenseChildren(plan.expenseId)
      await writer.writeProposal(plan.expenseId, effect.proposal)
      await writer.setFrozenAt(
        plan.expenseId,
        effect.proposal.frozenAtCheckpointId,
      )
    } else {
      // A cancel or a restore changes no rate, so the freeze it already
      // carries stays exactly as it was — which is the point: the expense is
      // leaving or re-entering the balance, not being repriced.
      await writer.setCancelled(
        plan.expenseId,
        effect.kind === 'CANCEL',
        // An expiry never produces an effect, so there is always an actor here.
        plan.actorId ?? plan.audit.requestedById,
      )
    }
  }
  await writer.decideRequest(plan.requestId, plan.decision, plan.decidedAt)
  // Last, and unconditional: an outcome that changed nothing — a rejection, an
  // expiry — is still something the group decided, and a log that recorded
  // only the changes that went through would be a record of agreement rather
  // than a record of what happened.
  await writer.appendAudit(plan.audit, plan.actorId)
}
