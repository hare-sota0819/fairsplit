import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiInterpreter } from './gemini'
import { groundInterpretation } from './ground'
import type { InterpretInput } from './provider'

const INPUT: InterpretInput = {
  text: '어제 수탉이랑 라멘 2만원어치 먹었잖아 그거 올려줘',
  dialogue: { openCardKind: null, salientNames: [], senderId: 'me' },
  roster: [
    { id: 'me', name: '빅헤드' },
    { id: 'm1', name: '수탉' },
  ],
  defaultCurrency: 'KRW',
  locale: 'ko',
}

function geminiResponse(payload: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeminiInterpreter', () => {
  it('returns a shaped interpretation from a schema-conforming answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiResponse({
          intent: 'expense',
          amount: '20000',
          currency: 'KRW',
          payerName: null,
          participantNames: ['빅헤드', '수탉'],
          description: '라멘',
          confidence: 0.9,
        }),
      ),
    )
    const out = await new GeminiInterpreter('k').interpret(INPUT)
    expect(out).toEqual({
      ok: true,
      interpretation: {
        intent: 'expense',
        amount: '20000',
        currency: 'KRW',
        payerName: null,
        participantNames: ['빅헤드', '수탉'],
        description: '라멘',
        confidence: 0.9,
      },
    })
  })

  it('refuses on non-JSON answer text (never throws)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'not json' }] } }],
          }),
          { status: 200 },
        ),
      ),
    )
    expect(await new GeminiInterpreter('k').interpret(INPUT)).toEqual({
      ok: false,
      kind: 'refused',
    })
  })

  it('one automatic retry on a transient failure, then unavailable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network')
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await new GeminiInterpreter('k').interpret(INPUT)).toEqual({
      ok: false,
      kind: 'unavailable',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('malformed shapes are refused by the defensive layer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => geminiResponse({ intent: 'banana', confidence: 2 })),
    )
    expect(await new GeminiInterpreter('k').interpret(INPUT)).toEqual({
      ok: false,
      kind: 'refused',
    })
  })

  it('G1 end-to-end: an invented amount from the model is stripped by grounding', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        geminiResponse({
          intent: 'expense',
          amount: '99999',
          currency: 'KRW',
          payerName: '수탉',
          participantNames: [],
          description: '라멘',
          confidence: 0.95,
        }),
      ),
    )
    const out = await new GeminiInterpreter('k').interpret(INPUT)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    const grounded = groundInterpretation(out.interpretation, INPUT.text, INPUT.roster)
    expect(grounded.interpretation.amount).toBeNull()
    expect(grounded.rejected).toContainEqual({ field: 'amount', value: '99999' })
    // 수탉 IS literally in the text — the payer survives grounding.
    expect(grounded.interpretation.payerName).toBe('수탉')
  })
})
