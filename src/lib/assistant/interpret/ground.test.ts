import { describe, expect, it } from 'vitest'
import { groundInterpretation } from './ground'
import { NullInterpreter } from './provider'
import type { UtteranceInterpretation } from './provider'

const ROSTER = [
  { id: 'me', name: '빅헤드' },
  { id: 'm1', name: '민수' },
  { id: 'm2', name: '유나' },
]

const base: UtteranceInterpretation = {
  intent: 'expense',
  amount: null,
  currency: null,
  payerName: null,
  participantNames: [],
  description: null,
  confidence: 0.9,
}

describe('groundInterpretation (guard G1)', () => {
  it('keeps values that literally appear in the text (hangul numbers normalized)', () => {
    const out = groundInterpretation(
      { ...base, amount: '20000', payerName: '민수', participantNames: ['유나'] },
      '2만엔짜리 점심 민수가 냈고 유나랑 먹음',
      ROSTER,
    )
    expect(out.rejected).toEqual([])
    expect(out.interpretation.amount).toBe('20000')
    expect(out.interpretation.payerName).toBe('민수')
    expect(out.interpretation.participantNames).toEqual(['유나'])
  })

  it('strips an INVENTED amount and reports it', () => {
    const out = groundInterpretation(
      { ...base, amount: '50000' },
      '점심 2만원 냈어',
      ROSTER,
    )
    expect(out.interpretation.amount).toBeNull()
    expect(out.rejected).toEqual([{ field: 'amount', value: '50000' }])
  })

  it('strips a name the text never bound — even a real roster member', () => {
    const out = groundInterpretation(
      { ...base, payerName: '유나', participantNames: ['민수'] },
      '점심 만원 냈어',
      ROSTER,
    )
    expect(out.interpretation.payerName).toBeNull()
    expect(out.interpretation.participantNames).toEqual([])
    expect(out.rejected).toHaveLength(2)
  })

  it('strips a name that is not on the roster at all', () => {
    const out = groundInterpretation(
      { ...base, payerName: '철수' },
      '철수가 냈어',
      ROSTER,
    )
    expect(out.interpretation.payerName).toBeNull()
    expect(out.rejected).toEqual([{ field: 'payerName', value: '철수' }])
  })
})

describe('NullInterpreter', () => {
  it('always answers unavailable — the caller asks the user instead', async () => {
    const out = await new NullInterpreter().interpret()
    expect(out).toEqual({ ok: false, kind: 'unavailable' })
  })
})
