import { expenseNet } from './balances'
import { simplifyDebts } from './simplify'
import type {
  ExpenseInput,
  MemberId,
  RateMode,
  SettlementContext,
} from './types'

/**
 * Every counterparty ONE expense creates for `memberId`, and by how much, in
 * settlement minor units: positive = `memberId` owes that member.
 *
 * `pairwiseNetFor` is a fold of this, so a per-expense row on screen can
 * never disagree with the total printed above it — the same reason
 * `allocateExactShares` is derived from `explainShares`.
 *
 * ONE payer is the ordinary case and answers as it always has: every consumer
 * owes them their whole debit. A receipt two people fronted has no such
 * obvious answer — three consumers and two creditors could be paired off many
 * ways — so the expense's own net positions are matched greedily, the same
 * way the settle-up plan matches the group's. That keeps both sides of every
 * pair exactly opposite (the matching does not depend on who is looking) and
 * each row summing exactly to minus that member's net balance, which
 * apportioning each debt across creditors would not.
 */
export function pairwiseContributions(
  memberId: MemberId,
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const contributions = new Map<MemberId, bigint>()
  if (expense.amount === 0n) return contributions

  for (const transfer of simplifyDebts(expenseNet(expense, mode, context))) {
    if (transfer.from === memberId) {
      contributions.set(
        transfer.to,
        (contributions.get(transfer.to) ?? 0n) + transfer.amount,
      )
    } else if (transfer.to === memberId) {
      contributions.set(
        transfer.from,
        (contributions.get(transfer.from) ?? 0n) - transfer.amount,
      )
    }
  }
  return contributions
}

/**
 * One expense's effect on the balance between two people. Zero when the
 * expense does not sit between them at all.
 */
export function pairwiseContribution(
  meId: MemberId,
  themId: MemberId,
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): bigint {
  return pairwiseContributions(meId, expense, mode, context).get(themId) ?? 0n
}

/**
 * One member's net position against each other member, in settlement minor
 * units: positive = `memberId` owes that member ("what I consumed of their
 * payments minus what they consumed of mine").
 *
 * Uses the same payer-favored consumer debits as computeNetBalances, so the
 * values over all others sum to minus the member's net balance.
 *
 * Intentionally different from simplifyDebts: this is the raw pairwise
 * ledger, not a minimized transfer plan — recording one payment elsewhere
 * never reshuffles these numbers.
 */
export function pairwiseNetFor(
  memberId: MemberId,
  expenses: ExpenseInput[],
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const net = new Map<MemberId, bigint>()
  for (const expense of expenses) {
    for (const [other, delta] of pairwiseContributions(
      memberId,
      expense,
      mode,
      context,
    )) {
      net.set(other, (net.get(other) ?? 0n) + delta)
    }
  }
  return net
}
