import { describe, expect, test } from 'vitest'
import { compareModesReport } from './report'
import type { ExpenseInput, SettlementContext } from './types'

// Same Japan-trip fixture as balances.test.ts.
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
      'bob-jpy',
      {
        id: 'bob-jpy',
        memberId: 'bob',
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
    [
      'bob-jpy',
      [
        {
          walletId: 'bob-jpy',
          amountPaid: 903_000n,
          amountReceived: 100_000n,
          currency: 'JPY',
        },
      ],
    ],
  ]),
}

const trip: ExpenseInput[] = [
  {
    payerId: 'alice',
    amount: 30_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.20',
    walletId: 'alice-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
  {
    payerId: 'bob',
    amount: 60_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.15',
    walletId: 'bob-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
  {
    payerId: 'carol',
    amount: 12_000n,
    currency: 'JPY',
    marketRateSnapshot: '9.10',
    walletId: 'carol-jpy',
    participantIds: ['alice', 'bob', 'carol'],
    items: [],
  },
]

describe('compareModesReport', () => {
  test('reports balances and transfers for both modes over the same data', () => {
    const report = compareModesReport(trip, context)
    expect(report.avgCost.balances.get('bob')).toBe(231_700n)
    expect(report.market.balances.get('bob')).toBe(237_600n)
    // Both transfer lists settle toward bob, the sole creditor.
    expect(report.avgCost.transfers).toEqual([
      { from: 'carol', to: 'bob', amount: 200_900n },
      { from: 'alice', to: 'bob', amount: 30_800n },
    ])
    expect(report.market.transfers).toEqual([
      { from: 'carol', to: 'bob', amount: 202_200n },
      { from: 'alice', to: 'bob', amount: 35_400n },
    ])
  })

  test('per-member deltas are avgCost minus market and sum to zero', () => {
    const report = compareModesReport(trip, context)
    expect(report.deltas.get('alice')).toBe(4_600n)
    expect(report.deltas.get('bob')).toBe(-5_900n)
    expect(report.deltas.get('carol')).toBe(1_300n)
    const sum = [...report.deltas.values()].reduce((a, b) => a + b, 0n)
    expect(sum).toBe(0n)
  })
})
