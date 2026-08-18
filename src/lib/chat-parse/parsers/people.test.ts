import { describe, expect, it } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import { parse } from '../index'
import { findMembers, hasPayVerb, resolvePayer } from '../people'
import { findPeople } from './people'
import type { ChatMember } from '../types'

// 사랑 deliberately included — a member name that collides with a common
// noun ("love") — to exercise the follow-syllable rule.
const members: ChatMember[] = [
  { id: 'm-minsu', name: '민수' },
  { id: 'm-yuna', name: '유나' },
  { id: 'm-sarang', name: '사랑' },
]

function run(input: string) {
  return findPeople(tokenize(input), input, members)
}

describe('findPeople', () => {
  it('binds a name+josa glued to a following word inside one token ("with")', () => {
    const hits = run('민수랑같이 저녁')
    expect(hits).toHaveLength(1)
    expect(hits[0].memberId).toBe('m-minsu')
    expect(hits[0].role).toBe('with')
    expect('민수랑같이 저녁'.slice(hits[0].start, hits[0].end)).toBe('민수랑')
  })

  it('consumes the 님 honorific and marks a subject-marked name', () => {
    const hits = run('민수님이 결제했어')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      memberId: 'm-minsu',
      role: 'subject',
      honorific: true,
    })
    expect('민수님이 결제했어'.slice(hits[0].start, hits[0].end)).toBe(
      '민수님이',
    )
  })

  it('consumes the 씨 honorific and marks a subject-marked name', () => {
    const hits = run('민수씨가 냈어')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({
      memberId: 'm-minsu',
      role: 'subject',
      honorific: true,
    })
  })

  it('finds both a subject-marked and a companion-marked name in one sentence', () => {
    const hits = run('유나가 추천한 식당에서 민수랑 냈어')
    expect(hits).toHaveLength(2)
    const yuna = hits.find((h) => h.memberId === 'm-yuna')
    const minsu = hits.find((h) => h.memberId === 'm-minsu')
    expect(yuna).toMatchObject({ role: 'subject', honorific: false })
    expect(minsu).toMatchObject({ role: 'with', honorific: false })
  })

  it('does not bind a member name that is really a longer glued word (사랑해)', () => {
    const hits = run('사랑해 이 그룹')
    expect(hits.find((h) => h.memberId === 'm-sarang')).toBeUndefined()
  })

  it('dedups repeated mentions of the same member IN THE SAME ROLE', () => {
    const hits = run('민수 유나 민수')
    expect(hits.map((h) => h.memberId)).toEqual(['m-minsu', 'm-yuna'])
  })

  // Fix-round-1 Critical 2: dedup keys on (memberId, role), not memberId
  // alone — a repeat mention with a DIFFERENT grammatical role is new
  // information (here: the with-marked first mention doesn't tell you who
  // paid; the subject-marked second one does), so both must survive.
  it('keeps a repeated mention of the same member when its ROLE differs', () => {
    const hits = run('민수랑 먹었는데 민수가 냈어')
    expect(hits.map((h) => ({ role: h.role }))).toEqual([
      { role: 'with' },
      { role: 'subject' },
    ])
  })

  // Fix-round-1 controller ruling (Important 4): 같이 only rescues a glued
  // continuation after a DETACHED josa, never directly after a bare name.
  // "사랑같이" has no josa between 사랑 and 같이, so it must NOT bind —
  // consistent with "민수같이" meaning "like Minsu," not a with-relation.
  it('does not bind a bare name directly glued to 같이 with no josa between them', () => {
    const hits = run('사랑같이 지내자')
    expect(hits.find((h) => h.memberId === 'm-sarang')).toBeUndefined()
  })
})

