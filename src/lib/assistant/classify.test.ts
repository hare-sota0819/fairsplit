import { describe, expect, it } from 'vitest'
import { parse } from '../chat-parse'
import { classify } from './classify'
import {
  CONFIRM_TOKENS,
  HELP_CORPUS,
  MODIFY_CORPUS,
  NEGATE_TOKENS,
  QUERY_CORPUS,
} from './lexicons'
import type { ModifyCorpusRow, QueryCorpusRow } from './lexicons/corpus'
import type { AssistantContext, Classified } from './types'

// Widened to the shared row type: MODIFY_CORPUS's `as const satisfies` array
// is a union of exact literal members, so a generic .map/.filter over it
// can't access `op`/`split` on a row that happens not to declare them.
const MODIFY_CORPUS_ALL: readonly ModifyCorpusRow[] = MODIFY_CORPUS
const QUERY_CORPUS_ALL: readonly QueryCorpusRow[] = QUERY_CORPUS

// ===== spec §3.0 fixtures =====

const KO_CTX: AssistantContext = {
  members: [
    { id: 'm1', name: '민수' },
    { id: 'm2', name: '유나' },
    { id: 'm3', name: '철수' },
  ],
  actorId: 'me',
  defaultCurrency: 'KRW',
  locale: 'ko',
  openCard: null,
}
const EN_CTX: AssistantContext = {
  members: [
    { id: 'm1', name: 'Sam' },
    { id: 'm2', name: 'Jo' },
    { id: 'm3', name: 'Alex' },
  ],
  actorId: 'me',
  defaultCurrency: 'USD',
  locale: 'en',
  openCard: null,
}
const OPEN_CONFIRM = {
  kind: 'confirm' as const,
  amountMinor: 30000n,
  draft: {
    amount: '30000',
    currency: 'KRW',
    payerId: 'm1',
    participantIds: ['me', 'm1', 'm2', 'm3'],
    description: '저녁',
    funding: 'PAY_AS_YOU_GO' as const,
    missing: [],
    amountMentions: 1,
  },
}
const KO_OPEN: AssistantContext = { ...KO_CTX, openCard: OPEN_CONFIRM }
const EN_OPEN: AssistantContext = { ...EN_CTX, openCard: OPEN_CONFIRM }

// ===================================================================
// §3.1 EXPENSE_ENTRY
// ===================================================================

