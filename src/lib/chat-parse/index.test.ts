import { describe, expect, it } from 'vitest'
import { hasSplitKeyword, parse } from './index'

const ctx = {
  members: [
    { id: 'm-sota', name: '소타' },
    { id: 'm-minsu', name: '민수' },
    { id: 'm-yuna', name: '유나' },
  ],
  actorId: 'm-sota',
  defaultCurrency: 'KRW',
}

describe('parse', () => {
  it('the owner’s canonical sentence', () => {
    const p = parse('김치찌개 3만원 내가 냈고 민수랑 반반', ctx)
    expect(p).toMatchObject({
      amount: '30000',
      currency: 'KRW',
      payerId: 'm-sota',
      participantIds: ['m-sota', 'm-minsu'],
      funding: 'PAY_AS_YOU_GO',
      missing: [],
      amountMentions: 1,
    })
    expect(p.description).toBe('김치찌개')
  })
  it('another member paid, split with everyone', () => {
    const p = parse('택시 8,500원 유나가 냄 다같이', ctx)
    expect(p.payerId).toBe('m-yuna')
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu', 'm-yuna'])
    expect(p.description).toBe('택시')
  })
  it('bare minimum: description + amount → actor paid, everyone shares', () => {
    const p = parse('커피 5천원', ctx)
    expect(p.payerId).toBe('m-sota')
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu', 'm-yuna'])
  })
  it('엔빵 keyword → everyone', () => {
    expect(parse('3만5천원 노래방 엔빵', ctx).participantIds).toHaveLength(3)
  })
  it('named members without keyword → actor + named', () => {
    const p = parse('유나랑 민수랑 저녁 64000', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu', 'm-yuna'])
    expect(p.description).toBe('저녁')
  })
  it('cash keyword flips funding', () => {
    expect(parse('숙소 120000 현금', ctx).funding).toBe('NEW_CASH_WALLET')
    expect(parse('hotel 120000 cash', ctx).funding).toBe('NEW_CASH_WALLET')
  })
  it('no amount → missing, nothing discarded', () => {
    const p = parse('편의점', ctx)
    expect(p.missing).toEqual(['amount'])
    expect(p.description).toBe('편의점')
  })
  it('foreign currency parses its own currency (A2: no more crossCurrency handoff flag)', () => {
    const p = parse('lunch $45.60 민수랑', ctx)
    expect(p.amount).toBe('45.60')
    expect(p.currency).toBe('USD')
  })
  it('amountMentions counts every marked amount, not just the first (A2 multi-amount guard)', () => {
    const p = parse(
      '13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개',
      ctx,
    )
    // The FIRST amount is still what `amount` reports (extractAmount is
    // unchanged) — `amountMentions` is what tells a caller there were more.
    expect(p.amount).toBe('13000')
    expect(p.amountMentions).toBe(3)
  })
  it('amountMentions stays 1 for an ordinary single-amount sentence', () => {
    expect(parse('커피 5천원', ctx).amountMentions).toBe(1)
  })
  it('payer name alone never shrinks participants', () => {
    // 유나 is bound to the pay-verb → she is the payer, NOT a restriction.
    const p = parse('짐 보관 3000원 유나가 계산', ctx)
    expect(p.participantIds).toHaveLength(3)
  })
  it('반반 with exactly one named member → the pair', () => {
    const p = parse('술값 40000 민수랑 반반', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })

  // Strengthening tests found by probing beyond the spec table.
  it('a bare "split" substring inside another word does not trigger EVERYONE', () => {
    // "splitwise" contains "split" — must not override the named member.
    const p = parse('lunch splitwise 3000 민수랑', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })
  it('같이 used as a comparison particle glued to a noun is not EVERYONE', () => {
    // 얼음같이 = "like ice" (comparison), not "together" — must not override
    // the named member the way a genuine 다같이 (standalone) would.
    const p = parse('얼음같이 차가운 음료 5000원 민수랑', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })
  it('bare 같이 with a named member restricts, it does not mean everyone (product ruling)', () => {
    // Updated 2026-08-09 review round: bare 같이 was dropped from EVERYONE
    // entirely. "저녁 같이 먹은거" ("had dinner together") reads as
    // "with 민수" once he is named, same as any other named-member
    // sentence — it does NOT force the full group the way 다같이 would.
    const p = parse('저녁 같이 먹은거 3만원 민수랑', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })
  it('민수랑 같이 (with Minsu) pins the same ruling in word order', () => {
    // "민수랑 같이" = "with Minsu" — a two-person split, not "everyone."
    const p = parse('민수랑 같이 저녁 3만원', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })
  it('EVERYONE keywords are case-insensitive', () => {
    const p = parse('lunch 3000 EVERYONE', ctx)
    expect(p.participantIds).toHaveLength(3)
  })
  it('description scrubbing removes every keyword occurrence, not just the first', () => {
    const p = parse('전부 다같이 30000원', ctx)
    expect(p.description).toBe('')
    const q = parse('lunch 3000 all together evenly', ctx)
    expect(q.description).toBe('lunch')
  })
  it('a trailing bare-digit decoy (만일) does not shadow the real amount', () => {
    // "만일" ("if") is 만 + 일, and 일 reads as Sino-Korean digit 1 with no
    // unit behind it — the exact decoy shape hangul-number.ts's round-2
    // review closed (readHangulNumber never lets it contribute 10001 or
    // even 10000 to the total when more text follows). The amount must
    // come from the real "3만원" later in the sentence, not from "만일".
    const p = parse('만일 늦으면 3만원', ctx)
    expect(p.amount).toBe('30000')
    // Note: the "만일" span itself is not consumed by extractAmount (it
    // never becomes the returned amount hit), so it is not stripped from
    // the description either — "만일" is ordinary leftover text here, same
    // as any other unrecognized word. Stripping it would need a NOISE-list
    // change in this file, out of hangul-number.ts's scope for this fix.
    expect(p.description).toBe('만일 늦으면')
  })
  // Self-mention companion forms (2026-08-14 live-app fix round): 나랑/저랑/
  // 나하고/저하고 are the typer naming themselves as a companion. They must be
  // consumed from the description (the parse READ them), and — combined with
  // at least one named member — they restrict participants to the named set,
  // exactly as "민수랑 나눠냈어" restricts via the named member alone.
  it('나랑 is consumed and joins the participant restriction', () => {
    const p = parse('치킨 덮밥 2만엔 나랑 유나가 먹음', ctx)
    expect(p.description).toBe('치킨 덮밥 먹음')
    expect(p.participantIds).toEqual(['m-sota', 'm-yuna'])
  })
  it('저랑 (polite) behaves identically', () => {
    const p = parse('저랑 민수가 커피 9000원 마셨어요', ctx)
    expect(p.description).toBe('커피 마셨어요')
    expect(p.participantIds).toEqual(['m-sota', 'm-minsu'])
  })
  it('나하고 + a named payer keeps the pair, not everyone', () => {
    // 유나 is the pay-verb subject → payer. Without the self-mention that
    // would widen participants to everyone ("payer name alone never shrinks
    // participants"); the explicit 나하고 says the pair shared it.
    const p = parse('나하고 유나가 택시비 3만원 냈어', ctx)
    expect(p.payerId).toBe('m-yuna')
    expect(p.participantIds).toEqual(['m-sota', 'm-yuna'])
    expect(p.description).toBe('택시비')
  })
  it('a member name ending in 나 does not false-trigger the self-mention (유나랑)', () => {
    const p = parse('유나랑 저녁 3만원 먹었어', ctx)
    expect(p.participantIds).toEqual(['m-sota', 'm-yuna'])
    expect(p.description).toBe('저녁 먹었어')
  })
  it('유나는 as pay-verb subject stays the payer (no 나는 false hit inside her name)', () => {
    const p = parse('유나는 커피 5000원 냈어', ctx)
    expect(p.payerId).toBe('m-yuna')
  })

  it('a trailing bare-digit decoy at end of string (백일) asks instead of guessing', () => {
    // "백일" (a baby's 100-day celebration) ends the sentence right after
    // the decoy syllable — no digit precedes 백, and nothing else in the
    // sentence is money, so this must ask rather than silently book 100.
    const p = parse('오늘 백일', ctx)
    expect(p.amount).toBeNull()
    expect(p.missing).toEqual(['amount'])
  })
})

// Task 8 fix round 1 (I2): `hasSplitKeyword` is a gate a CALLER acts on
// alone, so it reads only the hits the lexicon is certain about. `each` is a
// split signal in "20 bucks each" and an ordinary distributive in "each
// receipt" — it carries 0.6 confidence and must not trip P5 by itself.
describe('hasSplitKeyword', () => {
  it('ignores a low-confidence split word', () => {
    expect(hasSplitKeyword('each receipt')).toBe(false)
  })
  it('accepts the certain vocabulary, in both languages and through the n-ways grammar', () => {
    expect(hasSplitKeyword('split three ways')).toBe(true)
    expect(hasSplitKeyword('반반')).toBe(true)
    expect(hasSplitKeyword('다같이')).toBe(true)
    expect(hasSplitKeyword('lunch 3000 evenly')).toBe(true)
  })
  it('is false for a sentence with no split expression at all', () => {
    expect(hasSplitKeyword('커피 5천원')).toBe(false)
  })
})
