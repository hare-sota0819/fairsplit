import { describe, expect, it } from 'vitest'
import { itemToRow, receiptToWizardPatch } from './handoff'
import { parsedReceiptSchema, receiptItemSchema } from './schema'

const item = (partial: Record<string, unknown>) =>
  receiptItemSchema.parse({ name: 'x', quantity: 1, amountMinor: 0, ...partial })

describe('itemToRow', () => {
  it('keeps the quantity when the line divides evenly (@1,067 x 2)', () => {
    const row = itemToRow(item({ name: 'メガサーナイト', quantity: 2, amountMinor: 2134 }), 0, 'JPY')
    expect(row).toMatchObject({ name: 'メガサーナイト', unitAmount: '1067', quantity: 2 })
  })

  it('writes a zero-decimal currency with no decimal point', () => {
    expect(itemToRow(item({ amountMinor: 1560 }), 0, 'JPY').unitAmount).toBe('1560')
  })

  it('writes a two-decimal currency in major units', () => {
    expect(itemToRow(item({ amountMinor: 1234 }), 0, 'USD').unitAmount).toBe('12.34')
  })

  it('folds a modifier into the line before pricing it', () => {
    const row = itemToRow(
      item({ quantity: 1, amountMinor: 1260, modifiers: [{ name: '大盛', amountMinor: 200 }] }),
      0,
      'JPY',
    )
    expect(row).toMatchObject({ unitAmount: '1460', quantity: 1 })
  })

  it('keeps the quantity when the folded amount still divides evenly', () => {
    // 2 x 1260 + 150 = 2670, and 2670 / 2 = 1335.
    const row = itemToRow(
      item({ quantity: 2, amountMinor: 2520, modifiers: [{ name: '大盛', amountMinor: 150 }] }),
      0,
      'JPY',
    )
    expect(row).toMatchObject({ unitAmount: '1335', quantity: 2 })
  })

  it('collapses to one unit when the folded amount does NOT divide, keeping the money right', () => {
    // 2 x 1260 + 75 = 2595; 2595 / 2 is not an integer number of yen.
    const row = itemToRow(
      item({ quantity: 2, amountMinor: 2520, modifiers: [{ name: '大盛', amountMinor: 75 }] }),
      0,
      'JPY',
    )
    expect(row).toMatchObject({ unitAmount: '2595', quantity: 1 })
  })

  it('carries a standalone discount line through as a negative unit price', () => {
    expect(itemToRow(item({ name: '値引き', amountMinor: -100 }), 0, 'JPY')).toMatchObject({
      unitAmount: '-100',
      quantity: 1,
    })
  })

  it('hands over with no assignments — the existing step does that', () => {
    expect(itemToRow(item({ amountMinor: 300 }), 0, 'JPY').assignees).toEqual([])
  })
})

describe('receiptToWizardPatch', () => {
  const pokemon = parsedReceiptSchema.parse({
    items: [
      { name: 'リザードンX', quantity: 1, amountMinor: 1067 },
      { name: 'サーナイト', quantity: 2, amountMinor: 2134 },
      { name: 'ヌイグルミ', quantity: 2, amountMinor: 3300 },
      { name: 'アビスアイ', quantity: 2, amountMinor: 400 },
      { name: 'ショッパー', quantity: 2, amountMinor: 20 },
      { name: 'マタキテネ', quantity: 1, amountMinor: 0 },
    ],
    totalMinor: 6921,
    currency: 'JPY',
  })

  it('produces one row per printed line, in order', () => {
    const patch = receiptToWizardPatch(pokemon, 'JPY', 0)
    expect(patch.items).toHaveLength(6)
    expect(patch.items.map((i) => i.name)).toEqual([
      'リザードンX',
      'サーナイト',
      'ヌイグルミ',
      'アビスアイ',
      'ショッパー',
      'マタキテネ',
    ])
  })

  it('prefills the expense amount from the confirmed total', () => {
    expect(receiptToWizardPatch(pokemon, 'JPY', 0).amount).toBe('6921')
  })

  it('rows sum back to the total', () => {
    const patch = receiptToWizardPatch(pokemon, 'JPY', 0)
    const sum = patch.items.reduce((s, i) => s + Number(i.unitAmount) * i.quantity, 0)
    expect(sum).toBe(6921)
  })

  it('keeps a free ¥0 item rather than dropping it', () => {
    const patch = receiptToWizardPatch(pokemon, 'JPY', 0)
    expect(patch.items.at(-1)).toMatchObject({ name: 'マタキテネ', unitAmount: '0' })
  })

  it('numbers rows from the wizard’s nextKey so hand-typed lines never collide', () => {
    const patch = receiptToWizardPatch(pokemon, 'JPY', 7)
    expect(patch.items.map((i) => i.key)).toEqual([7, 8, 9, 10, 11, 12])
    expect(patch.nextKey).toBe(13)
  })

  it('falls back to the item sum when no total was read', () => {
    const receipt = parsedReceiptSchema.parse({
      items: [
        { name: 'a', quantity: 1, amountMinor: 500 },
        { name: 'b', quantity: 1, amountMinor: 250 },
      ],
      totalMinor: null,
    })
    expect(receiptToWizardPatch(receipt, 'JPY', 0).amount).toBe('750')
  })

  it('handles the FamilyMart shape: three items plus a negative discount line', () => {
    const receipt = parsedReceiptSchema.parse({
      items: [
        { name: 'お茶', quantity: 2, amountMinor: 372 },
        { name: 'UFO', quantity: 1, amountMinor: 267 },
        { name: 'ヌードル', quantity: 1, amountMinor: 267 },
        { name: '値引き', quantity: 1, amountMinor: -100 },
      ],
      totalMinor: 806,
    })
    const patch = receiptToWizardPatch(receipt, 'JPY', 0)
    expect(patch.amount).toBe('806')
    expect(patch.items[0]).toMatchObject({ unitAmount: '186', quantity: 2 })
    expect(patch.items[3]).toMatchObject({ unitAmount: '-100', quantity: 1 })
  })

  it('produces an empty patch for an empty receipt rather than throwing', () => {
    const empty = parsedReceiptSchema.parse({ items: [], totalMinor: null })
    expect(receiptToWizardPatch(empty, 'JPY', 3)).toMatchObject({
      items: [],
      nextKey: 3,
      amount: '0',
    })
  })
})
