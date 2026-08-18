import { convertFunding, resolveRate } from './convert'
import { allocateExactShares } from './items'
import { ceilDiv } from './money'
import type {
  ExpenseInput,
  MemberId,
  RateMode,
  SettlementContext,
} from './types'

/**
 * Per-expense consumer debits in settlement-currency minor units,
 * payer-favored: each NON-payer's exact rational share is rounded UP,
 * exactly once, at settlement minor units. The payer's own consumption
 * never circulates. Product decision (see README): the payer must never
 * receive less than they paid; the surplus per division event is bounded
 * by (participants - 1) minor units.
 */
export function consumerDebits(
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const { rate } = resolveRate(expense, mode, context)
  const debits = new Map<MemberId, bigint>()
  for (const [memberId, share] of allocateExactShares(expense)) {
    if (memberId === expense.payerId) continue
    const debit = ceilDiv(
      share.num * rate.numerator,
      share.den * rate.denominator,
    )
    if (debit !== 0n) {
      debits.set(memberId, debit)
    }
  }
  return debits
}

/**
 * What each member put INTO one expense, in settlement minor units.
 *
 * Each portion is converted at its own source's rate and rounded once, which
 * is what `convertFunding` already does; this only groups the results by who
 * fronted them. A portion with no funder of its own belongs to the payer.
 */
function contributionsByMember(
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const contributions = new Map<MemberId, bigint>()
  for (const portion of convertFunding(expense, mode, context).portions) {
    const funder = portion.funding.memberId ?? expense.payerId
    contributions.set(
      funder,
      (contributions.get(funder) ?? 0n) + portion.settlement,
    )
  }
  return contributions
}

/**
 * One expense's effect on every member's balance: what they put in, minus
 * what they consumed. Zero-sum by construction, and members the expense does
 * not touch are absent rather than zero.
 *
 * The rounding still lands where it always did. Every member except the payer
 * is charged their share rounded UP, exactly once; the payer's own
 * consumption is whatever is left of the converted total, so the surplus that
 * payer-favored rounding creates stays with the payer and never lands on a
 * co-funder who merely helped cover the bill.
 *
 * With one funder — every expense before a receipt could be co-funded — this
 * reduces exactly to "the payer is credited the sum of the other members'
 * debits", which is the definition it replaces.
 */
export function expenseNet(
  expense: ExpenseInput,
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const net = new Map<MemberId, bigint>()
  if (expense.amount === 0n) return net
  const add = (memberId: MemberId, delta: bigint) => {
    net.set(memberId, (net.get(memberId) ?? 0n) + delta)
  }

  const contributions = contributionsByMember(expense, mode, context)
  let total = 0n
  for (const amount of contributions.values()) total += amount

  let consumedByOthers = 0n
  for (const [memberId, debit] of consumerDebits(expense, mode, context)) {
    add(memberId, -debit)
    consumedByOthers += debit
  }
  add(expense.payerId, -(total - consumedByOthers))

  for (const [memberId, amount] of contributions) add(memberId, amount)

  for (const [memberId, amount] of [...net]) {
    if (amount === 0n) net.delete(memberId)
  }
  return net
}

/**
 * Net balances for a set of expenses (one checkpoint window), in settlement
 * currency minor units: payers positive, consumers negative.
 *
 * Zero-sum per expense, so zero-sum over any set of them.
 */
export function computeNetBalances(
  expenses: ExpenseInput[],
  mode: RateMode,
  context: SettlementContext,
): Map<MemberId, bigint> {
  const balances = new Map<MemberId, bigint>()
  for (const expense of expenses) {
    for (const [memberId, delta] of expenseNet(expense, mode, context)) {
      balances.set(memberId, (balances.get(memberId) ?? 0n) + delta)
    }
  }
  return balances
}