describe('longest-first wins BEFORE identity dedup (fix-round-1 Important 3)', () => {
  // members where one name is a strict prefix of the other: a second
  // occurrence of the longer name must not fall through to a shorter-name
  // + spurious-josa reading just because the longer name is already
  // `seen` — the token's WINNER is decided first, dedup only after.
  it('never re-binds a repeated token to a shorter prefix name (유나/유)', () => {
    const mem: ChatMember[] = [
      { id: 'm-yuna', name: '유나' },
      { id: 'm-yu', name: '유' },
    ]
    const hits = findPeople(tokenize('유나 유나'), '유나 유나', mem)
    expect(hits).toEqual([
      { memberId: 'm-yuna', start: 0, end: 2, role: 'plain', honorific: false },
    ])
  })
  it('never re-binds a repeated token to a shorter prefix name (사랑/사)', () => {
    const mem: ChatMember[] = [
      { id: 'm-sarang', name: '사랑' },
      { id: 'm-sa', name: '사' },
    ]
    const hits = findPeople(tokenize('사랑 사랑'), '사랑 사랑', mem)
    expect(hits).toEqual([
      {
        memberId: 'm-sarang',
        start: 0,
        end: 2,
        role: 'plain',
        honorific: false,
      },
    ])
  })
})

describe('resolvePayer (adapter, backlog #3: same-clause subject rule)', () => {
  // 유나 is only the subject of an embedded relative clause ("the
  // restaurant Yuna recommended"), not of the pay-verb — 민수 (with-role,
  // "함께") sits between her and the verb, and 추천한 (a verb form) sits
  // between 유나 and the pay-verb — a genuine clause boundary. No name in
  // the pay-verb's own clause is eligible, so the actor keeps the payer
  // role rather than wrongly crediting 유나.
  it('does not credit a name from an unrelated relative clause as payer', () => {
    const s = '유나가 추천한 식당에서 민수랑 냈어'
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-actor')
  })

  // Fix-round-1 Critical 1: the MIRROR shapes of the case above, where the
  // subject-marked name and the pay-verb ARE in the same clause (nothing
  // but a companion phrase, an adverb+object, or a dative mention sits
  // between them) — the subject must win, not fall back to the actor.
  it.each([
    ['유나가 민수랑 냈어', 'm-yuna'],
    ['유나가 어제 민수랑 저녁 샀어', 'm-yuna'],
    ['민수가 유나한테 카드로 결제했어', 'm-minsu'],
    ['민수랑 유나가 냈어', 'm-yuna'], // original backlog #3 mirror-order pin
  ])('binds the same-clause subject as payer: %s', (s, expected) => {
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expected)
  })

  // Fix-round-1 Critical 2: the subject-marked SECOND mention of a person
  // already mentioned with a companion/dative particle must still resolve
  // as payer, and its span must still be scrubbed from parse()'s
  // description (not just the first, deduped-away mention).
  // Task 8: the second row's expected description was '물어보고 어' — the
  // trailing-어 ARTIFACT of index.ts's old global NOISE regex, which knew the
  // stem 결제했 but not where the inflected form ended and so left its last
  // syllable behind as description text. The pipeline scrubs the pay-verb's
  // own SPAN (parsers/split.ts reports the full inflection), so 결제했어 goes
  // whole and the clean value is '물어보고'. Sanctioned pin update.
  it.each([
    ['민수랑 먹었는데 민수가 냈어', 'm-minsu', '먹었는데'],
    ['민수한테 물어보고 민수가 결제했어', 'm-minsu', '물어보고'],
  ])(
    'binds the subject-marked repeat mention as payer and scrubs it from the description: %s',
    (s, expectedPayer, expectedDescription) => {
      const hits = findMembers(s, members)
      expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expectedPayer)
      const ctx = { members, actorId: 'm-actor', defaultCurrency: 'KRW' }
      expect(parse(s, ctx).description).toBe(expectedDescription)
    },
  )

  // Fix-round-2 Critical: round 1's clause-boundary heuristic ("last
  // syllable's jongseong is ㄴ") coincidentally matched ordinary
  // currency/counter words — 원/잔/반/건 all end in a ㄴ-jongseong syllable
  // with NO grammatical relation to a verb ending, so "유나가 3만원 냈어"
  // (the product's single most common sentence shape) wrongly fell back to
  // the actor. Replaced with a narrow, literal closed set of actual
  // attributive/relative-clause endings (한/던 single-syllable; 해서/아서/
  // 어서/워서/는데/니까/면서/았던/었던 two-syllable) plus mandatory amount
  // masking (extractAmount) so a currency span is never even offered to
  // the boundary scan. Every row from both review rounds' verification
  // tables, asserted together so a future change can't silently regress
  // one shape while fixing another.
  it.each([
    ['유나가 3만원 냈어', 'm-yuna'],
    ['유나가 5000원 냈어', 'm-yuna'],
    ['유나가 술값 5만원 결제했어', 'm-yuna'],
    ['유나가 3만원 카드로 결제했어', 'm-yuna'],
    ['민수가 어제 3만원 냈어', 'm-minsu'],
    ['민수가 저녁값 반반 냈어', 'm-minsu'],
    ['민수가 커피 두 잔 샀어', 'm-minsu'],
    ['유나가 사건 때문에 냈어', 'm-yuna'],
    ['유나가 민수랑 냈어', 'm-yuna'],
    ['유나가 어제 민수랑 저녁 샀어', 'm-yuna'],
    ['민수가 유나한테 카드로 결제했어', 'm-minsu'],
    ['민수랑 유나가 냈어', 'm-yuna'],
    ['유나가 추천한 식당에서 민수랑 냈어', 'm-actor'],
    ['유나가 추천해서 민수랑 냈어', 'm-actor'],
    ['유나가 먹었는데 민수랑 냈어', 'm-actor'],
    ['지난주에 유나가 민수랑 냈어', 'm-yuna'],
    ['맛있는 거 유나가 샀어', 'm-yuna'],
    ['민수랑 먹었는데 민수가 냈어', 'm-minsu'],
  ])('fix-round-2 verification table: %s -> %s', (s, expected) => {
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expected)
  })

  it('a sentence with no pay-verb at all always keeps the actor, regardless of who is named', () => {
    const s = '유나가 산 거 민수랑 나눴어'
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-actor')
  })

  // Fix-round-3 Critical: round 2's {한, 던} single-syllable set matched a
  // BARE "한" token too — the "one" determiner ("맥주 한 잔," "한 번," "한
  // 판"), not just the attributive verb ending ("추천한"). A bare
  // 1-syllable token can never BE a verb's attributive ending (no room for
  // a stem), so it must never count as a boundary — only a 2+-syllable
  // token ending in 한/던 does. Covers both the spaced ("한 잔") and glued
  // ("한잔") counter-phrase forms.
  it.each([
    ['유나가 맥주 한 잔 샀어', 'm-yuna'],
    ['유나가 삼겹살 한 판 샀어', 'm-yuna'],
    ['유나가 소주 한 병 샀어', 'm-yuna'],
    ['유나가 한 사람당 만원씩 냈어', 'm-yuna'],
    ['유나가 3만원 한 번에 냈어', 'm-yuna'],
    ['유나가 커피 한 번 샀어', 'm-yuna'],
    ['유나가 맥주 한잔 샀어', 'm-yuna'],
    ['유나가 삼겹살 한판 샀어', 'm-yuna'],
    ['유나가 소주 한병 샀어', 'm-yuna'],
  ])('the "한" (one) determiner is never a clause boundary: %s -> %s', (s, expected) => {
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expected)
  })

  // Fix-round-3 Important: -(으)면서/-(으)니까 dropped from the boundary
  // set entirely, not just narrowed — 면서 grammatically requires the SAME
  // subject in both clauses it connects, so treating it as a boundary can
  // only ever produce a WRONG actor fallback in this domain; 니까's
  // same-subject reading dominates ordinary expense-chat phrasing the same
  // way.
  it.each([
    ['유나가 오면서 커피 샀어', 'm-yuna'],
    ['유나가 카드 있으니까 냈어', 'm-yuna'],
    ['민수가 돈이 있으니까 결제했어', 'm-minsu'],
  ])('면서/니까 are never clause boundaries (same-subject dominates): %s -> %s', (s, expected) => {
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expected)
  })

  // Fix-round-3 residual, RESOLVED in Task 8 (sanctioned pin flip): the
  // non-하다 past-attributive verb class (고르다→고른, 시키다→시킨, 먹다→먹은,
  // 사다→산, 만들다→만든, …) had no representative in the literal ending set
  // this pin was written against, so 고른 was never recognized as a clause
  // boundary and 유나 was wrongly credited. people.ts now delegates to
  // ko/attributive.ts, which reads 고른 as 고르+ㄴ — a VERB stem, so a
  // boundary — and the pin flips to its documented REAL answer: 유나 is only
  // the subject of "the restaurant she picked," an embedded clause, exactly
  // like the already-fixed 추천한 case, so the actor keeps the payer role.
  it('non-하다 past-attributive endings (고른) are a clause boundary', () => {
    const s = '유나가 고른 식당에서 민수랑 냈어'
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-actor')
  })

  // Fix-round-4 residual, RESOLVED in Task 8 (sanctioned pin flip) — the
  // OPPOSITE failure direction from the 고른 pin above, which is why the
  // ending alone could never settle either: the OPEN 하다-adjective
  // attributive class (유명한/저렴한/시원한/간단한/…) is a 2+-syllable word
  // ending in 한, indistinguishable from 추천한 by ending, and so was wrongly
  // treated as a boundary. ko/attributive.ts reads 시원한 as 시원하+ㄴ — an
  // ADJECTIVE stem — so it modifies the following noun and never displaces
  // the subject, and the pin flips to its documented REAL answer, 유나.
  it('the 하다-adjective attributive class (시원한) is NOT a clause boundary', () => {
    const s = '유나가 시원한 맥주 샀어'
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-yuna')
  })
})

