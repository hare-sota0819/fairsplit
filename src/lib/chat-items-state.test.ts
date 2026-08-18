import { describe, expect, it } from 'vitest'
import {
  assignEveryone,
  itemsGrandTotal,
  setMemberQty,
  setUnitAmount,
  toChatItems,
  toggleMember,
  type ChatItemState,
} from './chat-items-state'
import type { ParsedItemList } from './chat-parse/items'

/**
 * These assertions mirror StepAssign's inline handlers byte for byte
 * (`src/app/groups/[groupId]/expenses/wizard/StepAssign.tsx`):
 * - `toggleMember` 87-95
 * - `setMemberQty` 97-103
 * - `assignEveryone` 111-130
 *
 * The chat card and the wizard must never disagree on a resulting
 * assignee array, so every case here is picked to exercise the same
 * branches StepAssign's handlers exercise.
 */

const baseItem = (over: Partial<ChatItemState> = {}): ChatItemState => ({
  key: 0,
  name: 'Wagyu don',
  unitAmount: '1000',
  quantity: 4,
  splitMode: 'BY_QUANTITY',
  assignees: [],
  ...over,
})

describe('toChatItems', () => {
  it('builds one ChatItemState per parsed item, keyed in order, unassigned', () => {
    const parsed: ParsedItemList = {
      currency: 'JPY',
      items: [
        { name: 'Wagyu don', unitAmount: '30000', quantity: 3, assigneeIds: [], shareAll: false },
        { name: 'Cola', unitAmount: '700', quantity: 2, assigneeIds: [], shareAll: false },
      ],
    }
    expect(toChatItems(parsed)).toEqual([
      {
        key: 0,
        name: 'Wagyu don',
        unitAmount: '30000',
        quantity: 3,
        splitMode: 'BY_QUANTITY',
        assignees: [],
      },
      {
        key: 1,
        name: 'Cola',
        unitAmount: '700',
        quantity: 2,
        splitMode: 'BY_QUANTITY',
        assignees: [],
      },
    ])
  })

  it('returns an empty array for an empty parsed list', () => {
    expect(toChatItems({ currency: 'JPY', items: [] })).toEqual([])
  })

  // 2026-08-14 live-app fix round: the parser now states assignments.
  it('seeds sentence-stated assignees; a sole assignee takes the whole quantity', () => {
    const parsed: ParsedItemList = {
      currency: 'JPY',
      items: [
        { name: '우동', unitAmount: null, quantity: 3, assigneeIds: ['alice'], shareAll: false },
        {
          name: '커피',
          unitAmount: '5000',
          quantity: 2,
          assigneeIds: ['alice', 'bob'],
          shareAll: false,
        },
      ],
    }
    const items = toChatItems(parsed)
    expect(items[0].assignees).toEqual([{ memberId: 'alice', quantity: 3 }])
    expect(items[1].assignees).toEqual([
      { memberId: 'alice', quantity: 1 },
      { memberId: 'bob', quantity: 1 },
    ])
  })

  it('expands shareAll across the given participants when units go round', () => {
    const parsed: ParsedItemList = {
      currency: 'JPY',
      items: [
        { name: '우유롤', unitAmount: null, quantity: 2, assigneeIds: [], shareAll: true },
      ],
    }
    expect(toChatItems(parsed, ['alice', 'bob'])[0].assignees).toEqual([
      { memberId: 'alice', quantity: 1 },
      { memberId: 'bob', quantity: 1 },
    ])
    // Units that do not divide stay unassigned (no price to divide by yet).
    const odd: ParsedItemList = {
      currency: 'JPY',
      items: [
        { name: '우유롤', unitAmount: null, quantity: 3, assigneeIds: [], shareAll: true },
      ],
    }
    expect(toChatItems(odd, ['alice', 'bob'])[0].assignees).toEqual([])
    // Without participants (receipt path) shareAll stays unassigned too.
    expect(toChatItems(parsed)[0].assignees).toEqual([])
  })
})

describe('setUnitAmount', () => {
  it('sets a price on an unpriced line and clears back to null on empty input', () => {
    const items = [baseItem({ unitAmount: null })]
    const priced = setUnitAmount(items, 0, '700')
    expect(priced[0].unitAmount).toBe('700')
    expect(setUnitAmount(priced, 0, '  ')[0].unitAmount).toBeNull()
  })

  it('only patches the item with the matching key', () => {
    const items = [baseItem({ key: 0, unitAmount: null }), baseItem({ key: 1, unitAmount: null })]
    const result = setUnitAmount(items, 1, '900')
    expect(result[0].unitAmount).toBeNull()
    expect(result[1].unitAmount).toBe('900')
  })
})

