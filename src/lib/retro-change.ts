import type { MemberId } from '@/lib/settlement'

/**
 * The rules a retroactive change is decided by — all of them, and nothing
 * else. Pure, so the two that no screenshot can show are pinned by tests:
 * auto-approval when nobody is worse off, and automatic REJECTION at the
 * deadline.
 *
 * The one sentence the whole module serves: numbers on the settlement screen
 * never change without explicit consent.
 */

/** A non-responder is nudged after this long. */
export const RETRO_CHANGE_REMINDER_HOURS = 24

/**
 * And the request dies after this long — REJECTED, not approved. Silence is
 * not consent: a deadline that approved by default would move money nobody
 * agreed to move, which is the exact failure this feature exists to prevent.
 */
export const RETRO_CHANGE_EXPIRY_HOURS = 72

const HOUR_MS = 60 * 60 * 1000

/**
 * The smallest change worth asking about: one minor unit of the settlement
 * currency. Below it there is nothing to consent to — and at zero there is
 * nobody to ask, which is what makes the auto-approval shortcut a consequence
 * of the stakeholder rule rather than an exception to it.
 *
 * Deliberately NOT raised to swallow "rounding noise". A one- or two-unit move
 * caused by surplus redistribution is still someone's money moving, and the
 * spec is explicit that it follows the same rule as any other.
 */
export const WORSENING_THRESHOLD = 1n

/** Per member, `after - before` in settlement minor units. */
export type BalanceDiff = Map<MemberId, bigint>

/**
 * What a proposal would do to each member's final balance.
 *
 * Balances are the engine's: positive means the member is owed. So a NEGATIVE
 * diff is a member who ends up worse off, which is the whole question.
 *
 * Every member named on either side gets an entry, including zeros, so a
 * caller can tell "unaffected" apart from "not in this group".
 */
export function balanceDiff(
  before: ReadonlyMap<MemberId, bigint>,
  after: ReadonlyMap<MemberId, bigint>,
): BalanceDiff {
  const diff: BalanceDiff = new Map()
  for (const memberId of new Set([...before.keys(), ...after.keys()])) {
    diff.set(
      memberId,
      (after.get(memberId) ?? 0n) - (before.get(memberId) ?? 0n),
    )
  }
  return diff
}

/**
 * Who has to agree: every member the change leaves worse off by at least one
 * minor unit, EXCEPT whoever is asking for it.
 *
 * Members who are unaffected or who BENEFIT are not asked and are not
 * notified. Sorted, so the consent set of a given diff is one value rather
 * than one of n! orderings — the audit entry stores it.
 *
 * The requester is excluded because a proposal is already their consent.
 * This is not a liberty taken with the spec — it is the only reading under
 * which the spec's own example of the auto-approval case works: "the requester
 * is reducing their own over-entered expense" is a change where everyone else
 * gains and the REQUESTER ends up owed less, so a literal "every member who
 * worsens" would have them consenting to their own request and nothing would
 * ever auto-approve. Nobody else's money moves against them, which is the
 * thing consent protects.
 */
export function consentSet(
  diff: BalanceDiff,
  requesterId?: MemberId,
): MemberId[] {
  return [...diff.entries()]
    .filter(
      ([memberId, delta]) =>
        memberId !== requesterId && delta <= -WORSENING_THRESHOLD,
    )
    .map(([memberId]) => memberId)
    .sort()
}

/**
 * Whether the change applies immediately, with no consent flow at all.
 *
 * True exactly when nobody is worse off — the requester correcting their own
 * over-entered expense, or a change everyone gains from. This is the same
 * predicate as "the consent set is empty", written once so the two can never
 * disagree.
 */
export function isAutoApproved(
  diff: BalanceDiff,
  requesterId?: MemberId,
): boolean {
  return consentSet(diff, requesterId).length === 0
}

/** When a request opened at `createdAt` stops accepting answers. */
export function expiryOf(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RETRO_CHANGE_EXPIRY_HOURS * HOUR_MS)
}

/** When its non-responders should be nudged. */
export function reminderDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RETRO_CHANGE_REMINDER_HOURS * HOUR_MS)
}

export type PendingProgress =
  /** Still open, nobody nudged yet. */
  | 'OPEN'
  /** Still open, and the non-responders are due a reminder. */
  | 'REMIND'
  /** Past the deadline: it must be rejected before it is shown or acted on. */
  | 'EXPIRED'

/**
 * Where a still-pending request stands right now.
 *
 * Evaluated on READ rather than by a scheduler, because this app has none —
 * no cron, no worker, no push. The consequence is that a request is not
 * rejected the instant its 72 hours are up but the instant anyone next looks,
 * and the two are indistinguishable to every caller: nothing may act on a
 * request without asking this first, so an expired one can never be approved
 * by someone who got there late.
 */
export function pendingProgress(
  createdAt: Date,
  now: Date,
  reminderSentAt: Date | null,
): PendingProgress {
  if (now.getTime() >= expiryOf(createdAt).getTime()) {
    return 'EXPIRED'
  }
  if (
    reminderSentAt === null &&
    now.getTime() >= reminderDueAt(createdAt).getTime()
  ) {
    return 'REMIND'
  }
  return 'OPEN'
}

export type StakeholderAnswer = 'APPROVED' | 'REJECTED' | null

export type RequestOutcome = 'APPROVED' | 'REJECTED' | 'PENDING'

/**
 * The verdict a set of answers adds up to.
 *
 * One rejection is enough to end it — there is no majority anywhere in this
 * feature, because a balance is owed to a person and not to a quorum. It
 * carries only when EVERY stakeholder has said yes; anyone still silent
 * leaves it pending until they answer or the deadline rejects it for them.
 *
 * An empty stakeholder list resolves to APPROVED, which is the auto-approval
 * case arriving by the same road.
 */
export function outcomeOf(
  answers: readonly StakeholderAnswer[],
): RequestOutcome {
  if (answers.some((answer) => answer === 'REJECTED')) {
    return 'REJECTED'
  }
  return answers.every((answer) => answer === 'APPROVED')
    ? 'APPROVED'
    : 'PENDING'
}