// ===========================================================================
// Task 8 fix round 1
// ===========================================================================

describe('English companion preposition binds to the person span (I1)', () => {
  const latin: ChatMember[] = [{ id: 'm-sam', name: 'Sam' }]

  it('"with Sam" is ONE span, role with — the English companion-josa equivalent', () => {
    const s = 'paid $45 for lunch with Sam'
    const hits = findPeople(tokenize(s), s, latin)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ memberId: 'm-sam', role: 'with' })
    expect(s.slice(hits[0].start, hits[0].end)).toBe('with Sam')
  })

  it('the preposition therefore leaves no residue in the description', () => {
    const ctx = { members: latin, actorId: 'm-actor', defaultCurrency: 'USD' }
    expect(parse('paid $45 for lunch with Sam', ctx).description).toBe('for lunch')
  })

  it('a with-marked English name is never the payer, same as a with-josa Korean one', () => {
    const s = 'lunch with Sam paid'
    const hits = findMembers(s, latin)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe('m-actor')
  })

  it('only an IMMEDIATELY preceding preposition binds', () => {
    // "with" governs "cash" here, not the name two words later.
    const s = 'paid with cash, Sam owes me'
    const hits = findPeople(tokenize(s), s, latin)
    expect(hits[0]).toMatchObject({ memberId: 'm-sam', role: 'plain' })
    expect(s.slice(hits[0].start, hits[0].end)).toBe('Sam')
  })
})

