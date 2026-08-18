import { describe, expect, it } from 'vitest'
import {
  allocateEveryone,
  assignmentStatus,
  explainShares,
  lineTotal,
} from './items'
import type { ExpenseInput, ExpenseItemInput, Ratio } from './types'

/**
 * "Everyone" means the item was SHARED.
 *
 * It used to hand every participant exactly one unit, so a 4-unit line
 * between 2 people charged 1 each and left 2 units dangling in the
 * unassigned pool — then explained the leftovers, which is not something a
 * user who tapped "Everyone" ever wanted to read.
 */

const ALICE = 'alice'
const BOB = 'bob'
const CAROL = 'carol'

const item = (
  over: Partial<ExpenseItemInput> & Pick<ExpenseItemInput, 'quantity'>,
): ExpenseItemInput => ({
  name: 'skewers',
  unitAmount: 300n,
  assignees: [],
  ...over,
})

const sumShares = (shares: Ratio[]): Ratio =>
  shares.reduce(
    (acc, s) => ({
      num: acc.num * s.den + s.num * acc.den,
      den: acc.den * s.den,
    }),
    { num: 0n, den: 1n },
  )

describe('allocateEveryone — even division', () => {
  it('divides 4 units between 2 people as 2 each', () => {
    const result = allocateEveryone(item({ quantity: 4 }), [ALICE, BOB], ALICE)
    expect(result.splitMode).toBe('BY_QUANTITY')
    expect(result.assignees).toEqual([
      { memberId: ALICE, quantity: 2 },
      { memberId: BOB, quantity: 2 },
    ])
  })

  it('divides 6 units among 3 people as 2 each', () => {
    const result = allocateEveryone(
      item({ quantity: 6 }),
      [CAROL, ALICE, BOB],
      BOB,
    )
    expect(result.splitMode).toBe('BY_QUANTITY')
    expect(result.assignees.map((a) => a.quantity)).toEqual([2, 2, 2])
  })

  it('units sum exactly to the line quantity', () => {
    for (const [quantity, people] of [
      [4, 2],
      [6, 3],
      [10, 5],
      [12, 4],
      [3, 3],
    ] as const) {
      const members = [ALICE, BOB, CAROL, 'dan', 'erin'].slice(0, people)
      const result = allocateEveryone(item({ quantity }), members, ALICE)
      const total = result.assignees.reduce((sum, a) => sum + a.quantity, 0)
      expect(total, `${quantity} units among ${people}`).toBe(quantity)
    }
  })

  it('a single unit among one person is still just that unit', () => {
    const result = allocateEveryone(item({ quantity: 1 }), [ALICE], ALICE)
    expect(result).toEqual({
      splitMode: 'BY_QUANTITY',
      assignees: [{ memberId: ALICE, quantity: 1 }],
    })
  })
})

describe('allocateEveryone — uneven division falls back to amount', () => {
  it('splits 5 units between 2 people by money, not by 2.5 units', () => {
    const line = item({ quantity: 5, unitAmount: 300n }) // 1500
    const result = allocateEveryone(line, [ALICE, BOB], ALICE)
    expect(result.splitMode).toBe('BY_AMOUNT')
    expect(result.assignees.map((a) => a.amount)).toEqual([750n, 750n])
    // quantity stays an integer and is never fractional.
    for (const assignee of result.assignees) {
      expect(Number.isInteger(assignee.quantity)).toBe(true)
    }
  })

  it('amounts sum exactly to the line total when it does not divide', () => {
    const line = item({ quantity: 5, unitAmount: 301n }) // 1505
    const result = allocateEveryone(line, [ALICE, BOB, CAROL], BOB)
    expect(result.splitMode).toBe('BY_AMOUNT')
    const total = result.assignees.reduce(
      (sum, a) => sum + (a.amount ?? 0n),
      0n,
    )
    expect(total).toBe(lineTotal(line))
    expect(total).toBe(1505n)
  })

  it('hands the remainder to the non-payers (payer-favoured)', () => {
    // 1505 / 3 = 501 r 2 -> alice and carol carry 502, the payer bob 501.
    const line = item({ quantity: 5, unitAmount: 301n })
    const result = allocateEveryone(line, [ALICE, BOB, CAROL], BOB)
    const byMember = new Map(
      result.assignees.map((a) => [a.memberId, a.amount]),
    )
    expect(byMember.get(BOB)).toBe(501n)
    expect(byMember.get(ALICE)).toBe(502n)
    expect(byMember.get(CAROL)).toBe(502n)
  })

  it('is independent of the order people were ticked in', () => {
    const line = item({ quantity: 5, unitAmount: 301n })
    const a = allocateEveryone(line, [CAROL, BOB, ALICE], BOB)
    const b = allocateEveryone(line, [ALICE, CAROL, BOB], BOB)
    expect(a).toEqual(b)
  })

  it('a payer who is not among the sharers still leaves everyone equal-ish', () => {
    const line = item({ quantity: 5, unitAmount: 301n })
    const result = allocateEveryone(line, [ALICE, BOB], CAROL)
    const total = result.assignees.reduce(
      (sum, a) => sum + (a.amount ?? 0n),
      0n,
    )
    expect(total).toBe(1505n)
    expect(result.assignees.map((a) => a.amount)).toEqual([753n, 752n])
  })

  it('exhaustively: amounts always sum to the line total', () => {
    for (let quantity = 1; quantity <= 12; quantity++) {
      for (let people = 1; people <= 5; people++) {
        for (const unitAmount of [1n, 7n, 300n, 301n, 99_999n]) {
          const members = [ALICE, BOB, CAROL, 'dan', 'erin'].slice(0, people)
          const line = item({ quantity, unitAmount })
          const result = allocateEveryone(line, members, ALICE)
          const label = `${quantity}x${unitAmount} among ${people}`
          if (result.splitMode === 'BY_QUANTITY') {
            const units = result.assignees.reduce((s, a) => s + a.quantity, 0)
            expect(units, label).toBe(quantity)
          } else {
            const money = result.assignees.reduce(
              (s, a) => s + (a.amount ?? 0n),
              0n,
            )
            expect(money, label).toBe(lineTotal(line))
          }
        }
      }
    }
  })
})

