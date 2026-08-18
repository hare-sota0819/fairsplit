import { describe, expect, it } from 'vitest'
import { computeNetBalances, consumedShares, convertExpense } from './index'
import type {
  ExpenseInput,
  MemberId,
  RateMode,
  SettlementContext,
} from './types'

/**
 * Home prints "what I fronted" and "my share of what we bought" and tells the
 * user those two explain their balance. They do — but not to the minor unit.
 *
 * `consumedShares` rounds every member's share UP (its own doc comment: per-
 * expense consumed shares "may sum to slightly more than the total"), while
 * `computeNetBalances` credits the payer only the sum of the OTHER members'
 * (also rounded-up) debits. So "fronted - consumed" drifts from the real net
 * balance whenever the split does not divide evenly — always in the payer's
 * favour, because the payer's own consumedShares entry is rounded up too much
 * relative to what consumerDebits actually charged the others.
 */
describe('fronted minus consumed, against the net balance', () => {
  const mode: RateMode = 'MARKET'
  const context: SettlementContext = {
    settlementCurrency: 'KRW',
    walletsById: new Map(),
    recordsByWallet: new Map(),
  }

  function makeExpense(overrides: {
    payerId: MemberId
    amount: bigint
    participantIds: MemberId[]
  }): ExpenseInput {
    return {
      payerId: overrides.payerId,
      amount: overrides.amount,
      currency: 'KRW',
      walletId: null,
      marketRateSnapshot: '1',
      participantIds: overrides.participantIds,
      items: [],
    }
  }

  const fronted = (
    memberId: MemberId,
    expenses: ExpenseInput[],
    mode: RateMode,
    context: SettlementContext,
  ): bigint =>
    expenses
      .filter((e) => e.payerId === memberId)
      .reduce((sum, e) => sum + convertExpense(e, mode, context).amount, 0n)

  const consumed = (
    memberId: MemberId,
    expenses: ExpenseInput[],
    mode: RateMode,
    context: SettlementContext,
  ): bigint =>
    expenses.reduce(
      (sum, e) => sum + (consumedShares(e, mode, context).get(memberId) ?? 0n),
      0n,
    )

  it('matches exactly when every split divides evenly', () => {
    const expenses = [
      makeExpense({
        payerId: 'alice',
        amount: 9000n,
        participantIds: ['alice', 'bob', 'carol'],
      }),
    ]
    const net = computeNetBalances(expenses, mode, context).get('alice') ?? 0n
    expect(
      fronted('alice', expenses, mode, context) -
        consumed('alice', expenses, mode, context),
    ).toBe(net)
  })

  it('drifts by at most one minor unit per co-participant when it does not', () => {
    // 10,000 among 3: each non-payer is charged 3,334 (rounded up, payer
    // favoured), so the payer effectively consumed 3,332 while consumedShares
    // reports 3,334 for them.
    const expenses = [
      makeExpense({
        payerId: 'alice',
        amount: 10000n,
        participantIds: ['alice', 'bob', 'carol'],
      }),
    ]
    const net = computeNetBalances(expenses, mode, context).get('alice') ?? 0n
    const difference =
      fronted('alice', expenses, mode, context) -
      consumed('alice', expenses, mode, context)
    expect(difference).not.toBe(net)
    expect(net - difference).toBeGreaterThan(0n)
    expect(net - difference).toBeLessThanOrEqual(2n)
  })
})
