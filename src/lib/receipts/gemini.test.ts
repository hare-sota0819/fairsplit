import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiReceiptParser } from './gemini'
import {
  RECEIPT_MEDIA_RESOLUTION,
  RECEIPT_MODEL_ID,
  RECEIPT_THINKING_BUDGET,
} from './config'

/**
 * These pin the request the calibration actually measured. The model id, the
 * media resolution and the thinking budget are the three settings the
 * 2026-08-09 numbers in docs/PHASE5_CALIBRATION.md depend on, and all three
 * are invisible in the response — a silent change here would show up as a
 * cost or accuracy drift nobody could trace back.
 */
function stubFetch(): () => { url: string; body: Record<string, unknown> } {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> })
      return {
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }],
          usageMetadata: {},
        }),
      } as unknown as Response
    }),
  )
  return () => calls[0]!
}

describe('GeminiReceiptParser request', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls the GA model, not a preview id that can be withdrawn mid-trip', async () => {
    const call = stubFetch()
    await new GeminiReceiptParser('key').parse(new Uint8Array([1]))
    expect(RECEIPT_MODEL_ID).toBe('gemini-3.5-flash')
    expect(call().url).toContain(`/${RECEIPT_MODEL_ID}:generateContent`)
  })

  it('sends thinking OFF — it cost ~4x and ~3x the latency for no accuracy gain', async () => {
    const call = stubFetch()
    await new GeminiReceiptParser('key').parse(new Uint8Array([1]))
    const config = call().body.generationConfig as Record<string, unknown>
    expect(RECEIPT_THINKING_BUDGET).toBe(0)
    expect(config.thinkingConfig).toEqual({ thinkingBudget: 0 })
    expect(config.mediaResolution).toBe(RECEIPT_MEDIA_RESOLUTION)
  })

  it('keeps the api key in the query string and out of the body', async () => {
    const call = stubFetch()
    await new GeminiReceiptParser('secret-key').parse(new Uint8Array([1]))
    expect(call().url).toContain('key=secret-key')
    expect(JSON.stringify(call().body)).not.toContain('secret-key')
  })
})
