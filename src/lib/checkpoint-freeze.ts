import {
  toEngineExpense,
  type ExpenseRow,
  type FundingRow,
} from '@/lib/engine-map'
import {
  convertFunding,
  type RateMode,
  type RateSource,
  type SettlementContext,
} from '@/lib/settlement'

/**
 * Turning a checkpoint into per-portion frozen rates — the whole of the
 * "barrier, not a snapshot" rule, as one pure function.
 *
 * Pure on purpose. Writing the freeze is a transaction; DECIDING the freeze is
 * arithmetic, and arithmetic that decides what people owe each other has to be
 * testable without a database in the room. `applyFreeze` (checkpoints/actions)
 * is the thin half that writes what this returns.
 *
 * What gets pinned is the RATE, not just the total. Shares are allocated from
 * the exact rational and rounded once each, so re-deriving a member's figure
 * from the frozen rate reproduces the number they were shown — which storing a
 * balance total could not do the moment an expense was edited or cancelled.
 */

/** A funding row that can be frozen: the engine's shape plus its row id. */
export interface FreezableFundingRow extends FundingRow {
  id: string
}

/** An expense row that can be frozen: the engine's shape plus its identity. */
export interface FreezableExpenseRow extends ExpenseRow {
  id: string
  timestamp: Date
  /** Non-null = an earlier checkpoint already pinned it; leave it alone. */
  frozenAtCheckpointId: string | null
  funding: FreezableFundingRow[]
}

/** One funding portion's pinned conversion, ready to be written. */
export interface FrozenPortionPlan {
  fundingId: string
  rateNum: bigint
  rateDen: bigint
  source: RateSource
  /** The portion in settlement minor units, rounded once. */
  amount: bigint
}

export interface FrozenExpensePlan {
  expenseId: string
  portions: FrozenPortionPlan[]
  /** The expense in settlement minor units: the sum of its portions. */
  settlementAmount: bigint
}

/**
 * Whether an expense falls inside the period a checkpoint closes.
 *
 * INCLUSIVE of the boundary instant, which is the membership rule the schema
 * has documented since Phase 1 ("an expense belongs to the nearest checkpoint
 * whose timestamp is >= the expense timestamp"). The spec's wording is
 * "before"; the difference is only ever a same-instant tie, and settling "up
 * to now" plainly means including the receipt just entered.
 */
export function isBeforeCheckpoint(
  expenseTimestamp: Date,
  boundary: Date,
): boolean {
  return expenseTimestamp.getTime() <= boundary.getTime()
}

/**
 * Whether a checkpoint has already settled this expense.
 *
 * The single question every mutation has to ask before it writes. A frozen
 * expense is not read-only for tidiness: editing one moves money the group
 * has already handed each other, which only its worse-off members may agree
 * to (the retroactive change flow).
 */
export function isFrozenExpense(expense: {
  frozenAtCheckpointId: string | null
}): boolean {
  return expense.frozenAtCheckpointId !== null
}

/**
 * The expenses a new checkpoint at `boundary` would freeze, with the rate
 * each of their funding portions is pinned at.
 *
 * Already-frozen expenses are skipped rather than re-frozen: an earlier
 * checkpoint settled them, and re-deriving their rates now would read the
 * live top-ups the barrier exists to shut out.
 *
 * Cancelled and personal expenses ARE frozen even though neither reaches the
 * balance. A cancelled expense can be restored and a personal one can be
 * un-flagged, and either would then land in a settled period carrying a rate
 * computed from whatever was logged since.
 */
export function planFreeze(
  rows: readonly FreezableExpenseRow[],
  boundary: Date,
  mode: RateMode,
  context: SettlementContext,
): FrozenExpensePlan[] {
  const plans: FrozenExpensePlan[] = []
  for (const row of rows) {
    if (
      row.frozenAtCheckpointId !== null ||
      !isBeforeCheckpoint(row.timestamp, boundary)
    ) {
      continue
    }
    const converted = convertFunding(toEngineExpense(row), mode, context)
    const portions = converted.portions.map((portion, index) => {
      const source = portion.resolution.source
      if (portion.resolution.frozen === true) {
        // Unreachable via the filter above; asserted because a freeze that
        // recorded 'FROZEN' as its source would have erased the one fact it
        // exists to keep.
        throw new Error('Cannot freeze a portion that is already frozen')
      }
      return {
        fundingId: row.funding[index].id,
        rateNum: portion.resolution.rate.numerator,
        rateDen: portion.resolution.rate.denominator,
        source,
        amount: portion.settlement,
      }
    })
    plans.push({
      expenseId: row.id,
      portions,
      settlementAmount: converted.amount,
    })
  }
  return plans
}
