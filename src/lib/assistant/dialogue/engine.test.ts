import { describe, expect, it } from 'vitest'
import { classify } from '../classify'
import type { AssistantContext } from '../types'
import {
  emptyMemory,
  observeAssistantMention,
  observeUserUtterance,
  resolvePersonReference,
} from './engine'

const MEMBERS = [
  { id: 'me', name: '빅헤드' },
  { id: 'm1', name: '민수' },
  { id: 'm2', name: '유나' },
]
const CTX: AssistantContext = {
  members: MEMBERS,
  actorId: 'me',
  defaultCurrency: 'KRW',
  locale: 'ko',
  openCard: null,
}

describe('resolvePersonReference', () => {
  it('걔 resolves to the most recently mentioned member and rewrites the text', () => {
    let mem = emptyMemory()
    mem = observeUserUtterance(mem, '민수랑 점심 먹었어', MEMBERS)
    const out = resolvePersonReference(mem, '걔가 냈어', MEMBERS, 'me')
    expect(out).toEqual({ kind: 'resolved', text: '민수가 냈어', memberId: 'm1' })
  })

  it('the rewritten sentence flows through classify() as an ordinary named sentence', () => {
    let mem = emptyMemory()
    mem = observeUserUtterance(mem, '유나랑 카페 갔다옴', MEMBERS)
    const out = resolvePersonReference(mem, '걔가 커피 5000원 냈어', MEMBERS, 'me')
    expect(out.kind).toBe('resolved')
    if (out.kind !== 'resolved') return
    const got = classify(out.text, CTX)
    expect(got.intent).toBe('EXPENSE_ENTRY')
    if (got.intent === 'EXPENSE_ENTRY') {
      expect(got.parsed.payerId).toBe('m2')
    }
  })

  it('a newer mention wins over an older one', () => {
    let mem = emptyMemory()
    mem = observeUserUtterance(mem, '민수랑 저녁', MEMBERS)
    mem = observeUserUtterance(mem, '유나가 온대', MEMBERS)
    const out = resolvePersonReference(mem, '그 사람이 결제했어', MEMBERS, 'me')
    expect(out).toEqual({ kind: 'resolved', text: '유나가 결제했어', memberId: 'm2' })
  })

  it('two members named in the same turn → ambiguous with both names, never a guess', () => {
    let mem = emptyMemory()
    mem = observeUserUtterance(mem, '민수랑 유나랑 셋이 먹었어', MEMBERS)
    const out = resolvePersonReference(mem, '걔가 냈어', MEMBERS, 'me')
    expect(out.kind).toBe('ambiguous')
    if (out.kind === 'ambiguous') {
      expect(out.names.sort()).toEqual(['민수', '유나'])
    }
  })

  it('걔 never resolves to the speaker', () => {
    let mem = emptyMemory()
    // Only the actor's own name has been mentioned.
    mem = observeUserUtterance(mem, '빅헤드가 쏜다', MEMBERS)
    const out = resolvePersonReference(mem, '걔가 냈어', MEMBERS, 'me')
    expect(out.kind).toBe('unknown')
  })

  it('no reference expression → text passes through untouched', () => {
    const out = resolvePersonReference(emptyMemory(), '커피 5000원', MEMBERS, 'me')
    expect(out).toEqual({ kind: 'none', text: '커피 5000원' })
  })

  it('no prior mention at all → unknown (the caller asks who)', () => {
    const out = resolvePersonReference(emptyMemory(), '걔가 냈어', MEMBERS, 'me')
    expect(out).toEqual({ kind: 'unknown' })
  })

  it('assistant mentions count for reference too', () => {
    let mem = emptyMemory()
    mem = observeUserUtterance(mem, '점심 3만원', MEMBERS)
    mem = observeAssistantMention(mem, ['m1'], MEMBERS)
    const out = resolvePersonReference(mem, '아 걔 말고 유나가 냈어', MEMBERS, 'me')
    expect(out.kind).toBe('resolved')
    if (out.kind === 'resolved') {
      expect(out.text).toBe('아 민수 말고 유나가 냈어')
    }
  })
})
