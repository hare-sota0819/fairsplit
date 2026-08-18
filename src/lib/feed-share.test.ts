import { describe, expect, test } from 'vitest'
import { feedShareFor } from './feed-share'
import type { ExpenseInput } from '@/lib/settlement'

const expense = (
  overrides: Partial<ExpenseInput>,
): Pick<ExpenseInput, 'amount' | 'items' | 'participantIds'> => ({
  amount: 0n,
  participantIds: [],
  items: [],
  ...overrides,
})

describe('feedShareFor', () => {
  test('the reported receipt: my two lines, not the ¥30,000 total', () => {
    const share = feedShareFor(
      expense({
        amount: 30_000n,
        participantIds: ['sota', 'harry'],
        items: [
          {
            name: '시계1',
            unitAmount: 15_000n,
            quantity: 1,
            assignees: [{ memberId: 'sota', quantity: 1 }],
          },
          {
            name: '시계2',
            unitAmount: 10_000n,
            quantity: 1,
            assignees: [{ memberId: 'harry', quantity: 1 }],
          },
          {
            name: '시계3',
            unitAmount: 5_000n,
            quantity: 1,
            assignees: [{ memberId: 'sota', quantity: 1 }],
          },
        ],
      }),
      'sota',
    )
    expect(share?.total).toBe(20_000n)
    expect(share?.lines.map((line) => [line.name, line.amount])).toEqual([
      ['시계1', 15_000n],
      ['시계3', 5_000n],
    ])
  })

  test('a member who had nothing on the receipt gets null, not zero', () => {
    const share = feedShareFor(
      expense({
        amount: 10_000n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'beer',
            unitAmount: 10_000n,
            quantity: 1,
            assignees: [{ memberId: 'a', quantity: 1 }],
          },
        ],
      }),
      'b',
    )
    expect(share).toBeNull()
  })

  test('lines always sum to the total, even when each third rounds up', () => {
    const share = feedShareFor(
      expense({
        amount: 2_000n,
        participantIds: ['a', 'b', 'c'],
        items: [
          {
            name: 'dish',
            unitAmount: 1_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
              { memberId: 'c', quantity: 1 },
            ],
          },
          {
            name: 'sake',
            unitAmount: 1_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
              { memberId: 'c', quantity: 1 },
            ],
          },
        ],
      }),
      'a',
    )
    // 1000/3 twice = 666.67; rounded once the share is 667, and the two
    // displayed lines (334 + 333) add up to exactly that.
    expect(share?.total).toBe(667n)
    expect(share?.lines.map((line) => line.amount)).toEqual([334n, 333n])
    expect(share?.lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(
      share?.total,
    )
  })

  test('the untaken and un-itemised remainder is one leftover line', () => {
    const share = feedShareFor(
      expense({
        amount: 12_000n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'set',
            unitAmount: 5_000n,
            quantity: 1,
            assignees: [{ memberId: 'a', quantity: 1 }],
          },
        ],
      }),
      'a',
    )
    // a is the only member with an assigned subtotal, so the whole ¥7,000
    // gap lands on them.
    expect(share?.total).toBe(12_000n)
    expect(share?.lines.map((line) => [line.name, line.amount])).toEqual([
      ['set', 5_000n],
      [null, 7_000n],
    ])
  })

  test('no items at all: an even split, reported as one', () => {
    const share = feedShareFor(
      expense({ amount: 10_000n, participantIds: ['a', 'b', 'c'] }),
      'a',
    )
    expect(share?.total).toBe(3_334n)
    expect(share?.lines).toEqual([])
    expect(share?.evenSplitOf).toEqual({ total: 10_000n, among: 3 })
  })

  test('a refund rounds toward zero and still telescopes', () => {
    const share = feedShareFor(
      expense({
        amount: -2_000n,
        participantIds: ['a', 'b', 'c'],
        items: [
          {
            name: 'returned',
            unitAmount: -1_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
              { memberId: 'c', quantity: 1 },
            ],
          },
          {
            name: 'also returned',
            unitAmount: -1_000n,
            quantity: 1,
            assignees: [
              { memberId: 'a', quantity: 1 },
              { memberId: 'b', quantity: 1 },
              { memberId: 'c', quantity: 1 },
            ],
          },
        ],
      }),
      'a',
    )
    expect(share?.total).toBe(-666n)
    expect(share?.lines.reduce((sum, line) => sum + line.amount, 0n)).toBe(
      share?.total,
    )
  })

  test('per-unit quantities are carried through for the row to state', () => {
    const share = feedShareFor(
      expense({
        amount: 9_000n,
        participantIds: ['a', 'b'],
        items: [
          {
            name: 'beer',
            unitAmount: 3_000n,
            quantity: 3,
            assignees: [
              { memberId: 'a', quantity: 2 },
              { memberId: 'b', quantity: 1 },
            ],
          },
        ],
      }),
      'a',
    )
    expect(share?.lines[0]).toMatchObject({
      name: 'beer',
      units: 2,
      quantity: 3,
      splitMode: 'BY_QUANTITY',
      amount: 6_000n,
    })
  })
})
