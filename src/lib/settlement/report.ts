import { computeNetBalances } from './balances'
import { simplifyDebts } from './simplify'
import type {
  ExpenseInput,
  MemberId,
  SettlementContext,
  Transfer,
} from './types'

export interface ModeOutcome {
  balances: Map<MemberId, bigint>
  transfers: Transfer[]
}

export interface ModeComparisonReport {
  avgCost: ModeOutcome
  market: ModeOutcome
  /** Per member: AVG_COST balance minus MARKET balance ("difference: ±X"). */
  deltas: Map<MemberId, bigint>
}

/** Settle the same expenses in both rate modes and diff the outcomes. */
export function compareModesReport(
  expenses: ExpenseInput[],
  context: SettlementContext,
): ModeComparisonReport {
  const avgCostBalances = computeNetBalances(expenses, 'AVG_COST', context)
  const marketBalances = computeNetBalances(expenses, 'MARKET', context)

  const deltas = new Map<MemberId, bigint>()
  const memberIds = new Set([
    ...avgCostBalances.keys(),
    ...marketBalances.keys(),
  ])
  for (const memberId of memberIds) {
    deltas.set(
      memberId,
      (avgCostBalances.get(memberId) ?? 0n) -
        (marketBalances.get(memberId) ?? 0n),
    )
  }

  return {
    avgCost: {
      balances: avgCostBalances,
      transfers: simplifyDebts(avgCostBalances),
    },
    market: {
      balances: marketBalances,
      transfers: simplifyDebts(marketBalances),
    },
    deltas,
  }
}
