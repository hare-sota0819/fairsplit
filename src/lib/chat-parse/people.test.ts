import { describe, expect, it } from 'vitest'
import { findMembers, resolvePayer } from './people'

const members = [
  { id: 'm-sota', name: '소타' },
  { id: 'm-minsu', name: '민수' },
  { id: 'm-yuna', name: '유나' },
  { id: 'm-min', name: '민' }, // prefix collision on purpose
]

describe('findMembers', () => {
  it('finds names with trailing particles consumed', () => {
    const hits = findMembers('민수랑 유나랑 저녁', members)
    expect(hits.map((h) => h.id)).toEqual(['m-minsu', 'm-yuna'])
    expect('민수랑 유나랑 저녁'.slice(hits[0].start, hits[0].end)).toBe(
      '민수랑',
    )
  })
  it('prefers the longest name on prefix collisions', () => {
    expect(findMembers('민수가 냈어', members).map((h) => h.id)).toEqual([
      'm-minsu',
    ])
    expect(findMembers('민이 냈어', members).map((h) => h.id)).toEqual([
      'm-min',
    ])
  })
  it('matches case-insensitively for latin names', () => {
    const latin = [{ id: 'm-sam', name: 'Sam' }]
    expect(findMembers('split with sam', latin).map((h) => h.id)).toEqual([
      'm-sam',
    ])
  })
  it('does not bind a name that is glued inside an unrelated word', () => {
    // 민박집 = "guesthouse" — contains 민 as a substring, not a mention of 민.
    expect(findMembers('민박집에서 잤어', members)).toEqual([])
    // 유나이티드 ("United") — 유나 + 이 (a valid particle char) is a false hit
    // unless the "이" is checked against what follows it in the same word.
    expect(findMembers('유나이티드 경기 봤어', members)).toEqual([])
    // "sam" glued inside "samsung" must not match either.
    const latin = [{ id: 'm-sam', name: 'Sam' }]
    expect(findMembers('samsung phone', latin)).toEqual([])
  })
  it('skips a name shared by two or more members (unattributable from text alone)', () => {
    const dupes = [
      { id: 'm-sam-a', name: 'Sam' },
      { id: 'm-sam-b', name: 'Sam' },
    ]
    expect(findMembers('Sam paid', dupes)).toEqual([])
  })
})

describe('resolvePayer', () => {
  it('defaults to the actor', () => {
    const hits = findMembers('커피 5천원', members)
    expect(resolvePayer('커피 5천원', hits, 'm-sota').payerId).toBe('m-sota')
  })
  it('binds the name nearest before a pay-verb', () => {
    const s = '택시 유나가 냄 다같이'
    const hits = findMembers(s, members)
    const { payerId, payerHit } = resolvePayer(s, hits, 'm-sota')
    expect(payerId).toBe('m-yuna')
    expect(payerHit?.id).toBe('m-yuna')
  })
  it('keeps the actor as payer when 내가 precedes the verb', () => {
    const s = '김치찌개 3만원 내가 냈고 민수랑 반반'
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-sota').payerId).toBe('m-sota')
  })
  it('handles english pay verbs', () => {
    const latin = [{ id: 'm-sam', name: 'Sam' }]
    const s = 'lunch, Sam paid'
    const hits = findMembers(s, latin)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-sam')
  })
  it('does not bind a companion/dative particle as the payer', () => {
    const cases: Array<[string, string]> = [
      ['민수랑 유나랑 저녁 3만원 냈어', 'm-sota'], // "랑" = with, not payer
      ['유나랑 커피 샀어', 'm-sota'], // "랑" = with
      ['민수한테 물어보고 결제했어', 'm-sota'], // "한테" = to, not payer
    ]
    for (const [s, expected] of cases) {
      const hits = findMembers(s, members)
      expect(resolvePayer(s, hits, 'm-sota').payerId).toBe(expected)
    }
  })
  it('still binds a genuine subject-marked name near the verb', () => {
    const cases: Array<[string, string]> = [
      ['민수랑 유나가 냈어', 'm-yuna'], // 유나 is subject-marked ("가"), 민수 is companion
      ['민수 카드로 계산했어', 'm-minsu'],
    ]
    for (const [s, expected] of cases) {
      const hits = findMembers(s, members)
      expect(resolvePayer(s, hits, 'm-sota').payerId).toBe(expected)
    }
  })
  it('defaults to the actor when duplicate-named members are involved', () => {
    const dupes = [
      { id: 'm-sam-a', name: 'Sam' },
      { id: 'm-sam-b', name: 'Sam' },
    ]
    const s = 'lunch, Sam paid'
    const hits = findMembers(s, dupes)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-actor')
  })
})
