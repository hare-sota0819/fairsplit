import { describe, expect, it } from 'vitest'
import { tokenize } from '../engine/tokenizer'
import type { ChatMember } from '../types'
import { findAmounts } from './amount'
import { findEditAction, isEditActionWord } from './edit'
import { findPeople } from './people'

const KO_MEMBERS: ChatMember[] = [
  { id: 'm1', name: '민수' },
  { id: 'm2', name: '유나' },
  { id: 'm3', name: '철수' },
]
const EN_MEMBERS: ChatMember[] = [
  { id: 'm1', name: 'Sam' },
  { id: 'm2', name: 'Jo' },
]

function action(input: string, members = KO_MEMBERS, currency = 'KRW') {
  const tokens = tokenize(input)
  return findEditAction(
    tokens,
    input,
    findPeople(tokens, input, members),
    findAmounts(tokens, input, currency),
  )
}

describe("findEditAction — the brief's worked examples", () => {
  it('아까 그 술값에 민수도 껴줘 -> addParticipant(민수)', () => {
    expect(action('아까 그 술값에 민수도 껴줘')).toEqual({
      kind: 'addParticipant',
      memberId: 'm1',
    })
  })

  it('어제 택시비 취소해줘 -> cancel', () => {
    expect(action('어제 택시비 취소해줘')).toEqual({ kind: 'cancel' })
  })

  it('그거 3만원으로 바꿔줘 -> changeAmount("30000", KRW)', () => {
    expect(action('그거 3만원으로 바꿔줘')).toEqual({
      kind: 'changeAmount',
      amount: '30000',
      currency: 'KRW',
    })
  })

  it('remove that expense -> cancel (the object is the expense, not a person)', () => {
    expect(action('remove that expense', EN_MEMBERS, 'USD')).toEqual({
      kind: 'cancel',
    })
  })
})

describe('findEditAction — korean vocabulary', () => {
  it.each([
    ['민수도 껴줘', { kind: 'addParticipant', memberId: 'm1' }],
    ['민수 끼워줘', { kind: 'addParticipant', memberId: 'm1' }],
    ['민수도 넣어주세요', { kind: 'addParticipant', memberId: 'm1' }],
    ['민수 추가해줘', { kind: 'addParticipant', memberId: 'm1' }],
    ['민수 포함해줘', { kind: 'addParticipant', memberId: 'm1' }],
    ['유나 빼줘', { kind: 'removeParticipant', memberId: 'm2' }],
    ['유나 제외해줘', { kind: 'removeParticipant', memberId: 'm2' }],
    ['그거 지워줘', { kind: 'cancel' }],
    ['그거 삭제해줘', { kind: 'cancel' }],
    ['그거 없애줘', { kind: 'cancel' }],
    ['그거 취소', { kind: 'cancel' }],
  ])('%s', (input, expected) => {
    expect(action(input)).toEqual(expected)
  })

  it('a change verb needs an amount to change TO', () => {
    expect(action('그거 5만원으로 수정해줘')).toEqual({
      kind: 'changeAmount',
      amount: '50000',
      currency: 'KRW',
    })
    expect(action('그거 바꿔줘')).toBeNull()
  })
})

describe('findEditAction — a REPORT is not a REQUEST', () => {
  // The stem alone never fires: 취소했어 says a cancellation happened, and
  // 빼고 is the "excluding" connective, not an instruction.
  it.each([
    '그거 취소됐어',
    '어제 취소했어',
    '민수 빼고 다들 정산했어?',
    '민수 빼면 3명이야',
    '사진 지워졌어',
  ])('%s -> no action', (input) => {
    expect(action(input)).toBeNull()
  })
})

describe('findEditAction — never a confidently wrong edit', () => {
  it('an add with no bound name yields nothing (the actor is not this parser\'s to guess)', () => {
    expect(action('나도 껴줘')).toBeNull()
  })

  it('a removal with neither a name nor an expense object yields nothing', () => {
    expect(action('빼줘')).toBeNull()
  })

  it('a change with no amount yields nothing', () => {
    expect(action('그거 금액 바꿔줘')).toBeNull()
  })

  it('a sentence with no action word at all yields nothing', () => {
    expect(action('아까 그 술값 얼마였지?')).toBeNull()
    expect(action('택시 8500원 유나가 냄')).toBeNull()
  })
})

describe('findEditAction — english vocabulary', () => {
  it.each([
    ['add Sam', { kind: 'addParticipant', memberId: 'm1' }],
    ['include Sam too', { kind: 'addParticipant', memberId: 'm1' }],
    ['remove Jo from that', { kind: 'removeParticipant', memberId: 'm2' }],
    ['take Jo out of that', { kind: 'removeParticipant', memberId: 'm2' }],
    ['cancel that', { kind: 'cancel' }],
    ['delete that expense', { kind: 'cancel' }],
    ['make that 30 bucks', { kind: 'changeAmount', amount: '30', currency: 'USD' }],
    // A bare decimal is not an amount to `findAmounts` (only 3+ digits or a
    // comma-grouped number qualifies unmarked), so the marked form is what a
    // change request carries here — this parser owns no second number path.
    [
      'change that to $45.60',
      { kind: 'changeAmount', amount: '45.60', currency: 'USD' },
    ],
  ])('%s', (input, expected) => {
    expect(action(input, EN_MEMBERS, 'USD')).toEqual(expected)
  })

  it('a whole-token match only — `add` never fires inside `address`', () => {
    expect(action('address that', EN_MEMBERS, 'USD')).toBeNull()
  })
})

describe('findEditAction — several action words resolve last-first', () => {
  it('민수 빼고 3만원으로 바꿔줘 -> the change, not the removal', () => {
    expect(action('민수 빼고 3만원으로 바꿔줘')).toEqual({
      kind: 'changeAmount',
      amount: '30000',
      currency: 'KRW',
    })
  })

  it('an unbindable last marker falls back to the next candidate leftwards', () => {
    // 바꿔줘 carries no amount, so it cannot bind; the 껴줘 before it can.
    expect(action('민수도 껴주고 이름 바꿔줘')).toEqual({
      kind: 'addParticipant',
      memberId: 'm1',
    })
  })

  it('the member NEAREST the action word is the one bound', () => {
    expect(action('민수 포함하고 유나 빼줘')).toEqual({
      kind: 'removeParticipant',
      memberId: 'm2',
    })
  })
})

describe('isEditActionWord — the guard reference.ts reads', () => {
  it.each(['취소해줘', '껴줘', '빼줘', '바꿔줘'])('%s is an action word', (word) => {
    expect(isEditActionWord(tokenize(word)[0])).toBe(true)
  })

  it.each(['술값', '택시비', '이자카야', '얼마'])('%s is not', (word) => {
    expect(isEditActionWord(tokenize(word)[0])).toBe(false)
  })
})

describe('findEditAction — a changed amount carries its own currency', () => {
  it('그거 30달러로 바꿔줘 in a KRW group is 30 USD, not 30 KRW', () => {
    expect(action('그거 30달러로 바꿔줘')).toEqual({
      kind: 'changeAmount',
      amount: '30',
      currency: 'USD',
    })
  })

  it('an unmarked amount takes the group default currency', () => {
    // A bare number the text does not mark as money at all — the currency can
    // only come from the group, and it is still carried rather than assumed
    // downstream.
    expect(action('change that to 3000', EN_MEMBERS, 'JPY')).toEqual({
      kind: 'changeAmount',
      amount: '3000',
      currency: 'JPY',
    })
  })
})
