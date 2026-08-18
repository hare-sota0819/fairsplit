import { describe, expect, test } from 'vitest'
import { consumedShares } from './consumed'
import type { ExpenseInput, SettlementContext } from './types'

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
  ]),
}

describe('consumedShares', () => {
  test('every sharing member gets their converted share, payer included', () => {
    const expense: ExpenseInput = {
      payerId: 'alice',
      amount: 30_000n,
      currency: 'JPY',
      marketRateSnapshot: '9.20',
      walletId: 'alice-jpy',
      participantIds: ['alice', 'bob', 'carol'],
      items: [],
    }
    const shares = consumedShares(expense, 'AVG_COST', context)
    expect(shares.get('alice')).toBe(93_100n)
    expect(shares.get('bob')).toBe(93_100n)
    expect(shares.get('carol')).toBe(93_100n)
  })

  test('uneven splits round each share up (display estimate)', () => {
    const expense: ExpenseInput = {
      payerId: 'alice',
      amount: 10_000n,
      currency: 'KRW',
      marketRateSnapshot: '1',
      walletId: 'alice-jpy',
      participantIds: ['alice', 'bob', 'carol'],
      items: [],
    }
    const shares = consumedShares(expense, 'MARKET', context)
    expect(shares.get('alice')).toBe(3_334n)
    expect(shares.get('bob')).toBe(3_334n)
    expect(shares.get('carol')).toBe(3_334n)
  })

  test('itemized expenses follow the item allocation', () => {
    const expense: ExpenseInput = {
      payerId: 'alice',
      amount: 3_800n,
      currency: 'KRW',
      marketRateSnapshot: '1',
      walletId: 'alice-jpy',
      participantIds: ['alice', 'bob'],
      items: [
        {
          name: 'dish',
          unitAmount: 3_000n,
          quantity: 1,
          assignees: [
            { memberId: 'alice', quantity: 1 },
            { memberId: 'bob', quantity: 1 },
          ],
        },
        {
          name: 'sake',
          unitAmount: 800n,
          quantity: 1,
          assignees: [{ memberId: 'bob', quantity: 1 }],
        },
      ],
    }
    const shares = consumedShares(expense, 'MARKET', context)
    expect(shares.get('alice')).toBe(1_500n)
    expect(shares.get('bob')).toBe(2_300n)
  })
})
