import { resolveRate } from './convert'
import { allocateExactShares } from './items'
import { ceilDiv } from './money'
import type {
  ExpenseInput,
  MemberId,
  RateMode,
  SettlementContext,
} from './types'

/**
 * Each sharing member's own consumption for one expense (payer included),
 * in settlement minor units, rounded up once per share. Display helper for
 * "what I ate/used" — balances use consumerDebits instead (payer-favored),
 * so per-expense consumed shares may sum to slightly more than the total.
 */
export function consumedShares(
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const { rate } = resolveRate(expense, mode, context)
  const shares = new Map<MemberId, bigint>()
  for (const [memberId, share] of allocateExactShares(expense)) {
    shares.set(
      memberId,
      ceilDiv(share.num * rate.numerator, share.den * rate.denominator),
    )
  }
  return shares
}
