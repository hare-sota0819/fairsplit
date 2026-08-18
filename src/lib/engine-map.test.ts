import { describe, expect, test } from 'vitest'
import { isSettleable, toEngineExpense } from './engine-map'

describe('isSettleable', () => {
  const at = new Date()
  test('only non-personal, non-cancelled expenses settle', () => {
    expect(isSettleable({ isPersonal: false, cancelledAt: null })).toBe(true)
    expect(isSettleable({ isPersonal: true, cancelledAt: null })).toBe(false)
    expect(isSettleable({ isPersonal: false, cancelledAt: at })).toBe(false)
    expect(isSettleable({ isPersonal: true, cancelledAt: at })).toBe(false)
  })
})

describe('toEngineExpense', () => {
  test('maps rows, items and assignments into ExpenseInput', () => {
    const row = {
      payerId: 'm1',
      amount: 4_900n,
      currency: 'KRW',
      marketRateSnapshot: { toString: () => '1' },
      funding: [
        { amount: 4_900n, walletId: 'wallet-1', actualChargedAmount: null },
      ],
      participants: [{ memberId: 'm1' }, { memberId: 'm2' }],
      items: [
        {
          name: 'sashimi',
          unitAmount: 3_000n,
          quantity: 1,
          assignments: [
            { memberId: 'm1', quantity: 1 },
            { memberId: 'm2', quantity: 1 },
          ],
        },
        { name: 'charge', unitAmount: 500n, quantity: 1, assignments: [] },
      ],
    }
    expect(toEngineExpense(row)).toEqual({
      payerId: 'm1',
      amount: 4_900n,
      currency: 'KRW',
      marketRateSnapshot: '1',
      funding: [{ amount: 4_900n, walletId: 'wallet-1' }],
      participantIds: ['m1', 'm2'],
      items: [
        {
          name: 'sashimi',
          unitAmount: 3_000n,
          quantity: 1,
          splitMode: 'BY_QUANTITY',
          assignees: [
            { memberId: 'm1', quantity: 1 },
            { memberId: 'm2', quantity: 1 },
          ],
        },
        {
          name: 'charge',
          unitAmount: 500n,
          quantity: 1,
          splitMode: 'BY_QUANTITY',
          assignees: [],
        },
      ],
    })
  })

  test('carries a BY_AMOUNT line through with its stored shares', () => {
    const mapped = toEngineExpense({
      payerId: 'm1',
      amount: 1_505n,
      currency: 'JPY',
      marketRateSnapshot: { toString: () => '1' },
      funding: [{ amount: 1_505n, walletId: null }],
      participants: [{ memberId: 'm1' }, { memberId: 'm2' }],
      items: [
        {
          name: 'skewers',
          unitAmount: 301n,
          quantity: 5,
          splitMode: 'BY_AMOUNT',
          assignments: [
            { memberId: 'm1', quantity: 1, amount: 752n },
            { memberId: 'm2', quantity: 1, amount: 753n },
          ],
        },
      ],
    })
    expect(mapped.items[0].splitMode).toBe('BY_AMOUNT')
    expect(mapped.items[0].assignees).toEqual([
      { memberId: 'm1', quantity: 1, amount: 752n },
      { memberId: 'm2', quantity: 1, amount: 753n },
    ])
  })

  test('defaults a pre-4D-A row with no splitMode to BY_QUANTITY', () => {
    const mapped = toEngineExpense({
      payerId: 'm1',
      amount: 900n,
      currency: 'JPY',
      marketRateSnapshot: { toString: () => '1' },
      funding: [{ amount: 900n, walletId: null }],
      participants: [{ memberId: 'm1' }],
      items: [
        {
          name: 'tea',
          unitAmount: 300n,
          quantity: 3,
          assignments: [{ memberId: 'm1', quantity: 3, amount: null }],
        },
      ],
    })
    expect(mapped.items[0].splitMode).toBe('BY_QUANTITY')
    // A null amount must not become `amount: null` on the engine input.
    expect(mapped.items[0].assignees).toEqual([{ memberId: 'm1', quantity: 3 }])
  })
})