describe('toggleMember', () => {
  it('ticks an unassigned member on: BY_QUANTITY, quantity 1 (StepAssign.tsx:87-95)', () => {
    const items = [baseItem()]
    const result = toggleMember(items, 0, 'alice')
    expect(result[0].splitMode).toBe('BY_QUANTITY')
    expect(result[0].assignees).toEqual([{ memberId: 'alice', quantity: 1 }])
  })

  it('unticks an already-assigned member (removes them)', () => {
    const items = [
      baseItem({ assignees: [{ memberId: 'alice', quantity: 3 }] }),
    ]
    const result = toggleMember(items, 0, 'alice')
    expect(result[0].assignees).toEqual([])
  })

  it('re-ticking after untick resets quantity to 1, not the stale prior value', () => {
    const items = [
      baseItem({ assignees: [{ memberId: 'alice', quantity: 3 }] }),
    ]
    const off = toggleMember(items, 0, 'alice')
    const on = toggleMember(off, 0, 'alice')
    expect(on[0].assignees).toEqual([{ memberId: 'alice', quantity: 1 }])
  })

  it('always forces BY_QUANTITY, even on a line "Everyone" had split by amount', () => {
    const items = [
      baseItem({
        splitMode: 'BY_AMOUNT',
        assignees: [{ memberId: 'alice', quantity: 1 }],
      }),
    ]
    const result = toggleMember(items, 0, 'bob')
    expect(result[0].splitMode).toBe('BY_QUANTITY')
    expect(result[0].assignees).toEqual([
      { memberId: 'alice', quantity: 1 },
      { memberId: 'bob', quantity: 1 },
    ])
  })

  it('only patches the item with the matching key', () => {
    const items = [baseItem({ key: 0 }), baseItem({ key: 1 })]
    const result = toggleMember(items, 1, 'alice')
    expect(result[0].assignees).toEqual([])
    expect(result[1].assignees).toEqual([{ memberId: 'alice', quantity: 1 }])
  })
})

describe('setMemberQty', () => {
  it('sets a member quantity directly (StepAssign.tsx:101-103)', () => {
    const items = [
      baseItem({
        quantity: 4,
        assignees: [{ memberId: 'alice', quantity: 1 }],
      }),
    ]
    const result = setMemberQty(items, 0, 'alice', 3)
    expect(result[0].assignees).toEqual([{ memberId: 'alice', quantity: 3 }])
  })

  it('clamps above the item quantity down to the item quantity', () => {
    const items = [
      baseItem({
        quantity: 4,
        assignees: [{ memberId: 'alice', quantity: 1 }],
      }),
    ]
    const result = setMemberQty(items, 0, 'alice', 9)
    expect(result[0].assignees).toEqual([{ memberId: 'alice', quantity: 4 }])
  })

  it('clamps below 1 up to 1', () => {
    const items = [
      baseItem({
        quantity: 4,
        assignees: [{ memberId: 'alice', quantity: 2 }],
      }),
    ]
    const result = setMemberQty(items, 0, 'alice', 0)
    expect(result[0].assignees).toEqual([{ memberId: 'alice', quantity: 1 }])
  })
})

describe('assignEveryone', () => {
  it('divides whole units evenly when the quantity divides by participant count (StepAssign.tsx:121-126)', () => {
    // quantity 4 / 2 participants = 2 each, BY_QUANTITY.
    const items = [baseItem({ quantity: 4, unitAmount: '1000' })]
    const result = assignEveryone(items, 0, ['alice', 'bob'], 'alice', 'JPY')
    expect(result[0].splitMode).toBe('BY_QUANTITY')
    expect(result[0].assignees).toEqual([
      { memberId: 'alice', quantity: 2 },
      { memberId: 'bob', quantity: 2 },
    ])
  })

  it('falls back to BY_AMOUNT when the units do not divide evenly, remainder to non-payer first', () => {
    // quantity 3 does not divide by 2 participants -> money split.
    // total = 1001 * 3 = 3003, base = 1501, remainder = 1 -> goes to bob
    // (order = non-payer first, then payer 'alice' last).
    const items = [baseItem({ quantity: 3, unitAmount: '1001' })]
    const result = assignEveryone(items, 0, ['alice', 'bob'], 'alice', 'JPY')
    expect(result[0].splitMode).toBe('BY_AMOUNT')
    expect(result[0].assignees).toEqual([
      { memberId: 'alice', quantity: 1 },
      { memberId: 'bob', quantity: 1 },
    ])
  })

  it('toggles everyone off when everyone is already assigned (StepAssign.tsx:117-120)', () => {
    const items = [
      baseItem({
        quantity: 4,
        assignees: [
          { memberId: 'alice', quantity: 2 },
          { memberId: 'bob', quantity: 2 },
        ],
      }),
    ]
    const result = assignEveryone(items, 0, ['alice', 'bob'], 'alice', 'JPY')
    expect(result[0].splitMode).toBe('BY_QUANTITY')
    expect(result[0].assignees).toEqual([])
  })

  it('only patches the item with the matching key', () => {
    const items = [
      baseItem({ key: 0, quantity: 4, unitAmount: '1000' }),
      baseItem({ key: 1, quantity: 4, unitAmount: '1000' }),
    ]
    const result = assignEveryone(items, 1, ['alice', 'bob'], 'alice', 'JPY')
    expect(result[0].assignees).toEqual([])
    expect(result[1].assignees).toEqual([
      { memberId: 'alice', quantity: 2 },
      { memberId: 'bob', quantity: 2 },
    ])
  })
})

describe('itemsGrandTotal', () => {
  it("sums the owner's exact multi-item sentence to the exact grand total", () => {
    const items = [
      baseItem({ key: 0, name: '와규 덮밥', unitAmount: '30000', quantity: 3 }),
      baseItem({ key: 1, name: '콜라', unitAmount: '700', quantity: 2 }),
      baseItem({ key: 2, name: '와규 안심', unitAmount: '50000', quantity: 2 }),
    ]
    expect(itemsGrandTotal(items, 'JPY')).toBe(191400n)
  })

  it('returns zero for an empty item list', () => {
    expect(itemsGrandTotal([], 'JPY')).toBe(0n)
  })

  it('skips a line whose unitAmount fails to parse at the given currency', () => {
    const items = [
      baseItem({ key: 0, unitAmount: 'not-a-number', quantity: 2 }),
      baseItem({ key: 1, unitAmount: '1000', quantity: 2 }),
    ]
    expect(itemsGrandTotal(items, 'JPY')).toBe(2000n)
  })
})
