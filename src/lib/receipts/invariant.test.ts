import { describe, expect, it } from 'vitest'
import { checkTotal, effectiveItemAmount, itemSum } from './invariant'
import { parsedReceiptSchema, type ParsedReceipt } from './schema'

/** Build a receipt through the schema so defaults match production exactly. */
function receipt(partial: Record<string, unknown>): ParsedReceipt {
  return parsedReceiptSchema.parse({ items: [], ...partial })
}

const line = (amountMinor: number, extra: Record<string, unknown> = {}) => ({
  name: 'x',
  quantity: 1,
  amountMinor,
  ...extra,
})

describe('effectiveItemAmount', () => {
  it('folds modifiers into the parent line', () => {
    const r = receipt({
      items: [line(1260, { modifiers: [{ name: '大盛', amountMinor: 200 }] })],
    })
    expect(effectiveItemAmount(r.items[0])).toBe(1460)
  })

  it('folds a negative modifier (an item-attached discount)', () => {
    const r = receipt({
      items: [line(500, { modifiers: [{ name: 'クーポン', amountMinor: -50 }] })],
    })
    expect(effectiveItemAmount(r.items[0])).toBe(450)
  })

  it('sums lines including a standalone negative discount line', () => {
    const r = receipt({ items: [line(372), line(267), line(267), line(-100)] })
    expect(itemSum(r.items)).toBe(806)
  })
})

describe('checkTotal — tax-inclusive receipts (the Japanese fixtures)', () => {
  it('passes the Pokémon Center receipt, whose ¥629 tax is already inside the prices', () => {
    const r = receipt({
      items: [1067, 2134, 3300, 400, 20, 0].map((a) => line(a)),
      taxMinor: 629,
      taxIncludedInItems: true,
      totalMinor: 6921,
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MATCH')
    expect(check.canSave).toBe(true)
    expect(check.difference).toBe(0)
    expect(check.taxTreatedAsExclusive).toBe(false)
  })

  it('passes the FamilyMart receipt: three items, a -100 discount line, ¥59 inclusive tax', () => {
    const r = receipt({
      items: [line(372), line(267), line(267), line(-100)],
      taxMinor: 59,
      taxIncludedInItems: true,
      totalMinor: 806,
    })
    expect(checkTotal(r)).toMatchObject({ status: 'MATCH', canSave: true, itemSum: 806 })
  })

  it('would REJECT that same receipt under the brief’s literal rule', () => {
    // Regression guard for OPEN_QUESTIONS.md #1: if someone "fixes" the
    // invariant back to always adding tax, this is what users would hit.
    const r = receipt({
      items: [line(372), line(267), line(267), line(-100)],
      taxMinor: 59,
      taxIncludedInItems: false, // the literal reading
      totalMinor: 806,
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MISMATCH')
    expect(check.canSave).toBe(false)
    expect(check.difference).toBe(59)
  })
})

describe('checkTotal — tax-exclusive receipts', () => {
  it('adds tax when the receipt says tax is added on top', () => {
    const r = receipt({
      items: [line(1000), line(500)],
      taxMinor: 150,
      taxIncludedInItems: false,
      totalMinor: 1650,
    })
    expect(checkTotal(r)).toMatchObject({
      status: 'MATCH',
      canSave: true,
      taxTreatedAsExclusive: true,
    })
  })

  it('adds service charge under either tax reading', () => {
    const r = receipt({
      items: [line(2000)],
      serviceChargeMinor: 200,
      taxIncludedInItems: true,
      totalMinor: 2200,
    })
    expect(checkTotal(r)).toMatchObject({ status: 'MATCH', canSave: true })
  })
})

describe('checkTotal — unknown tax treatment', () => {
  it('accepts a receipt that balances under the inclusive reading', () => {
    const r = receipt({
      items: [line(6921)],
      taxMinor: 629,
      taxIncludedInItems: null,
      totalMinor: 6921,
    })
    expect(checkTotal(r)).toMatchObject({ status: 'MATCH', canSave: true })
  })

  it('accepts a receipt that balances under the exclusive reading', () => {
    const r = receipt({
      items: [line(1500)],
      taxMinor: 150,
      taxIncludedInItems: null,
      totalMinor: 1650,
    })
    expect(checkTotal(r)).toMatchObject({
      status: 'MATCH',
      canSave: true,
      taxTreatedAsExclusive: true,
    })
  })

  it('still blocks a receipt that balances under NEITHER reading', () => {
    const r = receipt({
      items: [line(1000)],
      taxMinor: 100,
      taxIncludedInItems: null,
      totalMinor: 5000,
    })
    const check = checkTotal(r)
    expect(check.status).toBe('MISMATCH')
    expect(check.canSave).toBe(false)
    // Reported against the closest reading, so the user reconciles the
    // smallest honest discrepancy (1100 vs 5000, not 1000 vs 5000).
    expect(check.difference).toBe(-3900)
  })
})

describe('checkTotal — the blocking cases the brief cares about', () => {
  it('blocks when no total could be read', () => {
    const r = receipt({ items: [line(500)], totalMinor: null })
    expect(checkTotal(r)).toMatchObject({
      status: 'NO_TOTAL',
      canSave: false,
      difference: null,
    })
  })

  it('blocks a plain mismatch and reports the signed difference', () => {
    const r = receipt({ items: [line(500), line(500)], totalMinor: 1200 })
    const check = checkTotal(r)
    expect(check.status).toBe('MISMATCH')
    expect(check.canSave).toBe(false)
    expect(check.itemSum).toBe(1000)
    expect(check.difference).toBe(-200)
  })

  it('a mismatch caused by one missed line is reported, not absorbed', () => {
    const r = receipt({
      items: [line(348), line(348)], // 11 of the 13 Sun Drug lines dropped
      totalMinor: 6284,
      taxIncludedInItems: true,
    })
    expect(checkTotal(r).canSave).toBe(false)
  })

  it('an empty item list with a total never saves silently', () => {
    expect(checkTotal(receipt({ items: [], totalMinor: 6284 })).canSave).toBe(false)
  })
})

describe('checkTotal — minor units are integers throughout', () => {
  it('a zero-decimal currency total is the integer itself', () => {
    const r = receipt({
      items: [line(1260), line(300)],
      currency: 'JPY',
      totalMinor: 1560,
      taxMinor: 141,
      taxIncludedInItems: true,
    })
    const check = checkTotal(r)
    expect(check).toMatchObject({ status: 'MATCH', itemSum: 1560 })
    expect(Number.isInteger(check.computedTotal)).toBe(true)
  })

  it('a two-decimal currency works in cents with no float anywhere', () => {
    // $12.34 + $0.99 + 8% tax added on top = $14.41
    const r = receipt({
      items: [line(1234), line(99)],
      currency: 'USD',
      taxMinor: 108,
      taxIncludedInItems: false,
      totalMinor: 1441,
    })
    expect(checkTotal(r)).toMatchObject({ status: 'MATCH', canSave: true })
  })
})
