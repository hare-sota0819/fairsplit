import { describe, expect, test } from 'vitest'
import { displayRateToStorage } from './rate-units'
import {
  computeNetBalances,
  consumedShares,
  convertExpense,
  type ExpenseInput,
  type SettlementContext,
} from './settlement'

/**
 * The two numbers a real user hit on a phone (Phase 3C brief). Both were
 * reproduced exactly by the values below before anything was changed, so
 * these pin the fixes in place.
 */

const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map(),
  recordsByWallet: new Map(),
}

/** ¥2,000 dinner in a 2-member group, paid by admin, no itemisation. */
const dinner = (rateSnapshot: string): ExpenseInput => ({
  payerId: 'admin',
  amount: 2_000n,
  currency: 'JPY',
  marketRateSnapshot: rateSnapshot,
  walletId: 'admin-jpy',
  participantIds: ['admin', 'user1'],
  items: [],
})

describe('the 100x totals bug', () => {
  test('reproduces the reported ₩916,660 when the quoted rate is stored raw', () => {
    // What shipped: "916.66" (the user meaning 100 JPY = 916.66 KRW) went
    // into marketRateSnapshot untouched, i.e. 1 JPY = 916.66 KRW.
    const balances = computeNetBalances([dinner('916.66')], 'MARKET', context)
    expect(balances.get('user1')).toBe(-916_660n)
  })

  test('unit-anchoring the same input gives the right number', () => {
    const stored = displayRateToStorage('916.66', 'JPY')
    expect(stored).toBe('9.1666')
    const balances = computeNetBalances([dinner(stored!)], 'MARKET', context)
    // ¥2,000 ≈ ₩18,333.2 → payer-favored ceiling, then half each.
    expect(convertExpense(dinner(stored!), 'MARKET', context).amount).toBe(
      18_334n,
    )
    expect(balances.get('user1')).toBe(-9_167n)
    expect(balances.get('admin')).toBe(9_167n)
  })
})

describe('a member who consumed nothing owes nothing', () => {
  const rate = displayRateToStorage('916.66', 'JPY')!

  test('every item assigned to the payer leaves the other member at zero', () => {
    const expense: ExpenseInput = {
      ...dinner(rate),
      items: [
        {
          name: 'set meal',
          unitAmount: 2_000n,
          quantity: 1,
          assignees: [{ memberId: 'admin', quantity: 1 }],
        },
      ],
    }
    expect(consumedShares(expense, 'MARKET', context).get('user1')).toBe(
      undefined,
    )
    const balances = computeNetBalances([expense], 'MARKET', context)
    expect(balances.get('user1') ?? 0n).toBe(0n)
    expect(balances.get('admin') ?? 0n).toBe(0n)
  })

  test('…even when the itemised lines fall short of the receipt total', () => {
    // Regression: the shortfall used to drop out of settlement entirely;
    // it must follow the assigned lines, i.e. stay with the payer.
    const expense: ExpenseInput = {
      ...dinner(rate),
      items: [
        {
          name: 'set meal',
          unitAmount: 1_500n,
          quantity: 1,
          assignees: [{ memberId: 'admin', quantity: 1 }],
        },
      ],
    }
    expect(consumedShares(expense, 'MARKET', context).get('admin')).toBe(
      18_334n,
    )
    expect(
      computeNetBalances([expense], 'MARKET', context).get('user1') ?? 0n,
    ).toBe(0n)
  })

  test('an unitemised expense really is an even split (not a bug)', () => {
    // The user expected "I ate it all"; nothing on the form said otherwise.
    // The engine is right here — the form now previews this split.
    const balances = computeNetBalances([dinner(rate)], 'MARKET', context)
    expect(balances.get('user1')).toBe(-9_167n)
  })

  test('dropping the other member from participants zeroes them out', () => {
    const expense: ExpenseInput = { ...dinner(rate), participantIds: ['admin'] }
    expect(
      computeNetBalances([expense], 'MARKET', context).get('user1') ?? 0n,
    ).toBe(0n)
  })
})
