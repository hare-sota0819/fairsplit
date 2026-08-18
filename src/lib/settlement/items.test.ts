import { describe, expect, test } from 'vitest'
import { allocateExactShares, validateReceipt } from './items'
import { ratio } from './money'
import type { ExpenseInput } from './types'

const expense = (
  overrides: Partial<ExpenseInput>,
): Pick<ExpenseInput, 'amount' | 'items' | 'participantIds'> => ({
  amount: 0n,
  participantIds: [],
  items: [],
  ...overrides,
})

describe('validateReceipt', () => {
  test('passes when items sum to the receipt total', () => {
    const items = [
      { name: 'a', unitAmount: 300n, quantity: 1, assignees: [] },
      { name: 'b', unitAmount: 700n, quantity: 1, assignees: [] },
    ]
    expect(validateReceipt(items, 1000n)).toEqual({ ok: true, discrepancy: 0n })
  })

  test('fails with the signed discrepancy', () => {
    const items = [{ name: 'a', unitAmount: 990n, quantity: 1, assignees: [] }]
    expect(validateReceipt(items, 1000n)).toEqual({
      ok: false,
      discrepancy: -10n,
    })
  })
})

describe('allocateExactShares', () => {
  test('no items: equal exact split among participants', () => {
    const shares = allocateExactShares(
      expense({ amount: 10_000n, participantIds: ['a', 'b', 'c'] }),
    )
    expect(shares.get('a')).toEqual(ratio(10_000n, 3n))
    expect(shares.get('b')).toEqual(ratio(10_000n, 3n))
    expect(shares.get('c')).toEqual(ratio(10_000n, 3n))
  })

  test('assigned items split equally among their assignees', () => {
    const shares = allocateExactShares(
      expense({
        amount: 3_800n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'dish',
            unitAmount: 3_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 800n,
            quantity: 1,
            assignees: [{ memberId: 'b', quantity: 1 }],
          },
        ],
      }),
    )
    expect(shares.get('a')).toEqual(ratio(1_500n, 1n))
    expect(shares.get('b')).toEqual(ratio(2_300n, 1n))
  })

  test('unassigned lines distribute proportionally to assigned subtotals', () => {
    const shares = allocateExactShares(
      expense({
        amount: 3_900n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'dish',
            unitAmount: 3_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 800n,
            quantity: 1,
            assignees: [{ memberId: 'b', quantity: 1 }],
          },
          { name: 'tax', unitAmount: 100n, quantity: 1, assignees: [] },
        ],
      }),
    )
    // a: 1500 + 100*1500/3800 = 29250/19, b: 2300 + 100*2300/3800 = 44850/19
    expect(shares.get('a')).toEqual(ratio(29_250n, 19n))
    expect(shares.get('b')).toEqual(ratio(44_850n, 19n))
  })

  test('only unassigned lines: equal split among participants', () => {
    const shares = allocateExactShares(
      expense({
        amount: 1_000n,
        participantIds: ['a', 'b', 'c'],
        items: [
          { name: 'tax', unitAmount: 1_000n, quantity: 1, assignees: [] },
        ],
      }),
    )
    expect(shares.get('a')).toEqual(ratio(1_000n, 3n))
    expect(shares.get('b')).toEqual(ratio(1_000n, 3n))
    expect(shares.get('c')).toEqual(ratio(1_000n, 3n))
  })

  test('shares sum exactly to the allocated total', () => {
    const shares = allocateExactShares(
      expense({
        amount: 3_900n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'dish',
            unitAmount: 3_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 800n,
            quantity: 1,
            assignees: [{ memberId: 'b', quantity: 1 }],
          },
          { name: 'tax', unitAmount: 100n, quantity: 1, assignees: [] },
        ],
      }),
    )
    let num = 0n
    let den = 1n
    for (const share of shares.values()) {
      num = num * share.den + share.num * den
      den = den * share.den
    }
    expect(num).toBe(3_900n * den)
  })

  test('a shortfall between the items and the total is allocated too', () => {
    // Items cover only 500 of a 2,000 expense: the missing 1,500 is an
    // implicit unassigned line, not money that vanishes from settlement.
    const shares = allocateExactShares(
      expense({
        amount: 2_000n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'dish',
            unitAmount: 500n,
            quantity: 1,
            assignees: [{ memberId: 'a', quantity: 1 }],
          },
        ],
      }),
    )
    expect(shares.get('a')).toEqual(ratio(2_000n, 1n))
    expect(shares.get('b')).toBeUndefined()
  })

  test('an overshoot between the items and the total is netted off', () => {
    const shares = allocateExactShares(
      expense({
        amount: 1_000n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'dish',
            unitAmount: 800n,
            quantity: 1,
            assignees: [{ memberId: 'a', quantity: 1 }],
          },
          {
            name: 'sake',
            unitAmount: 400n,
            quantity: 1,
            assignees: [{ memberId: 'b', quantity: 1 }],
          },
        ],
      }),
    )
    // 1,200 of items scaled down to the 1,000 actually paid.
    expect(shares.get('a')).toEqual(ratio(2_000n, 3n))
    expect(shares.get('b')).toEqual(ratio(1_000n, 3n))
  })

  test('shortfall with no assigned items splits equally', () => {
    const shares = allocateExactShares(
      expense({
        amount: 900n,
        participantIds: ['a', 'b'],
        items: [{ name: 'tax', unitAmount: 300n, quantity: 1, assignees: [] }],
      }),
    )
    expect(shares.get('a')).toEqual(ratio(900n, 2n))
    expect(shares.get('b')).toEqual(ratio(900n, 2n))
  })

  test('shares sum to the expense amount even when the items do not', () => {
    const shares = allocateExactShares(
      expense({
        amount: 5_000n,
        participantIds: ['a', 'b', 'c'],
        items: [
          {
            name: 'dish',
            unitAmount: 900n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 100n,
            quantity: 1,
            assignees: [{ memberId: 'c', quantity: 1 }],
          },
        ],
      }),
    )
    let num = 0n
    let den = 1n
    for (const share of shares.values()) {
      num = num * share.den + share.num * den
      den = den * share.den
    }
    expect(num).toBe(5_000n * den)
  })

  test('zero members to split among is an error', () => {
    expect(() =>
      allocateExactShares(expense({ amount: 100n, participantIds: [] })),
    ).toThrow()
  })
})
