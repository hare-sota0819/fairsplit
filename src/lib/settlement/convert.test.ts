import { describe, expect, test } from 'vitest'
import { convertExpense, resolveRate } from './convert'
import type { ExpenseInput, SettlementContext } from './types'

// alice exchanged at 9.31 KRW/JPY; carol's wallet has no records.
const context: SettlementContext = {
  settlementCurrency: 'KRW',
  walletsById: new Map([
    [
      'alice-jpy',
      {
        id: 'alice-jpy',
        memberId: 'alice',
        type: 'CASH',
        label: 'Cash',
        currency: 'JPY',
      },
    ],
    [
      'carol-jpy',
      {
        id: 'carol-jpy',
        memberId: 'carol',
        type: 'CASH',
        label: 'Cash',
        currency: 'JPY',
      },
    ],
  ]),
  recordsByWallet: new Map([
    [
      'alice-jpy',
      [
        {
          walletId: 'alice-jpy',
          amountPaid: 931_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
    // carol-jpy has no records: exercises the fallback.
  ]),
}

const expense = (overrides: Partial<ExpenseInput>): ExpenseInput => ({
  payerId: 'alice',
  amount: 1_000n,
  currency: 'JPY',
  marketRateSnapshot: '9.5',
  walletId: 'alice-jpy',
  participantIds: ['alice', 'bob'],
  items: [],
  ...overrides,
})

describe('resolveRate / convertExpense', () => {
  test('AVG_COST + CASH with records: payer average rate', () => {
    const converted = convertExpense(expense({}), 'AVG_COST', context)
    expect(converted).toEqual({
      amount: 9_310n,
      currency: 'KRW',
      source: 'WALLET_AVG_COST',
      walletLabel: 'Cash',
    })
  })

  test('AVG_COST + CASH without records: snapshot as fallback', () => {
    const converted = convertExpense(
      expense({ payerId: 'carol', walletId: 'carol-jpy' }),
      'AVG_COST',
      context,
    )
    expect(converted).toEqual({
      amount: 9_500n,
      currency: 'KRW',
      source: 'MARKET_FALLBACK',
      walletLabel: 'Cash',
    })
  })

  test('AVG_COST + CARD: snapshot even when the payer has records', () => {
    const converted = convertExpense(
      expense({ walletId: null }),
      'AVG_COST',
      context,
    )
    expect(converted).toEqual({
      amount: 9_500n,
      currency: 'KRW',
      source: 'MARKET_SNAPSHOT',
    })
  })

  test('AVG_COST + CARD with actualCharged: the bank line wins', () => {
    const converted = convertExpense(
      expense({ walletId: null, actualChargedAmount: 9_300n }),
      'AVG_COST',
      context,
    )
    expect(converted).toEqual({
      amount: 9_300n,
      currency: 'KRW',
      source: 'ACTUAL_CHARGED',
    })
  })

  test('MARKET ignores actualCharged for group fairness', () => {
    const converted = convertExpense(
      expense({ walletId: null, actualChargedAmount: 9_300n }),
      'MARKET',
      context,
    )
    expect(converted).toEqual({
      amount: 9_500n,
      currency: 'KRW',
      source: 'MARKET_SNAPSHOT',
    })
  })

  test('domestic expenses convert identically in both modes', () => {
    const domestic = expense({ amount: 42_000n, currency: 'KRW' })
    for (const mode of ['AVG_COST', 'MARKET'] as const) {
      expect(convertExpense(domestic, mode, context)).toEqual({
        amount: 42_000n,
        currency: 'KRW',
        source: 'MARKET_SNAPSHOT',
      })
    }
  })

  test('negative amounts (refunds) round toward zero', () => {
    // -1000 JPY * 9.5 = -9500 exactly.
    expect(
      convertExpense(expense({ amount: -1_000n }), 'MARKET', context).amount,
    ).toBe(-9_500n)
    // -333 JPY * 9.205 = -3065.265 -> toward zero -> -3065.
    expect(
      convertExpense(
        expense({ amount: -333n, marketRateSnapshot: '9.205' }),
        'MARKET',
        context,
      ).amount,
    ).toBe(-3_065n)
  })

  test('positive uneven amounts still round up', () => {
    // 333 JPY * 9.205 = 3065.265 -> up -> 3066.
    expect(
      convertExpense(
        expense({ amount: 333n, marketRateSnapshot: '9.205' }),
        'MARKET',
        context,
      ).amount,
    ).toBe(3_066n)
  })

  test('actualCharged sign must match the amount', () => {
    expect(() =>
      resolveRate(
        expense({
          walletId: null,
          amount: -1_000n,
          actualChargedAmount: 9_300n,
        }),
        'AVG_COST',
        context,
      ),
    ).toThrow()
    // Matching negative signs are fine: refund billed as -9300.
    expect(
      resolveRate(
        expense({
          walletId: null,
          amount: -1_000n,
          actualChargedAmount: -9_300n,
        }),
        'AVG_COST',
        context,
      ).source,
    ).toBe('ACTUAL_CHARGED')
  })
})
