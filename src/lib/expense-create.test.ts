import { describe, expect, it } from 'vitest'
import { expenseCreateData, type NewExpenseInput } from './expense-create'

/**
 * The seam test (review round 1, IMPORTANT 2): every expense is created
 * through `expenseCreateData`, and the whole point of that is that a row
 * created off the save path cannot quietly miss a column the save path
 * fills. This pins the shape against a fixture so the guarantee is a test,
 * not a comment — including the twelve scalar columns,
 * because a thirteenth added to the schema and wired into only one caller is
 * exactly the drift this exists to catch.
 */
const INPUT: NewExpenseInput = {
  groupId: 'g1',
  title: '점심',
  payerId: 'm1',
  amount: 4000n,
  currency: 'JPY',
  timestamp: new Date('2026-08-14T03:00:00.000Z'),
  marketRateSnapshot: '9.5',
  marketRateProvisional: true,
  note: '회의 후',
  isPersonal: false,
  receiptImagePath: 'g1/abc.jpg',
  enteredById: 'm2',
  participantIds: ['m1', 'm3'],
  items: [
    {
      name: '김치찌개',
      unitAmount: 1300n,
      quantity: 3,
      splitMode: 'BY_QUANTITY',
      assignments: {
        create: [{ memberId: 'm1', quantity: 2, amount: null }],
      },
    },
  ],
  funding: [
    {
      position: 0,
      amount: 4000n,
      walletId: 'w1',
      ownRateSnapshot: null,
      funderId: null,
    },
  ],
}

describe('expenseCreateData', () => {
  it('carries every column through, and nests participants/items/funding', () => {
    expect(expenseCreateData(INPUT)).toEqual({
      groupId: 'g1',
      title: '점심',
      payerId: 'm1',
      amount: 4000n,
      currency: 'JPY',
      timestamp: new Date('2026-08-14T03:00:00.000Z'),
      marketRateSnapshot: '9.5',
      marketRateProvisional: true,
      note: '회의 후',
      isPersonal: false,
      receiptImagePath: 'g1/abc.jpg',
      enteredById: 'm2',
      participants: { create: [{ memberId: 'm1' }, { memberId: 'm3' }] },
      items: { create: INPUT.items },
      funding: { create: INPUT.funding },
    })
  })

  it('writes the twelve scalar columns and nothing else', () => {
    // Named explicitly rather than counted: a schema column added to the
    // input and forgotten here would otherwise pass a bare length check by
    // replacing one that was dropped.
    expect(Object.keys(expenseCreateData(INPUT)).sort()).toEqual([
      'amount',
      'currency',
      'enteredById',
      'funding',
      'groupId',
      'isPersonal',
      'items',
      'marketRateProvisional',
      'marketRateSnapshot',
      'note',
      'participants',
      'payerId',
      'receiptImagePath',
      'timestamp',
      'title',
    ])
  })

  it('an expense with no items and no participants nests empty creates, never undefined', () => {
    const bare = expenseCreateData({
      ...INPUT,
      participantIds: [],
      items: [],
      funding: [],
    })
    expect(bare.participants).toEqual({ create: [] })
    expect(bare.items).toEqual({ create: [] })
    expect(bare.funding).toEqual({ create: [] })
  })

  it('keeps a null note and a null receipt path as nulls', () => {
    const bare = expenseCreateData({
      ...INPUT,
      note: null,
      receiptImagePath: null,
    })
    expect(bare.note).toBeNull()
    expect(bare.receiptImagePath).toBeNull()
  })
})