describe('payer resolution reads the verb LEXICON, not a regex (I3)', () => {
  // Each row was WRONG under the old `/냈|냄|결제|계산|샀|쐈|paid|bought/`
  // regex, in one of its two failure directions. The first four are verbs the
  // regex simply did not list, so the sentence read as "nobody paid" and the
  // payer silently fell back to the actor. The last is the opposite: 계산서
  // is the BILL, a noun, and the regex saw its own 계산 inside it and credited
  // whoever stood nearby.
  it.each([
    ['민수가 지불했어 3만원', 'm-minsu'],
    ['유나가 사줬어 3만원', 'm-yuna'],
    ['민수가 긁었어 3만원', 'm-minsu'],
    ['유나가 쏜다 3만원', 'm-yuna'],
    ['유나가 계산서 봤어 3만원', 'm-actor'],
  ])('%s -> %s', (s, expected) => {
    const hits = findMembers(s, members)
    expect(resolvePayer(s, hits, 'm-actor').payerId).toBe(expected)
  })

  it('hasPayVerb agrees with the same lexicon in both directions', () => {
    expect(hasPayVerb('지불했어')).toBe(true)
    expect(hasPayVerb('사줬어')).toBe(true)
    expect(hasPayVerb('긁었어')).toBe(true)
    expect(hasPayVerb('쏜다')).toBe(true)
    // backlog #2: a verbal noun carrying a NOUN-forming suffix is not a verb.
    expect(hasPayVerb('계산서 봤어')).toBe(false)
    expect(hasPayVerb('계산기 어디 있어')).toBe(false)
    // …while the bare verbal noun stays loose on purpose (the assistant layer
    // tightens it for its own gate).
    expect(hasPayVerb('계산')).toBe(true)
  })
})
