import { describe, expect, it } from 'vitest'
import { parseReceiptResponse, stripCodeFence } from './schema'

const minimal = JSON.stringify({
  items: [{ name: 'コーラ', quantity: 1, amountMinor: 300 }],
  totalMinor: 300,
})

describe('stripCodeFence', () => {
  it('leaves bare JSON alone', () => {
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}')
  })

  it('strips a ```json fence the model was told not to emit', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('strips an unlabelled fence', () => {
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('does not truncate at a fence sitting INSIDE the payload', () => {
    // A merchant literally named ``` would otherwise cut the JSON in half.
    const raw = '{"name":"a ``` b"}'
    expect(stripCodeFence(raw)).toBe(raw)
  })
})

describe('parseReceiptResponse', () => {
  it('accepts a minimal receipt and fills the documented defaults', () => {
    const result = parseReceiptResponse(minimal)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.items[0]).toMatchObject({
      name: 'コーラ',
      quantity: 1,
      amountMinor: 300,
      unitPriceMinor: null,
      modifiers: [],
    })
    expect(result.receipt.taxMinor).toBeNull()
    expect(result.receipt.taxIncludedInItems).toBeNull()
  })

  it('accepts the same payload wrapped in a fence', () => {
    expect(parseReceiptResponse('```json\n' + minimal + '\n```').ok).toBe(true)
  })

  it('reports malformed JSON as INVALID_JSON and keeps the raw text', () => {
    const result = parseReceiptResponse('{"items": [')
    expect(result).toMatchObject({ ok: false, reason: 'INVALID_JSON', raw: '{"items": [' })
  })

  it('rejects a float amount rather than rounding it', () => {
    // A model answering 12.5 has misread something; flooring buries the evidence.
    const result = parseReceiptResponse(
      JSON.stringify({ items: [{ name: 'x', quantity: 1, amountMinor: 12.5 }] }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('SCHEMA_MISMATCH')
  })

  it('rejects a stringified amount', () => {
    const result = parseReceiptResponse(
      JSON.stringify({ items: [{ name: 'x', quantity: 1, amountMinor: '300' }] }),
    )
    expect(result).toMatchObject({ ok: false, reason: 'SCHEMA_MISMATCH' })
  })

  it('rejects a response with no items array at all', () => {
    expect(parseReceiptResponse('{"totalMinor":300}')).toMatchObject({
      ok: false,
      reason: 'SCHEMA_MISMATCH',
    })
  })

  it('rejects a quantity of zero', () => {
    const result = parseReceiptResponse(
      JSON.stringify({ items: [{ name: 'x', quantity: 0, amountMinor: 300 }] }),
    )
    expect(result).toMatchObject({ ok: false, reason: 'SCHEMA_MISMATCH' })
  })

  it('keeps a negative amount — a standalone discount line is legitimate', () => {
    const result = parseReceiptResponse(
      JSON.stringify({ items: [{ name: '値引き', quantity: 1, amountMinor: -100 }] }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.items[0].amountMinor).toBe(-100)
  })

  it('carries modifiers through', () => {
    const result = parseReceiptResponse(
      JSON.stringify({
        items: [
          {
            name: 'つけ麺',
            quantity: 1,
            amountMinor: 1260,
            modifiers: [{ name: '大盛', amountMinor: 200 }],
          },
        ],
      }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.receipt.items[0].modifiers).toEqual([{ name: '大盛', amountMinor: 200 }])
  })

  it('lists the offending path when validation fails', () => {
    const result = parseReceiptResponse(
      JSON.stringify({ items: [{ name: 'x', quantity: 1, amountMinor: 1.5 }] }),
    )
    if (result.ok || result.reason !== 'SCHEMA_MISMATCH') throw new Error('expected mismatch')
    expect(result.issues.join(' ')).toContain('items.0.amountMinor')
  })
})
