import { describe, expect, it } from 'vitest'
import {
  emptySalience,
  findPronounReference,
  registerEntities,
  resolveEntity,
} from './salience'
import type { Entity } from './types'

const person = (id: string, label: string, turn: number, by: Entity['by'] = 'user'): Entity => ({
  kind: 'person',
  id,
  label,
  turn,
  by,
})

describe('registerEntities', () => {
  it('keeps newest-first order across turns', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('m1', '민수', 1)])
    s = registerEntities(s, [person('m2', '유나', 2)])
    expect(s.entities.map((e) => e.id)).toEqual(['m2', 'm1'])
  })

  it('re-mentioning an entity refreshes its recency instead of duplicating', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('m1', '민수', 1)])
    s = registerEntities(s, [person('m2', '유나', 2)])
    s = registerEntities(s, [person('m1', '민수', 3)])
    expect(s.entities.map((e) => e.id)).toEqual(['m1', 'm2'])
    expect(s.entities[0].turn).toBe(3)
  })

  it('caps the list so a long conversation cannot grow state unboundedly', () => {
    let s = emptySalience()
    for (let turn = 1; turn <= 100; turn++) {
      s = registerEntities(s, [person(`m${turn}`, `이름${turn}`, turn)])
    }
    expect(s.entities.length).toBeLessThanOrEqual(20)
    expect(s.entities[0].id).toBe('m100')
  })
})

describe('resolveEntity', () => {
  it('returns the newest type-compatible entity', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('m1', '민수', 1)])
    s = registerEntities(s, [
      { kind: 'expense', id: 'e1', label: '술값', turn: 2, by: 'assistant' },
    ])
    const r = resolveEntity(s, 'person', {})
    expect(r).toEqual({ kind: 'hit', entity: expect.objectContaining({ id: 'm1' }) })
  })

  it('excludes ids the constraint rules out (걔 is never the speaker)', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('me', '나', 2), person('m1', '민수', 1)])
    const r = resolveEntity(s, 'person', { excludeIds: ['me'] })
    expect(r).toEqual({ kind: 'hit', entity: expect.objectContaining({ id: 'm1' }) })
  })

  it('two candidates mentioned in the SAME most-recent turn → ambiguous, both reported', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('m1', '민수', 3), person('m2', '유나', 3)])
    const r = resolveEntity(s, 'person', {})
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') {
      expect(r.candidates.map((c) => c.id).sort()).toEqual(['m1', 'm2'])
    }
  })

  it('a newer mention beats an older one — no ambiguity across turns', () => {
    let s = emptySalience()
    s = registerEntities(s, [person('m1', '민수', 1)])
    s = registerEntities(s, [person('m2', '유나', 2)])
    expect(resolveEntity(s, 'person', {})).toEqual({
      kind: 'hit',
      entity: expect.objectContaining({ id: 'm2' }),
    })
  })

  it('nothing compatible → none', () => {
    const s = registerEntities(emptySalience(), [
      { kind: 'amount', id: '5000', label: '5000원', turn: 1, by: 'user' },
    ])
    expect(resolveEntity(s, 'person', {})).toEqual({ kind: 'none' })
  })
})

describe('findPronounReference', () => {
  it('recognizes person pronouns 걔/쟤/그 사람/그분', () => {
    for (const text of ['걔가 냈어', '쟤도 껴줘', '그 사람이 결제했어', '그분이 사줬어']) {
      expect(findPronounReference(text)).toEqual(
        expect.objectContaining({ kind: 'person' }),
      )
    }
  })

  it('recognizes expense references 아까 그거/그 술값 shapes', () => {
    expect(findPronounReference('아까 그거 취소해줘')).toEqual(
      expect.objectContaining({ kind: 'expense' }),
    )
  })

  it('does not fire inside ordinary words (개/그거야 없는 문장)', () => {
    expect(findPronounReference('점심 12000원 냈어')).toBeNull()
    // 걔 as a syllable inside another word must not fire; there is no
    // common Korean word containing 걔, so the guard is the boundary
    // check itself — 그사람 glued still fires, 그사 alone does not.
    expect(findPronounReference('그사이에 다녀왔어')).toBeNull()
  })
})