describe('explainShares honours the recorded mode', () => {
  const expense = (items: ExpenseItemInput[], amount: bigint): ExpenseInput =>
    ({
      payerId: ALICE,
      amount,
      currency: 'JPY',
      walletId: null,
      participantIds: [ALICE, BOB],
      items,
    }) as ExpenseInput

  it('a 4-unit line shared 2/2 leaves nothing unassigned', () => {
    const line = item({ quantity: 4, unitAmount: 300n })
    const allocated = allocateEveryone(line, [ALICE, BOB], ALICE)
    const shares = explainShares(expense([{ ...line, ...allocated }], 1200n))
    expect(shares.get(ALICE)?.total).toEqual({ num: 600n, den: 1n })
    expect(shares.get(BOB)?.total).toEqual({ num: 600n, den: 1n })
    expect(shares.get(ALICE)?.unassigned).toEqual({ num: 0n, den: 1n })
    expect(shares.get(BOB)?.unassigned).toEqual({ num: 0n, den: 1n })
  })

  it('THE BUG: the old behaviour left half the line dangling', () => {
    // One unit each on a 4-unit line: 2 units untaken, redistributed as
    // "unassigned" and explained to a user who asked for an even share.
    const line = item({
      quantity: 4,
      unitAmount: 300n,
      assignees: [
        { memberId: ALICE, quantity: 1 },
        { memberId: BOB, quantity: 1 },
      ],
    })
    expect(assignmentStatus(line)).toBe('partial')
    const shares = explainShares(expense([line], 1200n))
    expect(shares.get(ALICE)?.unassigned).not.toEqual({ num: 0n, den: 1n })
  })

  it('a BY_AMOUNT line charges the stored amounts and reads as exact', () => {
    const line = item({ quantity: 5, unitAmount: 301n })
    const allocated = allocateEveryone(line, [ALICE, BOB], ALICE)
    const divided = { ...line, ...allocated }
    expect(assignmentStatus(divided)).toBe('exact')
    const shares = explainShares(expense([divided], 1505n))
    // 1505 / 2 = 752 r 1 -> the non-payer carries the extra minor unit.
    expect(shares.get(BOB)?.total).toEqual({ num: 753n, den: 1n })
    expect(shares.get(ALICE)?.total).toEqual({ num: 752n, den: 1n })
    expect(shares.get(ALICE)?.unassigned).toEqual({ num: 0n, den: 1n })
  })

  it('the breakdown records which rule applied', () => {
    const evenLine = item({ quantity: 4 })
    const oddLine = item({ quantity: 5 })
    const even = {
      ...evenLine,
      ...allocateEveryone(evenLine, [ALICE, BOB], ALICE),
    }
    const odd = {
      ...oddLine,
      ...allocateEveryone(oddLine, [ALICE, BOB], ALICE),
    }
    const shares = explainShares(expense([even, odd], 1200n + 1500n))
    const modes = shares.get(BOB)?.lines.map((l) => l.splitMode)
    expect(modes).toEqual(['BY_QUANTITY', 'BY_AMOUNT'])
  })

  it('shares still sum exactly to the expense total in both modes', () => {
    for (const quantity of [4, 5, 7, 9]) {
      const line = item({ quantity, unitAmount: 333n })
      const divided = {
        ...line,
        ...allocateEveryone(line, [ALICE, BOB, CAROL], ALICE),
      }
      const amount = lineTotal(line)
      const shares = explainShares({
        payerId: ALICE,
        amount,
        currency: 'JPY',
        walletId: null,
        participantIds: [ALICE, BOB, CAROL],
        items: [divided],
      } as ExpenseInput)
      const total = sumShares([...shares.values()].map((s) => s.total))
      expect(total.num, `${quantity} units`).toBe(amount * total.den)
    }
  })
})
