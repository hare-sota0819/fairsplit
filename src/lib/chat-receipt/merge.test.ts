import { describe, expect, it } from 'vitest'
import { checkTotal } from '../receipts/invariant'
import { parsedReceiptSchema, type ParsedReceipt } from '../receipts/schema'
import { mergeReceiptIntoChat } from './merge'

/**
 * Fixtures always go through parsedReceiptSchema.parse() and checkTotal() —
 * never hand-built — so these tests can't drift from the real schema/
 * invariant contracts (same discipline as handoff.test.ts).
 */
function receipt(overrides: Partial<ParsedReceipt>): ParsedReceipt {
  return parsedReceiptSchema.parse({
    items: [],
    subtotalMinor: null,
    taxMinor: null,
    serviceChargeMinor: null,
    totalMinor: null,
    currency: null,
    merchantName: null,
    receiptDate: null,
    taxIncludedInItems: null,
    ...overrides,
  })
}

describe('mergeReceiptIntoChat', () => {
  it('clean matching JPY receipt (zero-decimal currency) -> items path', () => {
    const r = receipt({
      items: [
        { name: 'Ramen', quantity: 1, unitPriceMinor: 1000, amountMinor: 1000, modifiers: [] },
        { name: 'Cola', quantity: 2, unitPriceMinor: null, amountMinor: 2000, modifiers: [] },
      ],
      totalMinor: 3000,
      currency: 'JPY',
      merchantName: 'Ichiran',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MATCH')

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'items',
      title: 'Ichiran',
      list: {
        currency: 'JPY',
        items: [
          { name: 'Ramen', unitAmount: '1000', quantity: 1, assigneeIds: [], shareAll: false },
          { name: 'Cola', unitAmount: '1000', quantity: 2, assigneeIds: [], shareAll: false },
        ],
      },
    })
  })

  it('clean matching USD receipt (two-decimal currency) -> items path', () => {
    const r = receipt({
      items: [{ name: 'Burger', quantity: 1, unitPriceMinor: null, amountMinor: 500, modifiers: [] }],
      totalMinor: 500,
      currency: 'USD',
      merchantName: 'Diner',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MATCH')

    const outcome = mergeReceiptIntoChat(r, check, 'JPY')
    expect(outcome).toEqual({
      kind: 'items',
      title: 'Diner',
      list: {
        currency: 'USD',
        items: [{ name: 'Burger', unitAmount: '5.00', quantity: 1, assigneeIds: [], shareAll: false }],
      },
    })
  })

  it('NO_TOTAL receipt -> items path', () => {
    const r = receipt({
      items: [{ name: 'Tea', quantity: 1, unitPriceMinor: 300, amountMinor: 300, modifiers: [] }],
      totalMinor: null,
      currency: 'JPY',
      merchantName: 'Cafe',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('NO_TOTAL')

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'items',
      title: 'Cafe',
      list: { currency: 'JPY', items: [{ name: 'Tea', unitAmount: '300', quantity: 1, assigneeIds: [], shareAll: false }] },
    })
  })

  it('MISMATCH receipt with items -> totalOnly SUM_MISMATCH using the printed total, not the item sum', () => {
    const r = receipt({
      items: [{ name: 'Ramen', quantity: 1, unitPriceMinor: 1000, amountMinor: 1000, modifiers: [] }],
      totalMinor: 1200, // printed total disagrees with the 1000 item sum
      currency: 'JPY',
      merchantName: 'Ichiran',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MISMATCH')
    expect(check.readTotal).toBe(1200)

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'totalOnly',
      amount: '1200',
      currency: 'JPY',
      title: 'Ichiran',
      reason: 'SUM_MISMATCH',
    })
  })

  it('total-only receipt (no items parsed, total present) -> totalOnly NO_ITEMS', () => {
    const r = receipt({
      items: [],
      totalMinor: 5000,
      currency: 'JPY',
      merchantName: 'Shop',
    })
    const check = checkTotal(r)

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'totalOnly',
      amount: '5000',
      currency: 'JPY',
      title: 'Shop',
      reason: 'NO_ITEMS',
    })
  })

  it('empty receipt (no items, no total) -> refuse', () => {
    const r = receipt({ items: [], totalMinor: null })
    const check = checkTotal(r)

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({ kind: 'refuse' })
  })

  it('bogus (malformed-shape) currency falls back to defaultCurrency', () => {
    const r = receipt({
      items: [{ name: 'Ramen', quantity: 1, unitPriceMinor: 1000, amountMinor: 1000, modifiers: [] }],
      totalMinor: 1000,
      currency: 'YEN?',
    })
    const check = checkTotal(r)

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome.kind).toBe('items')
    if (outcome.kind === 'items') {
      expect(outcome.list.currency).toBe('USD')
      expect(outcome.list.items[0].unitAmount).toBe('10.00')
    }
  })

  it('null currency falls back to defaultCurrency', () => {
    const r = receipt({
      items: [],
      totalMinor: 500,
      currency: null,
    })
    const check = checkTotal(r)

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'totalOnly',
      amount: '5.00',
      currency: 'USD',
      title: null,
      reason: 'NO_ITEMS',
    })
  })

  it('merchantName null -> title null', () => {
    const r = receipt({ items: [], totalMinor: 100, merchantName: null })
    const check = checkTotal(r)
    const outcome = mergeReceiptIntoChat(r, check, 'JPY')
    expect(outcome.kind).toBe('totalOnly')
    if (outcome.kind === 'totalOnly') expect(outcome.title).toBeNull()
  })

  it('merchantName whitespace-only -> title null', () => {
    const r = receipt({ items: [], totalMinor: 100, merchantName: '   ' })
    const check = checkTotal(r)
    const outcome = mergeReceiptIntoChat(r, check, 'JPY')
    expect(outcome.kind).toBe('totalOnly')
    if (outcome.kind === 'totalOnly') expect(outcome.title).toBeNull()
  })

  it('merchantName with surrounding whitespace -> trimmed title', () => {
    const r = receipt({ items: [], totalMinor: 100, merchantName: '  Ichiran Ramen  ' })
    const check = checkTotal(r)
    const outcome = mergeReceiptIntoChat(r, check, 'JPY')
    expect(outcome.kind).toBe('totalOnly')
    if (outcome.kind === 'totalOnly') expect(outcome.title).toBe('Ichiran Ramen')
  })

  it('unitPriceMinor null and quantity does not divide the effective amount evenly -> collapses to a single unit (mirrors handoff.ts itemToRow)', () => {
    const r = receipt({
      items: [{ name: 'Gyoza', quantity: 3, unitPriceMinor: null, amountMinor: 1000, modifiers: [] }],
      totalMinor: null,
      currency: 'JPY',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('NO_TOTAL')

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'items',
      title: null,
      list: {
        currency: 'JPY',
        // 1000 % 3 !== 0, so itemToRow collapses to quantity 1 at the whole line amount.
        items: [{ name: 'Gyoza', unitAmount: '1000', quantity: 1, assigneeIds: [], shareAll: false }],
      },
    })
  })

  it('modifiers fold into the effective amount before deriving unit price (mirrors handoff.ts)', () => {
    const r = receipt({
      items: [
        {
          name: 'Ramen',
          quantity: 2,
          unitPriceMinor: null,
          amountMinor: 2520,
          modifiers: [{ name: 'Large', amountMinor: 150 }],
        },
      ],
      totalMinor: null,
      currency: 'JPY',
    })
    const check = checkTotal(r)
    expect(check.status).toBe('NO_TOTAL')

    const outcome = mergeReceiptIntoChat(r, check, 'USD')
    expect(outcome).toEqual({
      kind: 'items',
      title: null,
      list: {
        currency: 'JPY',
        // effective amount = 2520 + 150 = 2670, divides by 2 -> unit 1335.
        items: [{ name: 'Ramen', unitAmount: '1335', quantity: 2, assigneeIds: [], shareAll: false }],
      },
    })
  })
})