describe('§3.1 EXPENSE_ENTRY', () => {
  const koMain = [
    '김치찌개 3만원 내가',
    '노래방 3만5천원',
    '택시 8,500원 유나가 냄',
    '커피 5천원',
    '점심 12000원',
    '밥값 3만원 내가 냈어',
    '술값 5만원 n빵',
    '숙소비 15만원 다같이',
    '기름값 4만원 민수랑 반반',
    '택시비 12000원 민수가 결제했어',
    '입장료 2만원 유나가 긁었어',
    '주차비 5000원 철수가 냈어',
    '호텔값 20만원 내가 결제함',
    '지하철비 1500원 다같이',
  ]
  it.each(koMain)('ko main: %s -> EXPENSE_ENTRY -> parse()', (input) => {
    const result = classify(input, KO_CTX)
    expect(result.intent).toBe('EXPENSE_ENTRY')
    expect(result).toEqual({
      intent: 'EXPENSE_ENTRY',
      parsed: parse(input, KO_CTX),
    })
  })

  const enMain = [
    'paid 45 for lunch',
    'paid $45 for lunch',
    'lunch was 30 quid, split it',
    'taxi $20',
    '$20 for the taxi',
    'gas 40 bucks me and Sam',
    'hotel 300 split evenly among the 4 of us',
    'we split the check for dinner three ways',
    'the check came out to 80, split three ways',
    'spent 200 on groceries this trip',
    'i got the taxi 20 bucks split it with sam and jo',
    'paid 45 for lunch can you split it',
  ]
  it.each(enMain)('en main: %s -> EXPENSE_ENTRY -> parse()', (input) => {
    const result = classify(input, EN_CTX)
    expect(result.intent).toBe('EXPENSE_ENTRY')
    expect(result).toEqual({
      intent: 'EXPENSE_ENTRY',
      parsed: parse(input, EN_CTX),
    })
  })

  const koNegative: Array<[string, Classified]> = [
    ['나 얼마 내면 돼?', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    ['우리 총 얼마 썼어?', { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    ['현금 얼마 남았어?', { intent: 'QUERY_WALLET', currency: null }],
    [
      '계산기 어디 있어?',
      { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] },
    ],
    ['계산서 받았어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['카드값 땡겼어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['만두 먹었어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['오랜만에 만났어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['커피 2', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['ㅇㅋ', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['how much do I owe', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    ["what's the total", { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    [
      'how much cash do I have left',
      { intent: 'QUERY_WALLET', currency: null },
    ],
    ['help', { intent: 'HELP' }],
    ['ok', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

// ===================================================================
// §3.2 CONFIRM_YES
// ===================================================================

describe('§3.2 CONFIRM_YES', () => {
  const koRows = CONFIRM_TOKENS.filter((t) => t.locale === 'ko')
  it.each(koRows.map((t) => t.token))(
    'ko (%s tier) -> CONFIRM_YES',
    (token) => {
      expect(classify(token, KO_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
    },
  )

  const enRows = CONFIRM_TOKENS.filter((t) => t.locale === 'en')
  it.each(enRows.map((t) => t.token))('en -> CONFIRM_YES', (token) => {
    expect(classify(token, EN_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
  })

  const koNegative: Array<[string, Classified]> = [
    ['ㄴㅇㅈ', { intent: 'CONFIRM_NO_CANCEL' }],
    [
      'ㄷㄷ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅁㄹ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅗㅜㅑ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㄱㅊ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㄴㄷ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅎㅇ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㄱㅅ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅅㄱ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅈㅅ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅊㅋ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㄲㅂ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅂㅂ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅇㅎ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅋㅋ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅎㅎ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      'ㅠㅠ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      '글쎄',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    ['잠깐만', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['아 맞다', { intent: 'CONFIRM_MODIFY', field: null }],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_OPEN)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    [
      'not sure',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    ['no can do', { intent: 'CONFIRM_NO_CANCEL' }],
    ['hard pass', { intent: 'CONFIRM_NO_CANCEL' }],
    ['wait', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['hold on', { intent: 'UNKNOWN', hold: true, suggest: [] }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_OPEN)).toEqual(expected)
  })
})

// ===================================================================
// §3.3 CONFIRM_NO_CANCEL
// ===================================================================

describe('§3.3 CONFIRM_NO_CANCEL', () => {
  const koRows = NEGATE_TOKENS.filter((t) => t.locale === 'ko')
  it.each(koRows.map((t) => t.token))(
    'ko (%s tier) -> CONFIRM_NO_CANCEL',
    (token) => {
      expect(classify(token, KO_OPEN)).toEqual({ intent: 'CONFIRM_NO_CANCEL' })
    },
  )

  const enRows = NEGATE_TOKENS.filter((t) => t.locale === 'en')
  it.each(enRows.map((t) => t.token))('en -> CONFIRM_NO_CANCEL', (token) => {
    expect(classify(token, EN_OPEN)).toEqual({ intent: 'CONFIRM_NO_CANCEL' })
  })

  const koNegative: Array<[string, Classified]> = [
    ['잠깐', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['잠깐만', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    // Final-review I4: bare 말고/빼줘/제외 (no name/value) now resolve to a
    // concrete CONFIRM_MODIFY slot instead of routing through UNKNOWN's
    // generic cardOpenAck+card-abandoning-escape-link GUIDED reply — see
    // the dedicated "final review I4" describe block below for the full
    // rationale and the ChatComposer-level askWhatToChange/askWhoToRemove
    // reply each resolves to.
    ['말고', { intent: 'CONFIRM_MODIFY', field: null }],
    [
      '빼줘',
      {
        intent: 'CONFIRM_MODIFY',
        field: 'participants',
        op: 'remove',
        memberId: null,
      },
    ],
    [
      '제외',
      {
        intent: 'CONFIRM_MODIFY',
        field: 'participants',
        op: 'remove',
        memberId: null,
      },
    ],
    [
      'ㄴㄷ',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    [
      '몰라',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      },
    ],
    ['나중에', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['이따', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    [
      '민수 빼줘',
      {
        intent: 'CONFIRM_MODIFY',
        field: 'participants',
        op: 'remove',
        memberId: 'm1',
      },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_OPEN)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['wait', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['hold on', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['hold up', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['no problem', { intent: 'CONFIRM_YES' }],
    [
      'no I meant 50',
      { intent: 'CONFIRM_MODIFY', field: 'amount', amount: '50' },
    ],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_OPEN)).toEqual(expected)
  })
})

// ===================================================================
// §3.4 CONFIRM_MODIFY
// ===================================================================

describe('§3.4 CONFIRM_MODIFY', () => {
  // Extra per-row slots MODIFY_CORPUS doesn't carry (amount values, bound
  // memberIds) — the corpus only stores field/op/split, per its own header
  // (T3/T4 fixture data, not classify()'s vocabulary).
  //
  // TASK 3 SANCTIONED ADDITION (docs/PROMPT.md [2026-08-14] decision 2): every
  // ko row whose amount carries a 원 / Hangul place-value compound now also
  // carries `currency: 'KRW'` — the currency of the very candidate the value
  // was read from. The bare-number rows (`ko::40000`, every `en::… 50`) gain
  // NOTHING, which is the whole point of the slot being optional: a bare number
  // names no currency, so the card keeps its own. No amount VALUE changed.
  const extra: Record<string, Partial<Classified> & Record<string, unknown>> = {
    'ko::3만원 말고 4만원': { amount: '40000', currency: 'KRW' },
    'ko::3만원이 아니라 4만원': { amount: '40000', currency: 'KRW' },
    'ko::3만원이 아니고 4만원': { amount: '40000', currency: 'KRW' },
    'ko::4만원': { amount: '40000', currency: 'KRW' },
    'ko::40000': { amount: '40000' },
    'ko::3만5천원': { amount: '35000', currency: 'KRW' },
    'ko::4만원으로 바꿔줘': { amount: '40000', currency: 'KRW' },
    'ko::민수 말고 철수': { memberId: 'm3' },
    'ko::민수가 아니고 철수': { memberId: 'm3' },
    'ko::유나가 냈어': { memberId: 'm2' },
    'ko::철수가 결제했어': { memberId: 'm3' },
    'ko::민수 빼줘': { memberId: 'm1' },
    'ko::민수님 빼줘': { memberId: 'm1' },
    'ko::민수 제외해줘': { memberId: 'm1' },
    'ko::유나 빼고': { memberId: 'm2' },
    'ko::철수도 포함': { memberId: 'm3' },
    'ko::아니 그게 아니라 4만원': { amount: '40000', currency: 'KRW' },
    'ko::금액 바꿔줘': { amount: null },
    'ko::금액 수정해줘': { amount: null },
    'en::no I meant 50': { amount: '50' },
    'en::no wait I meant 50': { amount: '50' },
    'en::change it to 50': { amount: '50' },
    'en::change that to 50': { amount: '50' },
    'en::make it 50': { amount: '50' },
    'en::actually 50': { amount: '50' },
    "en::actually it's 50": { amount: '50' },
    'en::actually 50 not 45': { amount: '50' },
    'en::sorry I meant 50': { amount: '50' },
    'en::sorry, 50 not 45': { amount: '50' },
    'en::scratch that, 50': { amount: '50' },
    'en::50': { amount: '50' },
    'en::remove Sam': { memberId: 'm1' },
    'en::take Sam out': { memberId: 'm1' },
    'en::minus Sam': { memberId: 'm1' },
    'en::without Sam': { memberId: 'm1' },
    'en::everyone but Sam': { memberId: 'm1' },
    'en::just me and Sam': { memberIds: ['me', 'm1'] },
    'en::oops meant 50': { amount: '50' },
    'en::wait no, 50': { amount: '50' },
  }

  // `민수님 빼줘` (ko 확장) used to be a declared, spec-acknowledged gap:
  // findMembers didn't consume the 님/씨 honorific (parser backlog #4). Goat
  // Task 4's token-based `findPeople` closes that gap, so this row is now
  // covered by the general corpus-driven table below like any other row
  // (`extra['ko::민수님 빼줘']` supplies its bound memberId).
  const rows = MODIFY_CORPUS_ALL
  it.each(
    rows.map((r) => [r.locale, r.pattern, r.field, r.op, r.split] as const),
  )(
    '%s (%s) -> CONFIRM_MODIFY field=%s op=%s split=%s',
    (locale, pattern, field, op, split) => {
      const ctx = locale === 'ko' ? KO_OPEN : EN_OPEN
      const key = `${locale}::${pattern}`
      const want: Record<string, unknown> = {
        intent: 'CONFIRM_MODIFY',
        field,
        ...(op !== undefined ? { op } : {}),
        ...(split !== undefined ? { split } : {}),
        ...(extra[key] ?? {}),
      }
      expect(classify(pattern, ctx)).toEqual(want)
    },
  )

  const koNegative: Array<[string, AssistantContext, Classified]> = [
    [
      '숙소비 15만원 다같이',
      KO_OPEN,
      {
        intent: 'EXPENSE_ENTRY',
        parsed: parse('숙소비 15만원 다같이', KO_OPEN),
      },
    ],
    [
      '빼줘',
      KO_OPEN,
      {
        intent: 'CONFIRM_MODIFY',
        field: 'participants',
        op: 'remove',
        memberId: null,
      },
    ],
    ['말고', KO_OPEN, { intent: 'CONFIRM_MODIFY', field: null }],
    ['잠깐', KO_OPEN, { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['아니', KO_OPEN, { intent: 'CONFIRM_NO_CANCEL' }],
    ['ㅇㅋ', KO_OPEN, { intent: 'CONFIRM_YES' }],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, ctx, expected) => {
    expect(classify(input, ctx)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['cancel', { intent: 'CONFIRM_NO_CANCEL' }],
    ['yep', { intent: 'CONFIRM_YES' }],
    [
      'hotel 300 split evenly among the 4 of us',
      {
        intent: 'EXPENSE_ENTRY',
        parsed: parse('hotel 300 split evenly among the 4 of us', EN_OPEN),
      },
    ],
    ['wait', { intent: 'UNKNOWN', hold: true, suggest: [] }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_OPEN)).toEqual(expected)
  })
})

// ===================================================================
// §3.4 addendum — DECISIONS.md 2026-08-10 erratum (f, closing round): a bare
// amount reply carrying the "change it TO ___" particle (으로) — or any of
// its natural politeness/request-suffixed siblings (요/이요/해줘/해주세요) —
// is the single most natural reply to the assistant's own `얼마로 바꿀까요?`
// follow-up question. The WHOLE family used to fail isFragment on its
// trailing residue and fall through to EXPENSE_ENTRY, superseding the open
// card with a junk draft literally described by that residue (e.g. "으로",
// "해줘") — a destructive class of bug (the card and its edits so far are
// gone, not just unedited), not a mere unanswered question. Fixed in two
// layers: `으로` in noise.ts's FRAGMENT_FILLER_WORDS (substring-safe
// anywhere, first round), and `FRAGMENT_TRAILING_WORDS` (해주세요/해줘/요,
// suffix-only, fixpoint, this round) for every remaining trailing form.
// These rows extend beyond the spec's own §3.4 corpus (a Task 7 review
// finding, not an attested-research row), so they live in their own block
// instead of inside MODIFY_CORPUS, which stays byte-faithful to the spec.
// ===================================================================

describe('§3.4 addendum — 으로-suffixed amount replies (erratum f)', () => {
  it.each([
    '3만원으로',
    '금액 3만원으로',
    '30000원으로',
    // The 6 undocumented siblings (round 2): every natural
    // politeness/request-suffixed way of answering "얼마로 바꿀까요?" that
    // the first round's narrower `으로`-only fix left broken.
    '3만원으로요',
    '3만원으로 해줘',
    '3만원이요',
    '3만원요',
    '3만원 해줘',
    '3만원으로 해주세요',
    '3만원으로요.',
    '3만원 해주세요',
  ])('%s (confirm card open) -> CONFIRM_MODIFY amount edit', (input) => {
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '30000',
      // Task 3 sanctioned addition: every input here says 원, so the slot now
      // reports the currency it was read from. Value and field unchanged.
      currency: 'KRW',
    })
  })

  // The fix is not confirm-card-specific — an askAmount card (no amount on
  // the draft yet) reads the exact same "change it to ___" reply the same
  // way. Spot-checked with one plain and one suffixed form; the full set
  // above already proves the confirm-kind path exhaustively.
  it.each(['3만원으로', '3만원 해줘'])(
    '%s (askAmount card open) -> CONFIRM_MODIFY amount edit',
    (input) => {
      const askAmountOpen: AssistantContext = {
        ...KO_CTX,
        openCard: { kind: 'askAmount', draft: OPEN_CONFIRM.draft },
      }
      expect(classify(input, askAmountOpen)).toEqual({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        amount: '30000',
        // Task 3 sanctioned addition — see the block above.
        currency: 'KRW',
      })
    },
  )

  // Was: a RULED accepted safe-miss returning `amount: null`, on the grounds
  // that a particle (을) riding on the field noun was an untested
  // substring-collision risk and asking again was non-destructive.
  //
  // TASK 11 SANCTIONED CHANGE (fix round 1, controller ruling on the
  // escalation): the VALUE READ IS INTENDED. The controller ruled that the
  // old `amount: null` was a limitation of the pattern set, not a product
  // preference — a user typing this with a card open unambiguously means "set
  // it to 30000", and the confirm card still shows the result before anything
  // is saved. No revert.
  //
  // FIELD DETECTION IS UNCHANGED, which is why the earlier ruling's own
  // concern is untouched: which pattern matches, and how the field is
  // resolved, are byte-identical. What changed is only that a pattern NAMING
  // the amount field now licenses reading the amount sitting right there in
  // the same sentence, exactly as the field-less connectives ("바꿔", "make
  // it") always did.
  it('금액을 3만원으로 (confirm card open) -> CONFIRM_MODIFY amount:30000', () => {
    expect(classify('금액을 3만원으로', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '30000',
      // Task 3 sanctioned addition — see the block above.
      currency: 'KRW',
    })
  })
})

// ===================================================================
// Round 2 — reviewer fixes (C1/I2/I3/I5/I6/M9-M13)
// ===================================================================

// A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차"): the dedicated
// `crossCurrency` OpenCard kind (round-2 review M11) is gone — a
// foreign-currency draft is an ordinary `confirm` card now, same as
// `OPEN_CONFIRM` above except its currency differs from `ctx.defaultCurrency`
// (KRW). See the "A2: foreign-currency confirm cards" describe block below.
const FOREIGN_CONFIRM_OPEN: AssistantContext = {
  ...KO_CTX,
  openCard: {
    kind: 'confirm',
    amountMinor: 3000n,
    draft: {
      amount: '3000',
      currency: 'JPY',
      payerId: 'm1',
      participantIds: ['me', 'm1', 'm2', 'm3'],
      description: '저녁',
      funding: 'PAY_AS_YOU_GO',
      missing: [],
      amountMentions: 1,
    },
  },
}

describe('round 2 — C1: the real §2.4 fragment gate', () => {
  it('card open, "다같이 쓴 돈 총 얼마야" -> falls through to QUERY_GROUP_TOTAL (collision #8: real content survives, not a fragment)', () => {
    expect(classify('다같이 쓴 돈 총 얼마야', KO_OPEN)).toEqual({
      intent: 'QUERY_GROUP_TOTAL',
      view: 'total',
    })
  })

  it('card open, "민수 빼고 다들 정산했어?" -> falls through to UNKNOWN, never EXPENSE_ENTRY or CONFIRM_MODIFY', () => {
    const result = classify('민수 빼고 다들 정산했어?', KO_OPEN)
    expect(result.intent).toBe('UNKNOWN')
  })

  it('card open, bare "유나" -> IS a fragment -> CONFIRM_MODIFY payer', () => {
    expect(classify('유나', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'payer',
      memberId: 'm2',
    })
  })

  it('card open, bare "Sam" -> IS a fragment -> CONFIRM_MODIFY payer', () => {
    expect(classify('Sam', EN_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'payer',
      memberId: 'm1',
    })
  })

  // -- final-review property pin: FRAGMENT_TRAILING_WORDS is suffix-only
  // (strips ONLY the tail of an already-empty remainder), never a
  // substring-anywhere strip — verified against the two rows the final
  // review named. A naive substring-anywhere `요` strip would either eat
  // into real content mid-sentence or corrupt a word that merely starts
  // with 요 (like 요금).
  it.each([
    // "정산했어요?" adds the trailing politeness 요 (over the existing
    // "정산했어?" collision row above) — FRAGMENT_TRAILING_WORDS strips it
    // to "정산했어", still non-empty (다들/정산했어 survive), so the fall-
    // through to UNKNOWN is unaffected by the new suffix-strip.
    ['민수 빼고 다들 정산했어요?', 'UNKNOWN'],
    // "요금" ("fee/charge") starts with 요, not ends with it — the
    // remainder after amount/currency stripping is "요금" alone, which does
    // NOT end in 요, so the trailing-only strip must never touch it. With a
    // card open and a real amount, this is a fresh EXPENSE_ENTRY (P5 wins
    // regardless of card state), not a corrupted CONFIRM_MODIFY amount edit.
    ['요금 3만원', 'EXPENSE_ENTRY'],
  ] as const)(
    'card open, %s -> %s (FRAGMENT_TRAILING_WORDS suffix-only)',
    (input, intent) => {
      expect(classify(input, KO_OPEN).intent).toBe(intent)
    },
  )
})

// ===================================================================
// Final-review I1: tryModify's payer step (verbWinner) is now
// fragment-gated like every other field — it was the only one that wasn't.
// ===================================================================

describe('final review I1: payer step (verbWinner) is fragment-gated', () => {
  it('card open, "택시 8500원 유나가 냄" -> a NEW EXPENSE_ENTRY, never a corrupted CONFIRM_MODIFY payer edit', () => {
    // OPEN_CONFIRM's own payer is 'm1' (민수) — if the old unconditional
    // verbWinner check fired here, this would wrongly report
    // {intent:'CONFIRM_MODIFY', field:'payer', memberId:'m2'} and silently
    // swallow the entire taxi expense into a payer correction on an
    // unrelated card.
    const result = classify('택시 8500원 유나가 냄', KO_OPEN)
    expect(result.intent).toBe('EXPENSE_ENTRY')
  })

  it('card open, "8500원 택시 유나가 냄" (amount leads) -> still a NEW EXPENSE_ENTRY', () => {
    const result = classify('8500원 택시 유나가 냄', KO_OPEN)
    expect(result.intent).toBe('EXPENSE_ENTRY')
  })

  it('card open, "유나가 냈어" (bare payer correction, no amount/description) -> stays CONFIRM_MODIFY payer', () => {
    expect(classify('유나가 냈어', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'payer',
      memberId: 'm2',
    })
  })

  it('card open, "철수가 결제했어" (bare payer correction) -> stays CONFIRM_MODIFY payer', () => {
    expect(classify('철수가 결제했어', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'payer',
      memberId: 'm3',
    })
  })
})

describe('round 2 — I2: P5 restores the spec conjunct (bare fragments no longer open a card)', () => {
  // round-2 review I2: a bare bound name is now a QUERY_PAIRWISE partial
  // hit for the ranked GUIDED suggestion, replacing the generic HELP-only
  // fallback — still never EXPENSE_ENTRY, the point of this test.
  it('no card, bare "민수" -> UNKNOWN, not EXPENSE_ENTRY', () => {
    expect(classify('민수', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_PAIRWISE'],
    })
  })

  it('no card, bare "Sam" -> UNKNOWN, not EXPENSE_ENTRY', () => {
    expect(classify('Sam', EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_PAIRWISE'],
    })
  })

  it('no card, bare "반반" -> UNKNOWN, not EXPENSE_ENTRY', () => {
    expect(classify('반반', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
  })

  // round-2 review I2: `cash` alone is a QUERY_WALLET walletNoun partial
  // hit now, not the generic HELP-only fallback.
  it('no card, bare "cash" -> UNKNOWN, not EXPENSE_ENTRY', () => {
    expect(classify('cash', EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_WALLET'],
    })
  })

  it('all 26 §3.1 EXPENSE_ENTRY main rows still classify correctly under the restored conjunct', () => {
    const koMain = [
      '김치찌개 3만원 내가',
      '노래방 3만5천원',
      '택시 8,500원 유나가 냄',
      '커피 5천원',
      '점심 12000원',
      '밥값 3만원 내가 냈어',
      '술값 5만원 n빵',
      '숙소비 15만원 다같이',
      '기름값 4만원 민수랑 반반',
      '택시비 12000원 민수가 결제했어',
      '입장료 2만원 유나가 긁었어',
      '주차비 5000원 철수가 냈어',
      '호텔값 20만원 내가 결제함',
      '지하철비 1500원 다같이',
    ]
    for (const input of koMain) {
      expect(classify(input, KO_CTX).intent).toBe('EXPENSE_ENTRY')
    }
    const enMain = [
      'paid 45 for lunch',
      'paid $45 for lunch',
      'lunch was 30 quid, split it',
      'taxi $20',
      '$20 for the taxi',
      'gas 40 bucks me and Sam',
      'hotel 300 split evenly among the 4 of us',
      'we split the check for dinner three ways',
      'the check came out to 80, split three ways',
      'spent 200 on groceries this trip',
      'i got the taxi 20 bucks split it with sam and jo',
      'paid 45 for lunch can you split it',
    ]
    for (const input of enMain) {
      expect(classify(input, EN_CTX).intent).toBe('EXPENSE_ENTRY')
    }
  })
})

describe('round 2 — I3: P2/hasExpenseSignal consult the whitespace shadow', () => {
  it('card open, "다 같이" (spaced) resolves the same as "다같이"', () => {
    expect(classify('다 같이', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'split',
      split: 'everyone',
    })
  })

  it('card open, "N빵" (capitalized) resolves the same as "n빵"', () => {
    expect(classify('N빵', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'split',
      split: 'everyone',
    })
  })
})

describe('round 2 — I5/M9/M10: last-wins per §2.6', () => {
  it('split: "반반 아니고 다같이" -> everyone (the LAST split word wins)', () => {
    expect(classify('반반 아니고 다같이', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'split',
      split: 'everyone',
    })
  })

  it('participants: "민수 포함 유나 빼줘" -> remove 유나 (LAST op + nearest name, not the first-mentioned name)', () => {
    expect(classify('민수 포함 유나 빼줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'participants',
      op: 'remove',
      memberId: 'm2',
    })
  })

  it('payer: "유나가 냈어 아니 철수가 냈어" -> 철수 (the LAST correction wins)', () => {
    expect(classify('유나가 냈어 아니 철수가 냈어', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'payer',
      memberId: 'm3',
    })
  })
})

describe('round 2 — I6: case-folded P1 whole-input equality', () => {
  it.each(['No', 'NO', 'nO'])(
    '%s -> CONFIRM_NO_CANCEL (case-folded)',
    (input) => {
      expect(classify(input, EN_OPEN)).toEqual({ intent: 'CONFIRM_NO_CANCEL' })
    },
  )
  it.each(['OK', 'Ok'])('%s -> CONFIRM_YES (case-folded)', (input) => {
    expect(classify(input, EN_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
  })
  it('Sure -> CONFIRM_YES (case-folded)', () => {
    expect(classify('Sure', EN_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
  })
  it('Yep -> CONFIRM_YES (case-folded)', () => {
    expect(classify('Yep', EN_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
  })
  it('Wait -> UNKNOWN hold (case-folded, HOLD_TOKENS)', () => {
    expect(classify('Wait', EN_OPEN)).toEqual({
      intent: 'UNKNOWN',
      hold: true,
      suggest: [],
    })
  })
  it('P3 query matching stays case-sensitive (collision #20: I vs we pronoun survives)', () => {
    // "how much do I owe" (capital I) is the attested §3.1 NEGATIVE row —
    // confirms case-sensitivity wasn't broken by the P1 fold.
    expect(classify('how much do I owe', EN_CTX)).toEqual({
      intent: 'QUERY_MY_BALANCE',
      view: 'amount',
    })
  })
})

describe('round 2 — M8: trailing !/. runs stripped before P1, never ?', () => {
  it('"OK!!!" -> CONFIRM_YES', () => {
    expect(classify('OK!!!', EN_OPEN)).toEqual({ intent: 'CONFIRM_YES' })
  })
  it('"no." -> CONFIRM_NO_CANCEL', () => {
    expect(classify('no.', EN_OPEN)).toEqual({ intent: 'CONFIRM_NO_CANCEL' })
  })
})

// A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차") superseded round-2's
// M11: a crossCurrency card used to refuse CONFIRM_YES and CONFIRM_MODIFY
// (pointing CONFIRM_YES at the wizard handoff instead, spec §2.2 as it stood
// then). That dead end is gone — a foreign-currency draft is an ordinary
// `confirm` card, so both intents now resolve exactly as they would for a
// same-currency card. This block replaces the old M11 test.
describe('A2: foreign-currency confirm cards behave like any other confirm card', () => {
  it('a YES token on a foreign-currency confirm card -> CONFIRM_YES, not a wizard-handoff suggestion', () => {
    expect(classify('ㅇㅇ', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_YES',
    })
  })

  it('a worded edit on a foreign-currency confirm card -> CONFIRM_MODIFY, same as any other card', () => {
    expect(classify('3만원으로', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '30000',
      // Task 3 sanctioned addition, and the sharpest case of it: the card is
      // JPY, the reply says 원, so the slot reports KRW. Per the owner's
      // ruling the card is an unsaved draft and follows the reply.
      currency: 'KRW',
    })
  })

  // Task 3 fix round 1 (M2): the case the optional slot exists FOR, asserted
  // on the card where getting it wrong actually costs money. A bare number
  // typed at a JPY card carries no currency key at all, so the composer leaves
  // the card on JPY — the old `defaultCurrency` reading would have silently
  // repriced ¥4,000 as ₩4,000.
  it('a bare number on a foreign-currency confirm card carries NO currency key', () => {
    expect(classify('4000으로', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '4000',
    })
  })

  it('a NO token on a foreign-currency confirm card -> CONFIRM_NO_CANCEL, unchanged from before A2', () => {
    expect(classify('아니', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_NO_CANCEL',
    })
  })
})

// ===================================================================
// Task 3 (docs/PROMPT.md [2026-08-14] decision 2) — open-card currency edit
// ===================================================================

/**
 * The owner's ruling: an OPEN card is an unsaved DRAFT, so a reply that names
 * a currency changes the draft's currency directly, together with its amount
 * ("4000엔으로 바꿔줘" → ¥4,000, not ₩4,000). The `amount` slot therefore
 * carries the currency of the SAME candidate its value came from — exactly the
 * currency binding `EDIT_EXPENSE`'s `changeAmount` action has carried since T9
 * (chat-parse/parsers/edit.ts) — and carries NOTHING when the reply is a bare
 * number, which is what leaves the card on its own currency.
 *
 * The saved-expense rung of the same ladder (an edit aimed at an expense that
 * is already stored) is F-T4's, not this one: with no card open, every
 * sentence below classifies exactly as it did before, pinned here.
 */
describe('Task 3 — an open card takes the currency the reply names', () => {
  it('4000엔으로 바꿔줘 -> amount 4000 in JPY, not the card’s KRW', () => {
    expect(classify('4000엔으로 바꿔줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '4000',
      currency: 'JPY',
    })
  })

  it('50달러로 바꿔줘 -> USD', () => {
    expect(classify('50달러로 바꿔줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '50',
      currency: 'USD',
    })
  })

  // 원 is as explicit a currency signal as 엔 — a Hangul compound is always
  // KRW (`scanAmountCandidates`), so this names KRW even on a JPY card.
  it('3만원으로 -> KRW', () => {
    expect(classify('3만원으로', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '30000',
      currency: 'KRW',
    })
  })

  it('4000엔으로 (askAmount card open) -> JPY, same as a confirm card', () => {
    const askAmountOpen: AssistantContext = {
      ...KO_CTX,
      openCard: { kind: 'askAmount', draft: OPEN_CONFIRM.draft },
    }
    expect(classify('4000엔으로', askAmountOpen)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '4000',
      currency: 'JPY',
    })
  })

  // No currency key at all — NOT `defaultCurrency`. A bare number says nothing
  // about currency, and the composer must leave the card's own alone (a JPY
  // card answered with "4000" stays JPY).
  it.each(['4000으로', '4000으로 바꿔줘'])(
    '%s -> no currency slot, so the card keeps its own',
    (input) => {
      expect(classify(input, KO_OPEN)).toEqual({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        amount: '4000',
      })
    },
  )

  // T11's parse()-gated field-noun licence, unchanged: 3명 is a headcount, so
  // the slot stays null — and null carries no currency either.
  it('금액을 3명으로 나눠줘 -> amount null (T11 licence regression)', () => {
    expect(classify('금액을 3명으로 나눠줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: null,
    })
  })

  // The no-card rung belongs to F-T4. Pinned as-is so this task cannot move it.
  it.each(['4000엔으로 바꿔줘', '3만원으로'])(
    'no card open: %s classifies exactly as before',
    (input) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'EXPENSE_ENTRY',
        parsed: parse(input, KO_CTX),
      })
    },
  )

  it('no card open: 4000으로 stays a guided UNKNOWN', () => {
    expect(classify('4000으로', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
  })
})

/**
 * FIX ROUND 1 (controller ruling): two pre-existing fragment-check gaps that
 * this feature made newly reachable — with no way to name a currency at a
 * card, nobody had ever typed these sentences at one. Both DESTROYED the open
 * card: the reply fell out of P2, reached P5, and superseded the card with a
 * junk draft described "로" / "으로" / "$".
 *
 *  - I1a: Korean drops the 으 of 으로 after a VOWEL-final noun. `으로` was
 *    already fragment-check noise; bare `로` (달러로, 유로로) was not. Fixed
 *    with a TRAILING-only entry — `로` is far too common a syllable (로마,
 *    따로, 새로) to strip as a substring anywhere.
 *  - I1b: the fragment check stripped currency WORDS but not currency
 *    SYMBOLS, so `$50으로` kept a lone `$` and looked like surviving content.
 */
describe('Task 3 fix round 1 (I1) — vowel-final currency words and symbols', () => {
  it.each([
    ['50달러로', '50', 'USD'],
    ['50유로로', '50', 'EUR'],
    ['$50으로', '50', 'USD'],
    ['₩5000으로', '5000', 'KRW'],
    ['€50으로', '50', 'EUR'],
  ])('%s at an open card -> CONFIRM_MODIFY %s %s', (input, amount, currency) => {
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount,
      currency,
    })
  })

  // N3 (fix round 2): the symbol-strip widening is INTENTIONAL, so a bare
  // symbol-led amount with no particle at all is pinned as such — in both
  // locales, since the strip is locale-independent while the trailing-`로`
  // entry beside it is not.
  it('a plain $50 at an open card is a USD amount edit (ko)', () => {
    expect(classify('$50', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '50',
      currency: 'USD',
    })
  })

  it('a plain $50 at an open card is a USD amount edit (en)', () => {
    expect(classify('$50', EN_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '50',
      currency: 'USD',
    })
  })

  // Pin 2: with NO card open these are unchanged — an ordinary EXPENSE_ENTRY
  // reading of the same text, junk description and all. Improving THAT is the
  // no-card ladder's business (F-T4), not this fix's.
  it.each(['50달러로', '50유로로', '$50으로', '₩5000으로'])(
    'no card open: %s classifies exactly as before',
    (input) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'EXPENSE_ENTRY',
        parsed: parse(input, KO_CTX),
      })
    },
  )
})

/**
 * FIX ROUND 1 (I2, controller ruling): a Hangul place-value compound was
 * confirmed as money by `원` alone, so `4천엔으로 바꿔줘` — idiomatic for
 * exactly this feature — resolved to `{field:null}` ("what should I change?").
 * The confirming marker is now ANY Korean currency word, because a currency
 * confirms a number regardless of WHICH currency it is. Unit-level coverage
 * (including the round-5 decoys that motivated the original rule) lives in
 * `hangul-number.test.ts`; these are the classifier-level cases.
 */
describe('Task 3 fix round 1 (I2) — a Hangul compound closed by any currency word', () => {
  it.each([
    ['4천엔으로 바꿔줘', '4000', 'JPY'],
    ['4천엔으로', '4000', 'JPY'],
    ['3만5천엔으로', '35000', 'JPY'],
    ['4천달러로', '4000', 'USD'],
    ['오만엔으로', '50000', 'JPY'],
  ])('%s at an open card -> CONFIRM_MODIFY %s %s', (input, amount, currency) => {
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount,
      currency,
    })
  })

  it('3만5천원으로 regression: 원 still resolves exactly as it did', () => {
    expect(classify('3만5천원으로', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '35000',
      currency: 'KRW',
    })
  })

  it('no card open: 4천엔 is an ordinary EXPENSE_ENTRY in JPY', () => {
    const result = classify('4천엔', KO_CTX)
    expect(result).toEqual({ intent: 'EXPENSE_ENTRY', parsed: parse('4천엔', KO_CTX) })
    expect(result).toMatchObject({ parsed: { amount: '4000', currency: 'JPY' } })
  })
})

/**
 * FIX ROUND 2 (N1, controller ruling) — a wrong-VALUE class, not a missed
 * read: a SPACED `3만 엔으로` at a ¥ card resolved to ₩30,000, repricing the
 * card in the wrong currency by ~10x with no ask.
 *
 * Two readers disagreed about the same three characters. The fragment scanner
 * (`hangul-number.ts`) is a substring walk with no morphology, so it fell back
 * to the Hangul compound's KRW default; `parse()` has the tokenizer, the josa
 * detacher and the full currency lexicon, and correctly said JPY. The loose
 * one was winning on the card path — the exact "one of these two is wrong and
 * it is the looser one" argument the `parserAgrees` value gate already makes.
 *
 * So the slot now prefers `parse()`'s currency whenever the strict parser read
 * the SAME amount and demonstrably bound a currency marker of its own
 * (`sentenceNamesCurrency`). The preference only ever overrides UPWARD: the
 * strict parser rejects an ungrammatical marker (`40000 엔로` — 로 is not a
 * valid allomorph after consonant-final 엔) and falls back to the default, and
 * a typo must not silently reprice the card in the group's own currency.
 */
describe('Task 3 fix round 2 (N1) — a spaced currency word is still that currency', () => {
  it.each([
    ['3만 엔으로', '30000', 'JPY'],
    ['3만 엔으로 바꿔줘', '30000', 'JPY'],
    ['3만 엔', '30000', 'JPY'],
    ['3만 달러로', '30000', 'USD'],
    ['3만 유로로', '30000', 'EUR'],
    ['오만 엔으로', '50000', 'JPY'],
  ])('%s at an open card -> %s %s', (input, amount, currency) => {
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount,
      currency,
    })
  })

  // Fix round 3 (d): this used to compare the slot against `parse()`'s own
  // answer, which is self-confirming — the implementation reads `parse()`, so
  // the assertion could only fail if the wiring were missing entirely, never if
  // BOTH were wrong. The expected ISO codes are written out instead, and the
  // spaced/unspaced pairing is what makes the point: the two spellings of the
  // same amount must resolve to the same currency.
  it.each([
    ['3만 엔', '4천엔으로', 'JPY'],
    ['3만 달러로', '4천달러로', 'USD'],
    ['3만 유로로', '4천유로로', 'EUR'],
  ])('%s and %s both resolve to %s', (spaced, glued, currency) => {
    for (const input of [spaced, glued]) {
      expect(classify(input, KO_OPEN)).toMatchObject({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        currency,
      })
    }
  })

  // The spaced collision the fragment scanner's adjacency rule guards: 엔 is
  // one syllable and starts ordinary words. Real content survives, so this is
  // not a fragment and never reaches P2 at all.
  it('3만 엔지니어에게 줬어 stays ₩30,000 and stays an EXPENSE_ENTRY', () => {
    const input = '3만 엔지니어에게 줬어'
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'EXPENSE_ENTRY',
      parsed: parse(input, KO_CTX),
    })
    expect(parse(input, KO_CTX)).toMatchObject({
      amount: '30000',
      currency: 'KRW',
    })
  })

  // The override is one-directional. `엔로` is not grammatical (엔 is
  // consonant-final, so it takes 으로), so `parse()` refuses to bind the
  // marker and reports the group default — and a typo must not reprice a card.
  it('an UNGRAMMATICAL marker keeps the scanner’s reading, never the default', () => {
    expect(classify('40000 엔로', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '40000',
      currency: 'JPY',
    })
  })

  // A bare number still names nothing — the whole point of the optional slot.
  it.each(['4000으로', '40000'])('%s still carries no currency key', (input) => {
    expect(classify(input, KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: input === '40000' ? '40000' : '4000',
    })
  })
})

/**
 * FIX ROUND 2 (`불`): `5만불로` at an open card opened a $50,000 junk draft
 * over the card. `불` (the everyday Korean word for a dollar) cannot join
 * `CURRENCY_TOKEN`, because that table also feeds `hangul-number.ts`'s
 * `SUFFIX_RE`, which has no Hangul boundary check — `50불고기` would scan as
 * $50. So the fragment scanner is structurally blind to it while `parse()`,
 * which is tokenizer-based, is not.
 *
 * Making `불` fragment-check noise is necessary but NOT sufficient: it makes
 * the message a fragment while leaving the scanner with no amount to report,
 * and nothing downstream consumes "this is a fragment" on its own. The second
 * half is deferring to the strict parser in exactly that situation.
 */
describe('Task 3 fix round 2 (불) — the scanner is blind, the parser is not', () => {
  // Fix round 3: asserted at BOTH cards. The ¥ direction is the one that
  // matters — a wrong currency on a same-currency card is invisible, on a
  // foreign card it reprices the expense.
  it.each([
    ['5만불로', '50000'],
    ['5만불', '50000'],
    ['3만 불로 바꿔줘', '30000'],
  ])(
    '%s edits the card in USD instead of opening a junk draft, at either card',
    (input, amount) => {
      for (const ctx of [KO_OPEN, FOREIGN_CONFIRM_OPEN]) {
        expect(classify(input, ctx)).toEqual({
          intent: 'CONFIRM_MODIFY',
          field: 'amount',
          amount,
          currency: 'USD',
        })
      }
    },
  )

  // The deferral is gated on `isFragment` ALONE. T11's ruled safe-miss carries
  // a null connective and real surviving content, so it is untouched: the card
  // asks again rather than guessing.
  it('금액 3만5천에 바꿔줘 still asks rather than guessing (T11 ruling)', () => {
    expect(classify('금액 3만5천에 바꿔줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: null,
    })
  })
})

/**
 * FIX ROUND 3 — the bill for round 2's `불` strip, and the blind spot behind it.
 *
 * Making `불` fragment-check noise turned `오만 불` into a clean-looking
 * fragment. The amount scanner cannot see `불`, so it reported what it always
 * reports for a Hangul compound — ₩50,000 — and the card APPLIED that
 * confidently, where before the strip it had asked. `parse()` reads no amount
 * at all from this shape, so neither round 2's currency oracle nor its
 * scanner-blind deferral had anything to say.
 *
 * Two guards, and the second is the general one:
 *  1. A STRIP-ONLY token (`불`) in the text with no currency bound by the
 *     strict parser means nobody in this system knows the currency → ask.
 *  2. A currency key is only ever emitted when a currency token actually
 *     APPEARS in the text. Both readers hardcode KRW for a bare Hangul
 *     compound (`KOREAN_COMPOUND_IS_MONEY`), so neither can be taken at its
 *     word about whether the SENTENCE said anything — but the text can.
 */
describe('Task 3 fix round 3 — never a currency the sentence did not say', () => {
  it.each(['오만 불', '오만 불로', '오만 불이', '사만 불로'])(
    '%s asks instead of applying the scanner’s currency-blind ₩ reading',
    (input) => {
      for (const ctx of [KO_OPEN, FOREIGN_CONFIRM_OPEN]) {
        expect(classify(input, ctx)).toEqual({
          intent: 'CONFIRM_MODIFY',
          field: 'amount',
          amount: null,
        })
      }
    },
  )

  // `삼만 불` is NOT in that set, and the difference is the whole design:
  // `parse()` does read this one (30000 USD), so a currency IS bound and the
  // edit goes through in USD. The guard withholds an answer only where the
  // system genuinely has none — it is not a blanket refusal of `불`.
  it('삼만 불 applies in USD, because parse() binds a currency for that shape', () => {
    expect(parse('삼만 불', KO_CTX)).toMatchObject({
      amount: '30000',
      currency: 'USD',
    })
    for (const ctx of [KO_OPEN, FOREIGN_CONFIRM_OPEN]) {
      expect(classify('삼만 불', ctx)).toEqual({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        amount: '30000',
        currency: 'USD',
      })
    }
  })

  // Guard 2, on the card where it matters. A bare Hangul compound names no
  // currency, but BOTH readers answer KRW for one, so the slot used to carry a
  // fabricated ₩ onto a ¥ card. `삼만이` reaches the slot through the
  // scanner-blind deferral and `4만` through the ordinary branch — both are
  // covered, since the guard has to hold on both paths.
  it.each(['삼만이', '4만', '3만', '오만'])(
    '%s carries no currency key, so a ¥ card stays ¥',
    (input) => {
      expect(classify(input, FOREIGN_CONFIRM_OPEN)).toMatchObject({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
      })
      expect(classify(input, FOREIGN_CONFIRM_OPEN)).not.toHaveProperty(
        'currency',
      )
    },
  )

  // The counterpart: 원 IS in the text, so KRW is what the sentence said and
  // the ¥ card correctly takes it.
  it('4만원 still names KRW, even at a ¥ card', () => {
    expect(classify('4만원', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '40000',
      currency: 'KRW',
    })
  })
})

/**
 * FIX ROUND 4 — round 3's two guards, re-scoped to what they were guarding.
 *
 * B1: guard 2 ("a currency key only when a currency token appears in the
 * text") was built from the HANGUL scanner's token table alone, but it gates
 * currencies `parse()` bound from the ENGLISH lexicon too — "make it 50
 * dollars" at a ¥ card had its USD silently dropped and applied as ¥50.
 * dollars/bucks/quid/won were all affected; euros/yen/usd survived only
 * because `eur`/`yen`/`usd` happen to be substrings of them. The set now
 * includes `CURRENCY_WORDS_EN`'s keys. The check exists to cover the
 * KOREAN_COMPOUND_IS_MONEY blind spot, which is Hangul-only, so no English
 * word can re-admit a bare `4만`.
 *
 * B2: guard 1's 불 test was a raw `text.includes('불')`, so every everyday
 * word containing the syllable (불고기, 불닭, 숯불, 불편해서) made an amount
 * edit ask instead of applying. 불 names a dollar only as a counter after a
 * number, so the check now requires numeral adjacency (whitespace allowed).
 */
describe('Task 3 fix round 4 — English currency words survive guard 2; 불 needs a numeral', () => {
  // An en-locale group (USD default) with a ¥ card open — the context where a
  // dropped English currency reprices the edit in yen.
  const EN_FOREIGN_CONFIRM_OPEN: AssistantContext = {
    ...EN_CTX,
    openCard: {
      kind: 'confirm',
      amountMinor: 3000n,
      draft: {
        amount: '3000',
        currency: 'JPY',
        payerId: 'm1',
        participantIds: ['me', 'm1', 'm2', 'm3'],
        description: 'dinner',
        funding: 'PAY_AS_YOU_GO',
        missing: [],
        amountMentions: 1,
      },
    },
  }

  it.each([
    ['make it 50 dollars', '50', 'USD'],
    ['make it 30 bucks', '30', 'USD'],
    ['make it 50 quid', '50', 'GBP'],
    ['make it 5000 won', '5000', 'KRW'],
  ])('%s at a ¥ card carries %s %s, not a silent ¥ repricing', (input, amount, currency) => {
    expect(classify(input, EN_FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount,
      currency,
    })
  })

  // The substring-accident trio, asserted DELIBERATELY: before round 4 these
  // three passed only because `eur`/`yen`/`usd` from CURRENCY_TOKEN happen to
  // be substrings. They are now covered by design (euros via its own EN key),
  // and this pin is what notices if the accident is ever the only cover again.
  it.each([
    ['make it 50 euros', '50', 'EUR'],
    ['make it 50 yen', '50', 'JPY'],
    ['make it 50 usd', '50', 'USD'],
  ])('%s at a ¥ card -> %s %s (by design, not substring accident)', (input, amount, currency) => {
    expect(classify(input, EN_FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount,
      currency,
    })
  })

  // B1's guard rationale holds: a bare Hangul compound still emits no key at a
  // ¥ card — widening the token set with English words re-admitted nothing.
  it('bare 4만 at a ¥ card still carries no currency key', () => {
    expect(classify('4만', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '40000',
    })
  })

  // Guard 2 is CODE-matched, not any-token: the round-4 sweep caught the
  // any-token widening handing the compound blind spot back through the other
  // lexicon. Here the scanner's candidate is its currency-blind KRW and the
  // only currency token in the text is `quid` (GBP, invisible to the ko
  // parse) — GBP-in-the-text is not license to emit KRW, so no key and the ¥
  // card keeps its own currency, exactly as round 3 left it.
  it('오만 quid으로 바꿔줘 at a ¥ card does not emit the scanner’s KRW', () => {
    expect(classify('오만 quid으로 바꿔줘', FOREIGN_CONFIRM_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: '50000',
    })
  })

  // B2: everyday words containing the 불 syllable no longer trip guard 1 —
  // the amount applies (and names no currency, since none is in the text).
  it.each([
    ['불고기 40000으로 바꿔줘', '40000'],
    ['불닭 30000으로 바꿔줘', '30000'],
    ['숯불 40000으로 바꿔줘', '40000'],
    ['불편해서 40000으로 바꿔줘', '40000'],
  ])('%s applies %s instead of asking, at either card', (input, amount) => {
    for (const ctx of [KO_OPEN, FOREIGN_CONFIRM_OPEN]) {
      expect(classify(input, ctx)).toEqual({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        amount,
      })
    }
  })

  // The counter reading itself is untouched, spaced and glued: numeral-
  // adjacent 불 still asks when nobody bound a currency (오만 불) and still
  // applies USD when the strict parser did (5만불로, 삼만 불).
  it('오만 불 still asks; 5만불로 and 삼만 불 still apply in USD', () => {
    expect(classify('오만 불', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'amount',
      amount: null,
    })
    for (const [input, amount] of [
      ['5만불로', '50000'],
      ['삼만 불', '30000'],
    ] as const) {
      expect(classify(input, KO_OPEN)).toEqual({
        intent: 'CONFIRM_MODIFY',
        field: 'amount',
        amount,
        currency: 'USD',
      })
    }
  })
})

describe('round 2 — M12: card-open fallthrough suggests CONFIRM_YES/CONFIRM_NO_CANCEL, not HELP', () => {
  it('an unrecognizable message with a card open still falls back to confirm/cancel, not a HELP pointer', () => {
    expect(classify('asdkjhasdkjh', KO_OPEN)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
    })
  })
})

// ===================================================================
// §3.5-§3.11 — Task 4: queries + HELP + UNKNOWN -> GUIDED
// ===================================================================

/** Derives the expected `memberId` from a QUERY_PAIRWISE corpus row's own
 * input text (the corpus doesn't carry a memberId column — every attested
 * row names exactly one bound member, so a substring lookup against the
 * fixture's own member list reproduces it without retyping). */
function expectedMemberId(input: string, ctx: AssistantContext): string | null {
  const lower = input.toLowerCase()
  for (const m of ctx.members) {
    if (lower.includes(m.name.toLowerCase())) return m.id
  }
  return null
}

describe('§3.5 QUERY_MY_BALANCE', () => {
  const PINNED_GAPS = new Set(['나 얼마임?', '나 얼마 냄?'])
  const koRows = QUERY_CORPUS_ALL.filter(
    (r) =>
      r.intent === 'QUERY_MY_BALANCE' &&
      r.locale === 'ko' &&
      !PINNED_GAPS.has(r.input),
  )
  it.each(koRows.map((r) => [r.input, r.tier, r.view] as const))(
    'ko (%s tier %s) -> QUERY_MY_BALANCE view=%s',
    (input, _tier, view) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'QUERY_MY_BALANCE',
        view,
      })
    },
  )

  const enRows = QUERY_CORPUS_ALL.filter(
    (r) => r.intent === 'QUERY_MY_BALANCE' && r.locale === 'en',
  )
  it.each(enRows.map((r) => [r.input, r.tier, r.view] as const))(
    'en (%s tier %s) -> QUERY_MY_BALANCE view=%s',
    (input, _tier, view) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'QUERY_MY_BALANCE',
        view,
      })
    },
  )

  const koNegative: Array<[string, Classified]> = [
    ['우리 총 얼마 썼어?', { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    ['내가 낸 거 얼마야', { intent: 'QUERY_MY_SPENDING', view: 'paid' }],
    ['민수한테 얼마 줘야 돼', { intent: 'QUERY_PAIRWISE', memberId: 'm1' }],
    ['현금 얼마 남았어?', { intent: 'QUERY_WALLET', currency: null }],
    [
      '다들 정산 얼마 남았어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '누가 아직 안 냈어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['how much have we spent', { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    ['how much have I spent', { intent: 'QUERY_MY_SPENDING', view: 'paid' }],
    ['does Sam owe me', { intent: 'QUERY_PAIRWISE', memberId: 'm1' }],
    ['who owes who', { intent: 'QUERY_GROUP_TOTAL', view: 'transfers' }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })

  // KNOWN GAPS (declared, not implemented — spec-thin 확장/하 rows with no
  // safe generalizable marker; T4's brief scope is transfersFrame/whoFrame/
  // pairwiseNegatedFrame, not every 하-confidence inflection). Pinned to
  // their CURRENT actual result so a future fix flips this assertion on
  // purpose, not silently.
  // round-2 review I2: the ranked GUIDED fallback now surfaces
  // QUERY_MY_BALANCE (얼마 is still a partial amountWord hit) instead of
  // the generic HELP-only default — closer to the spec's own intent even
  // though the full AND-group still can't complete (no payFrame marker
  // for the 임 ending).
  it('ko (나 얼마임?, KNOWN GAP) -> UNKNOWN suggest QUERY_MY_BALANCE (ranked partial hit)', () => {
    expect(classify('나 얼마임?', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_MY_BALANCE'],
    })
  })

  // `냄` has no payFrame marker either, but `hasPayVerb` (chat-parse, shared
  // with resolvePayer) already recognizes it as a genuine pay-verb stem
  // (내다's casual ending) — so P5 claims this before P6's generic
  // fallback would. That is §2.3's own P5-above-P6 rule working as
  // designed, not a defect: an askAmount card asking "얼마 정도인가요?" is
  // a defensible reading of a message that both asks and states a payment
  // in the same breath, and it's one tap away from the guided alternative.
  it('ko (나 얼마 냄?, KNOWN GAP) -> EXPENSE_ENTRY (P5 pay-verb signal claims it before the generic fallback)', () => {
    expect(classify('나 얼마 냄?', KO_CTX)).toEqual({
      intent: 'EXPENSE_ENTRY',
      parsed: parse('나 얼마 냄?', KO_CTX),
    })
  })
})

describe('§3.6 QUERY_PAIRWISE', () => {
  // `민수님한테 얼마 줘야 돼요?` used to be a declared honorific gap
  // (findMembers never bound 님-suffixed names) — Goat Task 4's
  // `findPeople` closes it, so it now flows through the general
  // corpus-driven table below like any other QUERY_PAIRWISE row.
  const koRows = QUERY_CORPUS_ALL.filter(
    (r) => r.intent === 'QUERY_PAIRWISE' && r.locale === 'ko',
  )
  it.each(koRows.map((r) => [r.input, r.tier] as const))(
    'ko (%s tier %s) -> QUERY_PAIRWISE',
    (input) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'QUERY_PAIRWISE',
        memberId: expectedMemberId(input, KO_CTX),
      })
    },
  )

  const EN_PINNED_GAPS = new Set([
    'are we square',
    "we're square",
    "what's the deal with me and Sam",
  ])
  const enRows = QUERY_CORPUS_ALL.filter(
    (r) =>
      r.intent === 'QUERY_PAIRWISE' &&
      r.locale === 'en' &&
      !EN_PINNED_GAPS.has(r.input),
  )
  it.each(enRows.map((r) => [r.input, r.tier] as const))(
    'en (%s tier %s) -> QUERY_PAIRWISE',
    (input) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'QUERY_PAIRWISE',
        memberId: expectedMemberId(input, EN_CTX),
      })
    },
  )

  // KNOWN GAPS: `are we square`/`we're square` carry no bound name at all
  // (spec's own `memberId: null` slot) — reaching them would mean relaxing
  // PAIRWISE's `hits.length > 0` gate, which protects every other NEGATIVE
  // row in this table (`민박집에서 잤어` etc.); not worth it for two 확장/하
  // rows. `what's the deal with me and Sam` shares no vocabulary with
  // owe/square/settle at all. Round-2 review I2: each now gets a ranked
  // GUIDED suggestion instead of the generic HELP-only fallback — `we` is
  // GROUP_TOTAL's own groupMarker for the first two, `Sam` is a bound
  // PAIRWISE name for the third.
  it('en (are we square, KNOWN GAP) -> UNKNOWN suggest QUERY_GROUP_TOTAL (ranked partial hit)', () => {
    expect(classify('are we square', EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_GROUP_TOTAL'],
    })
  })
  it("en (we're square, KNOWN GAP) -> UNKNOWN suggest QUERY_GROUP_TOTAL (ranked partial hit)", () => {
    expect(classify("we're square", EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_GROUP_TOTAL'],
    })
  })
  it("en (what's the deal with me and Sam, KNOWN GAP) -> UNKNOWN suggest QUERY_PAIRWISE (ranked partial hit)", () => {
    expect(classify("what's the deal with me and Sam", EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_PAIRWISE'],
    })
  })

  const koNegative: Array<[string, Classified]> = [
    ['누구한테 보내면 됨?', { intent: 'QUERY_MY_BALANCE', view: 'who' }],
    ['나 얼마 내면 돼?', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    [
      '돈 빨리 안 보내는 사람 누구야',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '아직 정산 안 한 사람 누구야',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    ['민박집에서 잤어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    [
      '유나이티드 경기 봤어',
      { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['who do I pay', { intent: 'QUERY_MY_BALANCE', view: 'who' }],
    ['who owes who', { intent: 'QUERY_GROUP_TOTAL', view: 'transfers' }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })

  // ERRATUM (round-2 review M6(b), recorded in docs/DECISIONS.md
  // 2026-08-10): this is NOT a classify() gap — the spec cell itself is
  // wrong. `samsung phone charger 40` proves `sam` doesn't bind inside
  // `samsung`, but a bare 2-digit trailing number with no unit/symbol is
  // exactly the shape `extractAmount` is DESIGNED to reject (the same
  // settled-law null as `커피 2`, §3.1 NEGATIVE), and there is no
  // pay-verb/split/cash signal here either — the settled 커피-2 rule wins,
  // and P5's conjunct correctly declines it. Widening P5 to accept a bare
  // digit alone would also flip `커피 2` to EXPENSE_ENTRY, which is T3's
  // own settled law — not touched here.
  it('en (samsung phone charger 40, spec ERRATUM) -> UNKNOWN suggest HELP (no amount/pay-verb signal, same shape as the settled 커피 2 rule)', () => {
    expect(classify('samsung phone charger 40', EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
  })
})

describe('§3.7 QUERY_GROUP_TOTAL', () => {
  const koRows = QUERY_CORPUS_ALL.filter(
    (r) => r.intent === 'QUERY_GROUP_TOTAL' && r.locale === 'ko',
  )
  it.each(koRows.map((r) => [r.input, r.tier, r.view] as const))(
    'ko (%s tier %s) -> QUERY_GROUP_TOTAL view=%s',
    (input, _tier, view) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'QUERY_GROUP_TOTAL',
        view,
      })
    },
  )

  const enRows = QUERY_CORPUS_ALL.filter(
    (r) => r.intent === 'QUERY_GROUP_TOTAL' && r.locale === 'en',
  )
  it.each(enRows.map((r) => [r.input, r.tier, r.view] as const))(
    'en (%s tier %s) -> QUERY_GROUP_TOTAL view=%s',
    (input, _tier, view) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'QUERY_GROUP_TOTAL',
        view,
      })
    },
  )

  const koNegative: Array<[string, Classified]> = [
    ['내가 쓴 돈 총 얼마야', { intent: 'QUERY_MY_SPENDING', view: 'paid' }],
    ['나 얼마 내면 돼?', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    [
      '모임통장에 얼마 있어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_GROUP_TOTAL', 'QUERY_WALLET'],
      },
    ],
    [
      '이번 달 회비 총 얼마 걷혔어',
      { intent: 'UNKNOWN', hold: false, suggest: ['QUERY_GROUP_TOTAL'] },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['how much have I spent', { intent: 'QUERY_MY_SPENDING', view: 'paid' }],
    ["what's my balance", { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    [
      'did I pay for enough',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_SPENDING', 'QUERY_MY_BALANCE'],
      },
    ],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

describe('§3.8 QUERY_MY_SPENDING', () => {
  const PINNED_GAPS = new Set(['내 지출 총합 보여줘'])
  const koRows = QUERY_CORPUS_ALL.filter(
    (r) =>
      r.intent === 'QUERY_MY_SPENDING' &&
      r.locale === 'ko' &&
      !PINNED_GAPS.has(r.input),
  )
  it.each(koRows.map((r) => [r.input, r.tier, r.view] as const))(
    'ko (%s tier %s) -> QUERY_MY_SPENDING view=%s',
    (input, _tier, view) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'QUERY_MY_SPENDING',
        view,
      })
    },
  )

  // KNOWN GAP: firstPerson's list is 내가/나/제가, not bare 내, so
  // MY_SPENDING's own AND-group never fires here — but `총합` contains
  // GROUP_TOTAL's own `총` groupMarker as a substring, and `지출` is
  // already an amountWord, so it lands on QUERY_GROUP_TOTAL instead of the
  // generic HELP fallback. A defensible reading of "총합" ("grand total"),
  // even though the spec table means it personally-scoped; widening
  // firstPerson to bare `내` risks new collisions elsewhere (내가/내면/내
  // 정산/... all share the same leading syllable) for one 확장/하 row.
  it('ko (내 지출 총합 보여줘, KNOWN GAP) -> QUERY_GROUP_TOTAL (총 substring of 총합, not the spec-intended QUERY_MY_SPENDING)', () => {
    expect(classify('내 지출 총합 보여줘', KO_CTX)).toEqual({
      intent: 'QUERY_GROUP_TOTAL',
      view: 'total',
    })
  })

  const enRows = QUERY_CORPUS_ALL.filter(
    (r) => r.intent === 'QUERY_MY_SPENDING' && r.locale === 'en',
  )
  it.each(enRows.map((r) => [r.input, r.tier, r.view] as const))(
    'en (%s tier %s) -> QUERY_MY_SPENDING view=%s',
    (input, _tier, view) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'QUERY_MY_SPENDING',
        view,
      })
    },
  )

  const koNegative: Array<[string, Classified]> = [
    ['우리 총 얼마 썼어?', { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    ['나 얼마 내면 돼?', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    [
      '내가 낸 거 3만원',
      { intent: 'EXPENSE_ENTRY', parsed: parse('내가 낸 거 3만원', KO_CTX) },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ['how much have we spent', { intent: 'QUERY_GROUP_TOTAL', view: 'total' }],
    ['how much do I owe', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

describe('§3.9 QUERY_WALLET', () => {
  const PINNED_GAPS = new Set(['남은 돈 얼마 있는지 확인해줘'])
  const koRows = QUERY_CORPUS_ALL.filter(
    (r) =>
      r.intent === 'QUERY_WALLET' &&
      r.locale === 'ko' &&
      !PINNED_GAPS.has(r.input),
  )
  it.each(koRows.map((r) => [r.input, r.tier, r.currency ?? null] as const))(
    'ko (%s tier %s) -> QUERY_WALLET currency=%s',
    (input, _tier, currency) => {
      expect(classify(input, KO_CTX)).toEqual({
        intent: 'QUERY_WALLET',
        currency,
      })
    },
  )

  // round-2 review I2: 얼마 is still a partial MY_BALANCE amountWord hit
  // (돈 itself is not a walletNoun, so WALLET's own AND can't complete),
  // so the ranked fallback now points at QUERY_MY_BALANCE.
  it('ko (남은 돈 얼마 있는지 확인해줘, KNOWN GAP) -> UNKNOWN suggest QUERY_MY_BALANCE (ranked partial hit)', () => {
    expect(classify('남은 돈 얼마 있는지 확인해줘', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_MY_BALANCE'],
    })
  })

  const EN_PINNED_GAPS = new Set(["what's my wallet at"])
  const enRows = QUERY_CORPUS_ALL.filter(
    (r) =>
      r.intent === 'QUERY_WALLET' &&
      r.locale === 'en' &&
      !EN_PINNED_GAPS.has(r.input),
  )
  it.each(enRows.map((r) => [r.input, r.tier, r.currency ?? null] as const))(
    'en (%s tier %s) -> QUERY_WALLET currency=%s',
    (input, _tier, currency) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'QUERY_WALLET',
        currency,
      })
    },
  )

  // round-2 review I2: `wallet` is still a partial walletNoun hit (no
  // walletRemaining marker — 'at' is too generic to add safely), so the
  // ranked fallback now points at QUERY_WALLET.
  it("en (what's my wallet at, KNOWN GAP) -> UNKNOWN suggest QUERY_WALLET (ranked partial hit)", () => {
    expect(classify("what's my wallet at", EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_WALLET'],
    })
  })

  const koNegative: Array<[string, Classified]> = [
    [
      '클럽 갈 때 현금 얼마 들고가야 됨',
      { intent: 'UNKNOWN', hold: false, suggest: ['QUERY_WALLET'] },
    ],
    [
      '잔돈 말고 지폐로 얼마 남았어',
      { intent: 'UNKNOWN', hold: false, suggest: ['QUERY_WALLET'] },
    ],
    [
      '다 모으면 얼마인지 계산해봐야겠어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_WALLET', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '현금 3만원 내가 냈어',
      {
        intent: 'EXPENSE_ENTRY',
        parsed: parse('현금 3만원 내가 냈어', KO_CTX),
      },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    ["what's my balance", { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
    ['my balance', { intent: 'QUERY_MY_BALANCE', view: 'amount' }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

describe('§3.10 HELP', () => {
  const koRows = HELP_CORPUS.filter((r) => r.locale === 'ko')
  it.each(koRows.map((r) => [r.input, r.tier] as const))(
    'ko (%s tier %s) -> HELP',
    (input) => {
      expect(classify(input, KO_CTX)).toEqual({ intent: 'HELP' })
    },
  )

  const enRows = HELP_CORPUS.filter((r) => r.locale === 'en')
  it.each(enRows.map((r) => [r.input, r.tier] as const))(
    'en (%s tier %s) -> HELP',
    (input) => {
      expect(classify(input, EN_CTX)).toEqual({ intent: 'HELP' })
    },
  )

  const koNegative: Array<[string, Classified]> = [
    [
      '?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '??',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '정산 어떻게 진행되고 있어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '정산 언제 끝나',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '계산기 어디 있어?',
      { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] },
    ],
  ]
  it.each(koNegative)('ko NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enNegative: Array<[string, Classified]> = [
    [
      '?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    ['who owes who', { intent: 'QUERY_GROUP_TOTAL', view: 'transfers' }],
  ]
  it.each(enNegative)('en NEGATIVE: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

describe('§3.11 UNKNOWN -> GUIDED', () => {
  const koRows: Array<[string, Classified]> = [
    ['글쎄', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['음', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['흠', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['몰라', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['아마', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['아마도', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['나중에', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['이따', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['잠깐', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['잠깐만', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['ㅋㅋ', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['ㅎㅎ', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['ㅠㅠ', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    [
      '?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '??',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    ['엥', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['헐', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ['뭐래', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    [
      '누가 아직 안 냈어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '아직 정산 안 한 사람 누구야',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '정산 안 낸 사람 있어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '정산 어떻게 진행되고 있어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '다들 정산 완료했어?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '정산 다 됐나',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '계산기 어디 있어?',
      { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] },
    ],
    ['카드값 땡겼어', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
  ]
  it.each(koRows)('ko: %s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  const enRows: Array<[string, Classified]> = [
    ['wait', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['hold on', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['hold up', { intent: 'UNKNOWN', hold: true, suggest: [] }],
    ['not sure', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    ["I'm not sure", { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
    [
      '?',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      'did I pay for enough',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_SPENDING', 'QUERY_MY_BALANCE'],
      },
    ],
    [
      "we'll figure it out later",
      { intent: 'UNKNOWN', hold: true, suggest: [] },
    ],
    ['👍', { intent: 'UNKNOWN', hold: false, suggest: ['HELP'] }],
  ]
  it.each(enRows)('en: %s -> %o', (input, expected) => {
    expect(classify(input, EN_CTX)).toEqual(expected)
  })
})

// ===================================================================
// Round 2 fix round — reviewer I1-I4
// ===================================================================

describe('round 2 — I1: remaining §2.6 D-7 subject+정산남았 decoys', () => {
  const rows: Array<[string, Classified]> = [
    [
      '모두 정산 얼마 남았어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '우리 정산 얼마 남았어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '누가 정산 얼마 남았어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
    [
      '아직 정산 얼마 남았어',
      {
        intent: 'UNKNOWN',
        hold: false,
        suggest: ['QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      },
    ],
  ]
  it.each(rows)('%s -> %o', (input, expected) => {
    expect(classify(input, KO_CTX)).toEqual(expected)
  })

  it('subjectless "정산 얼마 남았어" still -> QUERY_MY_BALANCE (unaffected)', () => {
    expect(classify('정산 얼마 남았어', KO_CTX)).toEqual({
      intent: 'QUERY_MY_BALANCE',
      view: 'amount',
    })
  })
  it('"나 정산 얼마 남았어" still -> QUERY_MY_BALANCE (나 subject overrides D-7)', () => {
    expect(classify('나 정산 얼마 남았어', KO_CTX)).toEqual({
      intent: 'QUERY_MY_BALANCE',
      view: 'amount',
    })
  })
  it('"우리 총 얼마 썼어?" still -> QUERY_GROUP_TOTAL (우리 alone, no 정산+남았 frame, unaffected)', () => {
    expect(classify('우리 총 얼마 썼어?', KO_CTX)).toEqual({
      intent: 'QUERY_GROUP_TOTAL',
      view: 'total',
    })
  })
})

describe('round 2 — I2: §4.8 partial-hit ranking', () => {
  it('"내 지갑" -> UNKNOWN suggest QUERY_WALLET (walletNoun partial hit)', () => {
    expect(classify('내 지갑', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_WALLET'],
    })
  })
  it('"우리" -> UNKNOWN suggest QUERY_GROUP_TOTAL (groupMarker partial hit)', () => {
    expect(classify('우리', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_GROUP_TOTAL'],
    })
  })
  it('"얼마" -> UNKNOWN suggest QUERY_MY_BALANCE (amountWord partial hit, not GROUP_TOTAL)', () => {
    expect(classify('얼마', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_MY_BALANCE'],
    })
  })
  it('deterministic: repeated calls on the same input produce the same ranked list', () => {
    const a = classify('내 지갑', KO_CTX)
    const b = classify('내 지갑', KO_CTX)
    expect(a).toEqual(b)
  })
  it('every §3 tabled zero-signal row keeps its exact pinned suggest (no regression)', () => {
    expect(classify('커피 2', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
    expect(classify('ok', EN_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
    expect(classify('계산기 어디 있어?', KO_CTX)).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['HELP'],
    })
  })
})

describe('round 2 — I3: bare name+particle with no query signal must not fire PAIRWISE', () => {
  it('"민수랑 밥 먹었어" (no card) -> UNKNOWN, never the CLASSIFIED intent QUERY_PAIRWISE (I2 still ranks it as a GUIDED suggestion — a name WAS mentioned)', () => {
    const result = classify('민수랑 밥 먹었어', KO_CTX)
    expect(result.intent).not.toBe('QUERY_PAIRWISE')
    expect(result).toEqual({
      intent: 'UNKNOWN',
      hold: false,
      suggest: ['QUERY_PAIRWISE'],
    })
  })

  it('card-open "민수랑 유나만" -> CONFIRM_MODIFY participants only, not QUERY_PAIRWISE', () => {
    expect(classify('민수랑 유나만', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'participants',
      op: 'only',
      memberIds: ['me', 'm1', 'm2'],
    })
  })

  it('every §3.6 main+확장 row (ko+en) still fires QUERY_PAIRWISE unchanged', () => {
    const koRows = QUERY_CORPUS_ALL.filter(
      (r) => r.intent === 'QUERY_PAIRWISE' && r.locale === 'ko',
    )
    for (const r of koRows) {
      expect(classify(r.input, KO_CTX).intent).toBe('QUERY_PAIRWISE')
    }
    const enRows = QUERY_CORPUS_ALL.filter(
      (r) => r.intent === 'QUERY_PAIRWISE' && r.locale === 'en',
    )
    const enNameless = new Set([
      'are we square',
      "we're square",
      "what's the deal with me and Sam",
    ])
    for (const r of enRows) {
      if (enNameless.has(r.input)) continue // documented no-bound-name gaps
      expect(classify(r.input, EN_CTX).intent).toBe('QUERY_PAIRWISE')
    }
  })
})

describe('round 2 — I4: aheadFrame narrowed off 더치페이', () => {
  it('"나 더치페이로 얼마 냈어" -> QUERY_MY_SPENDING view=paid, not ahead', () => {
    expect(classify('나 더치페이로 얼마 냈어', KO_CTX)).toEqual({
      intent: 'QUERY_MY_SPENDING',
      view: 'paid',
    })
  })
  it('both attested aheadFrame rows still resolve to view=ahead', () => {
    expect(classify('내가 얼마 더 낸 거야', KO_CTX)).toEqual({
      intent: 'QUERY_MY_SPENDING',
      view: 'ahead',
    })
    expect(classify('내 몫보다 내가 더 낸 거 얼마야', KO_CTX)).toEqual({
      intent: 'QUERY_MY_SPENDING',
      view: 'ahead',
    })
  })
})

// ===================================================================
// EDIT_EXPENSE (goat branch — context commands, Task 9)
//
// APPENDED, never interleaved: every describe block above is the assistant
// spec's own corpus and stays byte-unchanged (the regression floor T9's brief
// mandates). These blocks assert only the NEW rung.
// ===================================================================

describe('EDIT_EXPENSE — the worked examples', () => {
  it('아까 그 술값에 민수도 껴줘 -> add 민수 to today’s 술값', () => {
    expect(classify('아까 그 술값에 민수도 껴줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'today', keyword: '술값' },
      action: { kind: 'addParticipant', memberId: 'm1' },
    })
  })

  it('어제 택시비 취소해줘 -> cancel yesterday’s 택시비', () => {
    expect(classify('어제 택시비 취소해줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'yesterday', keyword: '택시비' },
      action: { kind: 'cancel' },
    })
  })

  it('아까 그 술값에서 민수 빼줘 -> remove 민수', () => {
    expect(classify('아까 그 술값에서 민수 빼줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'today', keyword: '술값' },
      action: { kind: 'removeParticipant', memberId: 'm1' },
    })
  })

  it.each([
    ['remove that expense', { kind: 'cancel' }],
    ['add Sam to that', { kind: 'addParticipant', memberId: 'm1' }],
    ['make that 30 bucks', { kind: 'changeAmount', amount: '30', currency: 'USD' }],
  ])('en: %s', (input, action) => {
    expect(classify(input, EN_CTX)).toMatchObject({
      intent: 'EDIT_EXPENSE',
      action,
    })
  })

  it("en: cancel yesterday's taxi carries the window AND the keyword", () => {
    expect(classify("cancel yesterday's taxi", EN_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'yesterday', keyword: 'taxi' },
      action: { kind: 'cancel' },
    })
  })
})

describe('EDIT_EXPENSE — precedence: an open card owns every edit-shaped sentence', () => {
  // The mandated precedence property. `민수도 껴줘` is NOT one of §2.3's named
  // participant markers (MODIFY_PATTERNS has 빼줘/제외/포함, not 껴줘), so with
  // a card open it lands on P6's card-scoped confirm/cancel fallthrough rather
  // than P2 — either way the card owns it, and the point that matters is that
  // the new rung never takes it: an edit typed at an open card is about the
  // DRAFT in front of the user, not about a saved expense.
  it('민수도 껴줘 with a card open never becomes EDIT_EXPENSE', () => {
    expect(classify('민수도 껴줘', KO_OPEN).intent).not.toBe('EDIT_EXPENSE')
    // TASK 11 SANCTIONED CHANGE (fix round 1, controller ruling): the value
    // moved from UNKNOWN to a participants-add. What this test is FOR — that
    // an open card owns the sentence and P4.5 never sees it — is unchanged
    // and still asserted on the line above; what changed is that the open
    // card now ACTS on it instead of asking. 껴줘 was in the saved-expense
    // edit vocabulary but not in MODIFY_PATTERNS, so the same words edited a
    // saved expense and did nothing to the card on screen.
    expect(classify('민수도 껴줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'participants',
      op: 'add',
      memberId: 'm1',
    })
  })

  it('a §2.3-named participant marker with a card open stays CONFIRM_MODIFY', () => {
    expect(classify('민수 빼줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'participants',
      op: 'remove',
      memberId: 'm1',
    })
  })

  it('even a FULL context command stays CONFIRM_MODIFY while a card is open', () => {
    // The same sentence is EDIT_EXPENSE with no card open (asserted above) —
    // the card, not the sentence, is what decides.
    expect(classify('아까 그 술값에서 민수 빼줘', KO_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'participants',
      op: 'remove',
      memberId: 'm1',
    })
  })

  it('en: remove that expense with a card open stays on the card', () => {
    expect(classify('remove Sam', EN_OPEN).intent).toBe('CONFIRM_MODIFY')
    expect(classify('remove that expense', EN_OPEN).intent).not.toBe(
      'EDIT_EXPENSE',
    )
  })
})

describe('EDIT_EXPENSE — both halves are required', () => {
  it('an action with no reference word is never an edit', () => {
    for (const input of ['민수도 껴줘', '취소해줘', '유나 빼줘']) {
      expect(classify(input, KO_CTX).intent, input).not.toBe('EDIT_EXPENSE')
    }
    for (const input of ['add Sam', 'cancel', 'remove Jo']) {
      expect(classify(input, EN_CTX).intent, input).not.toBe('EDIT_EXPENSE')
    }
  })

  it('a reference with no action is never an edit', () => {
    for (const input of ['아까 그 술값 얼마였지?', '어제 뭐 했어?', '그거 진짜 웃겨']) {
      expect(classify(input, KO_CTX).intent, input).not.toBe('EDIT_EXPENSE')
    }
    expect(classify('that was fun', EN_CTX).intent).not.toBe('EDIT_EXPENSE')
  })

  it('a REPORT that an edit happened is not a request for one', () => {
    for (const input of ['그거 취소됐어', '어제 그거 취소했어']) {
      expect(classify(input, KO_CTX).intent, input).not.toBe('EDIT_EXPENSE')
    }
  })
})

describe('EDIT_EXPENSE — placed before P5, so an edit is never booked as a new expense', () => {
  it('그거 3만원으로 바꿔줘 is a CHANGE, not a second 30,000원 expense', () => {
    expect(classify('그거 3만원으로 바꿔줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'recent', keyword: null },
      action: { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
    })
  })

  it('an ordinary expense sentence that merely mentions a day is still EXPENSE_ENTRY', () => {
    // 어제 is a reference word, but nothing here ASKS for an edit — the rung
    // requires both halves, which is exactly what keeps entry working.
    expect(classify('어제 술값 3만원 내가 냈어', KO_CTX)).toMatchObject({
      intent: 'EXPENSE_ENTRY',
    })
    expect(classify('어제 이자카야 5만원 결제했어', KO_CTX)).toMatchObject({
      intent: 'EXPENSE_ENTRY',
    })
  })
})

describe('EDIT_EXPENSE — review fix round 1', () => {
  it('a changed amount carries the currency the SENTENCE named, not the group default', () => {
    expect(classify('그거 30달러로 바꿔줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'recent', keyword: null },
      action: { kind: 'changeAmount', amount: '30', currency: 'USD' },
    })
  })

  it('an amount NO action consumed hands the sentence back to P5', () => {
    // 추가해줘 binds a participant and leaves 3만원 unused — the amount is the
    // evidence that a NEW expense is being described, so this is entry, not an
    // edit (controller ruling, review fix round 1).
    const result = classify('어제 점심 3만원 민수도 추가해줘', KO_CTX)
    expect(result.intent).toBe('EXPENSE_ENTRY')
    expect(result).toMatchObject({ parsed: { amount: '30000' } })
  })

  it('the same sentence WITHOUT an amount stays an edit', () => {
    expect(classify('어제 점심 민수도 추가해줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'yesterday', keyword: '점심' },
      action: { kind: 'addParticipant', memberId: 'm1' },
    })
  })

  it('a cancel with an unused amount also defers to P5', () => {
    expect(classify('어제 택시 8500원 취소해줘', KO_CTX).intent).toBe(
      'EXPENSE_ENTRY',
    )
  })

  it('changeAmount CONSUMES its amount, so it never defers', () => {
    expect(classify('그거 3만원으로 바꿔줘', KO_CTX).intent).toBe('EDIT_EXPENSE')
  })

  it.each(['set that to 40 dollars', 'update that to 40 dollars'])(
    '%s -> changeAmount with no keyword (the `to` frame is not a category)',
    (input) => {
      expect(classify(input, EN_CTX)).toEqual({
        intent: 'EDIT_EXPENSE',
        reference: { window: 'recent', keyword: null },
        action: { kind: 'changeAmount', amount: '40', currency: 'USD' },
      })
    },
  )

  it('a name between the reference and its noun does not become the keyword', () => {
    expect(classify('아까 민수 술값에 유나도 껴줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'today', keyword: '술값' },
      action: { kind: 'addParticipant', memberId: 'm2' },
    })
  })
})

describe('EDIT_EXPENSE — T10 mandate C: a written amount is not the keyword', () => {
  it('그거 삼만원으로 바꿔줘 -> changeAmount with NO keyword', () => {
    // Before the fix the keyword was 삼만원, which matches no note and forced
    // `resolveReference` to a 'none' — the UI asked "is it one of these?" for
    // a sentence the plain `recent` window resolves outright.
    expect(classify('그거 삼만원으로 바꿔줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'recent', keyword: null },
      action: { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
    })
  })

  it('a digit-written amount was already safe and stays so', () => {
    expect(classify('그거 30000원으로 바꿔줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'recent', keyword: null },
      action: { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
    })
  })

  it('a real keyword still survives an amount later in the sentence', () => {
    expect(classify('어제 택시비 삼만원으로 바꿔줘', KO_CTX)).toEqual({
      intent: 'EDIT_EXPENSE',
      reference: { window: 'yesterday', keyword: '택시비' },
      action: { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
    })
  })
})

// ===========================================================================
// Items card follow-ups (2026-08-14 live-app fix round) — the 'items'
// OpenCard variant and its one modify slot, a per-line price.
// ===========================================================================

describe("items card open — a typed price binds to a line instead of destroying the card", () => {
  const ITEMS_OPEN: AssistantContext = {
    ...KO_CTX,
    defaultCurrency: 'JPY',
    openCard: {
      kind: 'items',
      lines: [
        { key: 0, name: '콜라', unpriced: true },
        { key: 1, name: '우동', unpriced: false },
        { key: 2, name: '우유롤', unpriced: true },
      ],
    },
  }

  it('a named line with an amount → CONFIRM_MODIFY itemPrice on that line', () => {
    expect(classify('콜라는 500엔', ITEMS_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemPrice',
      key: 0,
      amount: '500',
      currency: 'JPY',
    })
  })

  it('a named line with a bare number carries no currency slot', () => {
    expect(classify('우동 900', ITEMS_OPEN)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemPrice',
      key: 1,
      amount: '900',
    })
  })

  it('a bare amount binds to the SINGLE unpriced line, and never when two are unpriced', () => {
    const oneUnpriced: AssistantContext = {
      ...ITEMS_OPEN,
      openCard: {
        kind: 'items',
        lines: [
          { key: 0, name: '콜라', unpriced: true },
          { key: 1, name: '우동', unpriced: false },
        ],
      },
    }
    expect(classify('500엔', oneUnpriced)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemPrice',
      key: 0,
      amount: '500',
      currency: 'JPY',
    })
    // Two unpriced lines: a bare number is ambiguous — never guessed.
    const bare = classify('500엔', ITEMS_OPEN)
    expect(bare.intent).not.toBe('CONFIRM_MODIFY')
  })

  it('a line name with NO amount is not claimed as a price edit', () => {
    const got = classify('콜라는 비쌌지', ITEMS_OPEN)
    expect(got.intent).not.toBe('CONFIRM_MODIFY')
  })

  it('confirm/cancel tokens still work with the items card open', () => {
    expect(classify('응', ITEMS_OPEN).intent).toBe('CONFIRM_YES')
    expect(classify('취소', ITEMS_OPEN).intent).toBe('CONFIRM_NO_CANCEL')
  })

  it('the draft modify family stays unavailable against an items card', () => {
    // "민수가 냈어" is a payer modify against a confirm card; against the
    // items card (no draft) it must not become CONFIRM_MODIFY.
    expect(classify('민수가 냈어', ITEMS_OPEN).intent).not.toBe('CONFIRM_MODIFY')
  })
})

// ===========================================================================
// Social acts + topic-engaged UNKNOWN (2026-08-14 owner screenshots:
// "안녕" and "정산할래" both fell to the confused-ack menu).
// ===========================================================================

describe('SMALL_TALK — social acts answered in kind', () => {
  it.each(['안녕', '안녕하세요', '하이', 'ㅎㅇ'])('greets back: %s', (text) => {
    expect(classify(text, KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'greeting' })
  })

  it.each(['고마워', '감사합니다', 'ㄱㅅ'])('accepts thanks: %s', (text) => {
    expect(classify(text, KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'thanks' })
  })

  it('farewell', () => {
    expect(classify('잘가', KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'farewell' })
  })

  it('a greeting INSIDE a task sentence never swallows the task', () => {
    const got = classify('안녕 커피 5000원 샀어', KO_CTX)
    expect(got.intent).toBe('EXPENSE_ENTRY')
  })

  it('with a card open, confirm/cancel vocabulary keeps priority (no small talk)', () => {
    expect(classify('안녕', KO_OPEN).intent).not.toBe('SMALL_TALK')
  })

  it('english greetings work in the en locale', () => {
    expect(classify('hello', EN_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'greeting' })
  })
})

describe("UNKNOWN topic — '정산할래' engages the topic instead of the confused ack", () => {
  it('carries topic settle on the UNKNOWN result', () => {
    const got = classify('정산할래', KO_CTX)
    expect(got.intent).toBe('UNKNOWN')
    if (got.intent === 'UNKNOWN') {
      expect(got.topic).toBe('settle')
    }
  })

  it('an ordinary unknown sentence carries no topic', () => {
    const got = classify('오늘 날씨 좋다', KO_CTX)
    expect(got.intent).toBe('UNKNOWN')
    if (got.intent === 'UNKNOWN') {
      expect(got.topic).toBeUndefined()
    }
  })
})

// ===========================================================================
// QUERY_HISTORY — the recent-expense list (2026-08-14 owner screenshots:
// 사용내역 / 내 사용내역 좀 보여줘 / 내 기록 all fell to the confused menu).
// ===========================================================================

describe('QUERY_HISTORY — "show me the record" answers with the list', () => {
  it.each([
    ['사용내역', 'group'],
    ['지출 내역 보여줘', 'group'], // migrated from QUERY_CORPUS's GROUP_TOTAL compromise row
    ['내 사용내역 좀 보여줘', 'mine'],
    ['내 기록', 'mine'],
    ['우리 기록 보여줘', 'group'],
    ['히스토리 보여줘', 'group'],
  ] as const)('%s -> QUERY_HISTORY scope=%s', (input, scope) => {
    expect(classify(input, KO_CTX)).toEqual({
      intent: 'QUERY_HISTORY',
      scope,
      filters: {},
    })
  })

  it('english: show me the history / transactions', () => {
    expect(classify('show me the history', EN_CTX)).toEqual({
      intent: 'QUERY_HISTORY',
      scope: 'group',
      filters: {},
    })
    expect(classify('show my transactions', EN_CTX)).toEqual({
      intent: 'QUERY_HISTORY',
      scope: 'mine',
      filters: {},
    })
  })

  it('기록 as the VERB (기록해줘) never fires history', () => {
    // With an amount it is an expense entry…
    expect(classify('커피 5000원 기록해줘', KO_CTX).intent).toBe('EXPENSE_ENTRY')
    // …and even without one, 기록하/기록해 is the verb, not the noun.
    expect(classify('기록해놨지?', KO_CTX).intent).not.toBe('QUERY_HISTORY')
  })

  it('a sentence asking for a NUMBER stays with the amount ladder', () => {
    expect(classify('우리 내역 총 얼마야', KO_CTX)).toEqual({
      intent: 'QUERY_GROUP_TOTAL',
      view: 'total',
    })
  })

  it('a full sentence merely containing 기록 does not fire (residue guard)', () => {
    expect(classify('여행 기록 남기고 싶다', KO_CTX).intent).not.toBe('QUERY_HISTORY')
  })
})

// ===========================================================================
// ACTION_CREATE_WALLET — "지갑 만들래" creates from chat (2026-08-14 owner
// screenshot: it fell to the confused menu; prime directive: everything
// doable in the app must be doable in chat).
// ===========================================================================

describe('ACTION_CREATE_WALLET', () => {
  it.each([
    ['지갑 만들래', null, null],
    ['지갑 만들어줘', null, null],
    ['새 지갑 추가', null, null],
    ['엔화 지갑 만들어줘', 'JPY', null],
    ['현금 지갑 개설해줘', null, 'CASH'],
    ['엔화 현금 지갑 만들자', 'JPY', 'CASH'],
    ['달러 지갑 하나 파줘', 'USD', null],
  ] as const)('%s -> currency=%s type=%s', (input, currency, walletType) => {
    expect(classify(input, KO_CTX)).toEqual({
      intent: 'ACTION_CREATE_WALLET',
      currency,
      walletType,
    })
  })

  it('english: create a yen wallet', () => {
    expect(classify('create a yen wallet', EN_CTX)).toEqual({
      intent: 'ACTION_CREATE_WALLET',
      currency: 'JPY',
      walletType: null,
    })
  })

  it('a wallet QUERY stays a query (no creation verb)', () => {
    expect(classify('지갑에 현금 얼마 남았어?', KO_CTX).intent).toBe('QUERY_WALLET')
  })

  it('an expense sentence mentioning a wallet never becomes a create action', () => {
    // 만들다 absent; and even with an amount the action needs the verb.
    expect(classify('지갑에서 3000엔 썼어', KO_CTX).intent).toBe('EXPENSE_ENTRY')
  })
})

// ===========================================================================
// QUERY_HISTORY filters — R2a (docs/PROMPT.md 2026-08-15): '수탉과 먹은
// 지출 다 보여줘' and every human-shaped variant of it. RED-FIRST corpus
// per the variation ruling: these rows were written before the filter
// recognizer existed.
// ===========================================================================

describe('QUERY_HISTORY filters — companion/payer/keyword/window, human-varied', () => {
  const sutakCtx: AssistantContext = {
    ...KO_CTX,
    members: [
      { id: 'me', name: '빅헤드' },
      { id: 'm1', name: '수탉' },
      { id: 'm2', name: '유나' },
    ],
    actorId: 'me',
  }
  const q = (input: string) => classify(input, sutakCtx)

  // --- companion filter: shared WITH 수탉 --------------------------------
  it.each([
    '수탉과 먹은 지출을 다 보여줘봐',
    '수탉이랑 쓴 거 싹 다',
    '수탉 낀 거 뭐 있지',
    '수탉이랑 같이 먹은 것들 좀 정리해봐',
    '뭐 샀더라 수탉이랑',
    '수탉이랑 먹은거 다 보야줘',
    '수탉이랑 나눈 지출 목록',
    '수탉하고 같이 쓴 돈 보여줘',
    '수탉이랑 뭐뭐 먹었지',
    '아 그 수탉이랑 간 것들 보여줘봐',
    '수탉이랑 쓴 내역',
    '수탉 관련 지출 전부',
    '수탉이랑 먹은 거는 얼마짜리들이야 목록으로 줘',
  ])('companion: %s', (input) => {
    const got = q(input)
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.companionId).toBe('m1')
      expect(got.filters.payerId).toBeUndefined()
    }
  })

  // --- payer filter: 수탉 PAID -------------------------------------------
  it.each([
    '수탉이 낸 거 보여줘',
    '수탉이 결제한 거 다 뭐야',
    '수탉이 산 거 목록 좀',
    '수탉이 냈던 지출들 보여줘',
  ])('payer: %s', (input) => {
    const got = q(input)
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.payerId).toBe('m1')
      expect(got.filters.companionId).toBeUndefined()
    }
  })

  // --- keyword filter -----------------------------------------------------
  it.each([
    ['커피 산 거 다 보여줘', '커피'],
    ['커피 지출만 모아줘', '커피'],
    ['택시 쓴 거 뭐 있지', '택시'],
  ] as const)('keyword: %s -> %s', (input, keyword) => {
    const got = q(input)
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.keyword).toBe(keyword)
    }
  })

  // --- time window --------------------------------------------------------
  it.each([
    ['어제 쓴 거 보여줘', 'yesterday'],
    ['오늘 지출 뭐 있어', 'today'],
    ['어제 뭐 샀지', 'yesterday'],
  ] as const)('window: %s -> %s', (input, window) => {
    const got = q(input)
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.window).toBe(window)
    }
  })

  // --- combinations -------------------------------------------------------
  it('어제 수탉이랑 쓴 거 보여줘 -> window + companion', () => {
    const got = q('어제 수탉이랑 쓴 거 보여줘')
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.window).toBe('yesterday')
      expect(got.filters.companionId).toBe('m1')
    }
  })
  it('수탉이랑 마신 커피 다 보여줘 -> companion + keyword', () => {
    const got = q('수탉이랑 마신 커피 다 보여줘')
    expect(got.intent).toBe('QUERY_HISTORY')
    if (got.intent === 'QUERY_HISTORY') {
      expect(got.filters.companionId).toBe('m1')
      expect(got.filters.keyword).toBe('커피')
    }
  })

  // --- negatives: neighbors must keep their ground ------------------------
  it('an expense with an amount stays an entry', () => {
    expect(q('수탉이랑 먹었어 3만원').intent).toBe('EXPENSE_ENTRY')
  })
  it('a pairwise money question stays pairwise', () => {
    expect(q('수탉한테 얼마 줘야 돼').intent).toBe('QUERY_PAIRWISE')
  })
  it('a plan to eat is neither a query nor an entry', () => {
    expect(q('수탉이랑 뭐 먹을까').intent).not.toBe('QUERY_HISTORY')
  })
})

// ===========================================================================
// R4: typed assignment while the ITEMS card is open — "우동은 내가 먹었어"
// (owner screenshot-2 flow, the conversational half the card checkboxes
// covered until now). Red-first per the variation ruling.
// ===========================================================================

describe('items card open — typed per-line assignment', () => {
  const ASSIGN_CTX: AssistantContext = {
    ...KO_CTX,
    members: [
      { id: 'me', name: '빅헤드' },
      { id: 'm1', name: '수탉' },
      { id: 'm2', name: '유나' },
    ],
    actorId: 'me',
    defaultCurrency: 'JPY',
    openCard: {
      kind: 'items',
      lines: [
        { key: 0, name: '콜라', unpriced: false },
        { key: 1, name: '우동', unpriced: false },
        { key: 2, name: '우유롤', unpriced: false },
      ],
    },
  }
  const q = (input: string) => classify(input, ASSIGN_CTX)

  it.each([
    ['우동은 내가 먹었어', 1, ['me']],
    ['우동 내가 먹은거야', 1, ['me']],
    ['콜라는 수탉이 마셨어', 0, ['m1']],
    ['콜라 수탉꺼', 0, ['m1']],
    ['콜라는 수탉이 마시고 우동은 내가', 0, ['m1']],
    ['우동은 나랑 수탉이 나눠 먹었어', 1, ['me', 'm1']],
  ] as const)('%s -> assign key=%s members=%s', (input, key, memberIds) => {
    const got = q(input)
    expect(got).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemAssign',
      key,
      memberIds: [...memberIds],
      shareAll: false,
    })
  })

  it.each([
    ['우유롤은 하나씩 나눠먹자', 2],
    ['우유롤은 같이 먹었어', 2],
  ] as const)('share-out: %s -> key=%s shareAll', (input, key) => {
    expect(q(input)).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemAssign',
      key,
      memberIds: [],
      shareAll: true,
    })
  })

  it('a price answer still wins when an amount is present', () => {
    expect(q('콜라는 500엔')).toEqual({
      intent: 'CONFIRM_MODIFY',
      field: 'itemPrice',
      key: 0,
      amount: '500',
      currency: 'JPY',
    })
  })

  it('an item name with neither amount nor person falls through (never a guess)', () => {
    expect(q('콜라는 비쌌지').intent).not.toBe('CONFIRM_MODIFY')
  })
})

// ===========================================================================
// R4: QUERY_EXPLAIN — "왜 내가 만원이야?" answers with the per-expense
// breakdown of MY share. Red-first, human-varied.
// ===========================================================================

describe('QUERY_EXPLAIN — settlement explanations', () => {
  it.each([
    '왜 내가 만원이야',
    '내가 왜 이만큼 내',
    '왜 이렇게 나왔어',
    '내 몫이 왜 이래',
    '어떻게 계산된 거야',
    '계산 근거 좀',
    '이 금액 어떻게 나온 거야',
    '왜 내가 제일 많이 내',
  ])('%s -> QUERY_EXPLAIN', (input) => {
    expect(classify(input, KO_CTX)).toEqual({ intent: 'QUERY_EXPLAIN' })
  })

  it('english: why do I owe this much', () => {
    expect(classify('why do I owe this much', EN_CTX)).toEqual({
      intent: 'QUERY_EXPLAIN',
    })
  })

  it('a plain expense with 왜-less money stays an entry', () => {
    expect(classify('점심 만원 냈어', KO_CTX).intent).toBe('EXPENSE_ENTRY')
  })

  it('왜 without any money/settlement context stays unknown', () => {
    expect(classify('왜 안 와?', KO_CTX).intent).toBe('UNKNOWN')
  })

  it('a balance question without 왜 keeps its own intent', () => {
    expect(classify('나 얼마 내면 돼?', KO_CTX).intent).toBe('QUERY_MY_BALANCE')
  })
})

// ===========================================================================
// 2026-08-16 owner screenshot: '안녕안녕' fell to the confused menu — social
// acts must survive repetition, emphasis, and interjections. Red-first.
// ===========================================================================

describe('SMALL_TALK — human-varied greetings survive repetition and decoration', () => {
  it.each([
    '안녕안녕',
    '안녕~',
    '안녕!!',
    '안녕하세요~~',
    '안녕하세욥',
    '안뇽안뇽',
    '하이하이',
    '하이~',
    '헬로우',
    '셈아 안녕!',
    '야 안녕',
    '아 안녕',
    '안녕 셈아',
    'ㅎㅇㅎㅇ',
    'ㅎ2',
    'hi hi',
    'hey there',
    'hello!!',
  ])('greeting: %s', (input) => {
    expect(classify(input, KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'greeting' })
  })

  it.each(['고마워고마워', '고맙다', '고마워요~', '감사감사', 'ㄳㄳ', '땡큐~', '고마웡'])(
    'thanks: %s',
    (input) => {
      expect(classify(input, KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'thanks' })
    },
  )

  it.each(['잘가~', '바이바이', '수고수고', '수고했어~', '잘자~'])('farewell: %s', (input) => {
    expect(classify(input, KO_CTX)).toEqual({ intent: 'SMALL_TALK', act: 'farewell' })
  })

  it('a greeting fused to a real task still yields the task', () => {
    expect(classify('안녕 커피 5000원 샀어', KO_CTX).intent).toBe('EXPENSE_ENTRY')
    expect(classify('하이 나 얼마 내면 돼', KO_CTX).intent).toBe('QUERY_MY_BALANCE')
  })

  it('a word that merely CONTAINS a greeting stem is not a greeting', () => {
    // 안녕히 계세요 is a farewell — fine either way — but 하이라이트/하이볼
    // are not greetings.
    expect(classify('하이볼 8000원', KO_CTX).intent).toBe('EXPENSE_ENTRY')
    expect(classify('하이라이트 보여줘', KO_CTX).intent).not.toBe('SMALL_TALK')
  })
})
