import { describe, expect, it } from 'vitest'
import type { RecentExpenseLite } from '@/lib/assistant/context-commands'
import type { ChatMember } from '@/lib/chat-parse'
import {
  editAskOf,
  editBlockedKey,
  editDoneKey,
  halfSplitReply,
  isCurrencySwap,
  previewPerPerson,
  resolveChatOutcome,
  resolveEditCard,
  resolveHalfSplitParticipants,
  resolveModifyCurrency,
  savedExpenseNote,
} from './chat-composer-logic'

const CTX = {
  members: [
    { id: 'm-sota', name: '소타' },
    { id: 'm-minsu', name: '민수' },
  ] as ChatMember[],
  actorId: 'm-sota',
  defaultCurrency: 'KRW',
}

describe('resolveChatOutcome', () => {
  it('asks when the parse carried no amount', () => {
    expect(
      resolveChatOutcome(
        { amount: null, currency: 'KRW', amountMentions: 0 },
        '',
        CTX,
      ),
    ).toEqual({ kind: 'askAmount' })
  })

  it('asks when the amount is syntactically plausible but unusable', () => {
    // parseAmountToMinor rejects this even though the parser's regex accepted it.
    expect(
      resolveChatOutcome(
        { amount: '1e+21', currency: 'KRW', amountMentions: 1 },
        '1e+21',
        CTX,
      ),
    ).toEqual({ kind: 'askAmount' })
  })

  // A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차"): a foreign currency
  // used to hand off to the full form as its own `crossCurrency` outcome —
  // that dead end is gone. A foreign-currency parse with a valid amount now
  // confirms exactly like a same-currency one, carrying its OWN currency
  // (ChatComposer shows a funding-source section on the card when this
  // differs from the group's settlement currency; resolveChatOutcome itself
  // has no notion of "settlement currency" to compare against).
  it('confirms on a foreign currency too, carrying that currency through', () => {
    expect(
      resolveChatOutcome(
        { amount: '2400', currency: 'JPY', amountMentions: 1 },
        '2400엔',
        CTX,
      ),
    ).toEqual({ kind: 'confirm', amount: '2400', amountMinor: 2400n })
  })

  it('confirms with the parsed amount and its minor-unit value otherwise', () => {
    expect(
      resolveChatOutcome(
        { amount: '12000', currency: 'KRW', amountMentions: 1 },
        '12000원',
        CTX,
      ),
    ).toEqual({ kind: 'confirm', amount: '12000', amountMinor: 12000n })
  })

  it('respects currency-specific minor-unit digits (JPY has none)', () => {
    expect(
      resolveChatOutcome(
        { amount: '2400', currency: 'JPY', amountMentions: 1 },
        '2400엔',
        CTX,
      ),
    ).toEqual({ kind: 'confirm', amount: '2400', amountMinor: 2400n })
  })

  // Task 3 (docs/handoff/B-multi-item-chat.md): `multiAmount` is no longer
  // the ONLY thing an `amountMentions >= 2` sentence can resolve to — a
  // sentence `parseItems` can actually parse now returns `confirmItems`
  // instead, carrying its exact item array. This is the "structured
  // sentence" case the owner called `multiAmount` too defensive about.
  it('routes a clean multi-item sentence to confirmItems, carrying the parsed items', () => {
    const input = '13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개'
    expect(
      resolveChatOutcome(
        { amount: '13000', currency: 'KRW', amountMentions: 3 },
        input,
        CTX,
      ),
    ).toEqual({
      kind: 'confirmItems',
      items: {
        currency: 'KRW',
        items: [
          { name: '김치찌개', unitAmount: '13000', quantity: 3, assigneeIds: [], shareAll: false },
          { name: '콜라', unitAmount: '7000', quantity: 2, assigneeIds: [], shareAll: false },
          { name: '와규', unitAmount: '400000', quantity: 2, assigneeIds: [], shareAll: false },
        ],
      },
    })
  })

  // A2 review guard (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차" follow-
  // up), narrowed by Task 3: `multiAmount` is now the FALLBACK for a
  // sentence `parseItems` itself refuses to guess at (mixed currencies here)
  // — never a `confirm` outcome for the lone FIRST amount `parse()` happens
  // to report. `amountMentions` (`parse()`'s own field, chat-parse/index.ts)
  // is what tells `resolveChatOutcome` there were more — this check runs
  // BEFORE the ordinary amount-validity checks above, so it wins even when
  // the first amount is itself perfectly valid.
  it('falls back to multiAmount when parseItems refuses a mixed-currency sentence', () => {
    const input = '$5 콜라 3개랑 700엔 피자 1개'
    expect(
      resolveChatOutcome(
        { amount: '5', currency: 'USD', amountMentions: 2 },
        input,
        CTX,
      ),
    ).toEqual({ kind: 'multiAmount' })
  })

  it('a single amount mention is unaffected — normal confirm, unchanged', () => {
    expect(
      resolveChatOutcome(
        { amount: '13000', currency: 'KRW', amountMentions: 1 },
        '택시 13000원',
        CTX,
      ),
    ).toEqual({ kind: 'confirm', amount: '13000', amountMinor: 13000n })
  })
})

describe('resolveModifyCurrency', () => {
  it('takes the currency the reply named, over the card’s own', () => {
    expect(resolveModifyCurrency('KRW', 'JPY')).toEqual({
      currency: 'JPY',
      fundingReset: true,
    })
  })

  it('keeps the card’s currency when the reply named none (a bare number)', () => {
    expect(resolveModifyCurrency('JPY', undefined)).toEqual({
      currency: 'JPY',
      fundingReset: false,
    })
  })

  it('does not reset funding when the reply names the currency already showing', () => {
    expect(resolveModifyCurrency('JPY', 'JPY')).toEqual({
      currency: 'JPY',
      fundingReset: false,
    })
  })
})

describe('previewPerPerson', () => {
  it('splits evenly, truncating any remainder', () => {
    expect(previewPerPerson(10000n, 3)).toBe(3333n)
    expect(previewPerPerson(9000n, 3)).toBe(3000n)
  })

  it('returns zero for a non-positive participant count rather than dividing by it', () => {
    expect(previewPerPerson(10000n, 0)).toBe(0n)
  })
})

describe('resolveHalfSplitParticipants', () => {
  const THREE: ChatMember[] = [
    { id: 'me', name: 'Alice' },
    { id: 'm1', name: '민수' },
    { id: 'm2', name: '유나' },
  ]
  const TWO: ChatMember[] = [
    { id: 'me', name: 'Alice' },
    { id: 'm1', name: '민수' },
  ]

  // Review C1 (Critical, money-affecting): a bare `반반` on a group of 3+
  // used to fall back to "actor + current payer," which silently produced
  // ONE participant (100% of the amount landing on a single person) the
  // instant the payer defaulted to the actor themselves — see the doc
  // comment on the function under test.

  it('branch 1 — a named member in the sentence wins, regardless of the card payer', () => {
    expect(resolveHalfSplitParticipants('민수랑 반반', THREE, 'me')).toEqual([
      'me',
      'm1',
    ])
  })

  it('branch 1 — the named member can be anyone in the group, not just the payer', () => {
    expect(
      resolveHalfSplitParticipants('유나랑 반반이요', THREE, 'me'),
    ).toEqual(['me', 'm2'])
  })

  it('branch 2 — no name in the sentence, but the group has exactly two members', () => {
    expect(resolveHalfSplitParticipants('반반', TWO, 'me')).toEqual([
      'me',
      'm1',
    ])
  })

  it('branch 3 — no name, 3+ members: ambiguous, returns null rather than guessing', () => {
    expect(resolveHalfSplitParticipants('반반', THREE, 'me')).toBeNull()
  })

  it('never returns fewer than two participants for a group of 2+', () => {
    for (const [input, members] of [
      ['반반', THREE],
      ['민수랑 반반', THREE],
      ['반반', TWO],
    ] as const) {
      const result = resolveHalfSplitParticipants(input, members, 'me')
      if (result !== null) {
        expect(result.length).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('halfSplitReply', () => {
  const nameOf = (id: string): string =>
    ({ me: 'Alice', m1: '민수', m2: '유나' })[id] ?? id

  // Review NEW-1: branch 3's ambiguous `null` must render
  // `assistant.confirm.askWhoToRemove` ("who should I take out?" — a
  // remove-down-to-two question, the one §4.7 key that actually fits this),
  // not the generic "card still open" GUIDED fallback this used to reuse.
  it('branch 3 (ambiguous, ids === null) renders assistant.confirm.askWhoToRemove', () => {
    expect(halfSplitReply(null, 'me', nameOf)).toEqual({
      lines: [{ key: 'assistant.confirm.askWhoToRemove' }],
    })
  })

  it('a resolved pair renders assistant.confirm.updatedHalf, naming the OTHER participant', () => {
    expect(halfSplitReply(['me', 'm1'], 'me', nameOf)).toEqual({
      lines: [
        { key: 'assistant.confirm.updatedHalf', values: { name: '민수' } },
      ],
    })
  })

  it('names the other participant regardless of array order', () => {
    expect(halfSplitReply(['m2', 'me'], 'me', nameOf)).toEqual({
      lines: [
        { key: 'assistant.confirm.updatedHalf', values: { name: '유나' } },
      ],
    })
  })
})

// ===========================================================================
// Context commands (Task 10)
// ===========================================================================

const AUG_13_KST = new Date('2026-08-13T03:00:00.000Z') // 12:00 KST
/** `Date#getTimezoneOffset()` convention: minutes WEST of UTC, so KST = -540. */
const KST = -540

function expense(
  overrides: Partial<RecentExpenseLite> & Pick<RecentExpenseLite, 'id'>,
): RecentExpenseLite {
  return {
    note: '이자카야',
    amountMinor: 30000n,
    currency: 'KRW',
    timestamp: AUG_13_KST,
    participantIds: ['me'],
    payerId: 'me',
    cancelled: false,
    ...overrides,
  }
}

describe('resolveEditCard', () => {
  it('one survivor opens the confirm card directly', () => {
    const only = expense({ id: 'e1' })
    expect(
      resolveEditCard(
        { window: 'today', keyword: '술값' },
        [only, expense({ id: 'e2', note: '택시' })],
        AUG_13_KST,
        KST,
      ),
    ).toEqual({ kind: 'confirmEdit', expense: only })
  })

  it('several survivors ask which one, marked as a real match', () => {
    const a = expense({ id: 'e1', note: '이자카야' })
    const b = expense({ id: 'e2', note: '술값 2차' })
    const outcome = resolveEditCard(
      { window: 'today', keyword: '술값' },
      [a, b],
      AUG_13_KST,
      KST,
    )
    expect(outcome.kind).toBe('disambiguate')
    expect(outcome).toMatchObject({ found: true })
    expect(
      outcome.kind === 'disambiguate'
        ? outcome.candidates.map((c) => c.id).sort()
        : [],
    ).toEqual(['e1', 'e2'])
  })

  it('no survivor falls back to the newest few, marked as NOT a match', () => {
    const outcome = resolveEditCard(
      { window: 'today', keyword: '주차비' },
      [expense({ id: 'e1' }), expense({ id: 'e2', note: '택시' })],
      AUG_13_KST,
      KST,
    )
    expect(outcome).toMatchObject({ kind: 'disambiguate', found: false })
    expect(
      outcome.kind === 'disambiguate' ? outcome.candidates.length : 0,
    ).toBe(2)
  })

  it('an empty group has nothing to offer, and still asks rather than acting', () => {
    expect(
      resolveEditCard({ window: 'recent', keyword: null }, [], AUG_13_KST, KST),
    ).toEqual({ kind: 'disambiguate', candidates: [], found: false })
  })
})

describe('editAskOf', () => {
  const nameOf = (id: string): string =>
    ({ me: 'Alice', m1: '민수', m2: '유나' })[id] ?? id

  it('binds a participant edit to the member name', () => {
    expect(
      editAskOf({ kind: 'addParticipant', memberId: 'm2' }, nameOf),
    ).toEqual({ kind: 'add', name: '유나' })
    expect(
      editAskOf({ kind: 'removeParticipant', memberId: 'm1' }, nameOf),
    ).toEqual({ kind: 'remove', name: '민수' })
  })

  it('cancel carries nothing to resolve', () => {
    expect(editAskOf({ kind: 'cancel' }, nameOf)).toEqual({ kind: 'cancel' })
  })

  it('changeAmount becomes minor units AT ITS OWN CURRENCY, never the group default', () => {
    // 30 USD is 3000 cents, not 30 — the exponent comes from the currency the
    // SENTENCE named (T9's ruling).
    expect(
      editAskOf({ kind: 'changeAmount', amount: '30', currency: 'USD' }, nameOf),
    ).toEqual({ kind: 'amount', amountMinor: 3000n, currency: 'USD' })
    expect(
      editAskOf(
        { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
        nameOf,
      ),
    ).toEqual({ kind: 'amount', amountMinor: 30000n, currency: 'KRW' })
  })

  it('an unusable amount has nothing to confirm', () => {
    expect(
      editAskOf(
        { kind: 'changeAmount', amount: '1e+21', currency: 'KRW' },
        nameOf,
      ),
    ).toBeNull()
  })

  // F-T4 (docs/PROMPT.md [2026-08-14] decision 2, saved half). The optional
  // TARGET is what tells a plain amount edit apart from a currency SWAP: the
  // ask has to name both sides (₩4,000 → ¥4,000), so it needs what the
  // expense currently is, not just what the sentence asked for.
  it('names BOTH sides when the sentence moves the expense to another currency', () => {
    expect(
      editAskOf(
        { kind: 'changeAmount', amount: '4000', currency: 'JPY' },
        nameOf,
        { amountMinor: 4000n, currency: 'KRW' },
      ),
    ).toEqual({
      kind: 'currencySwap',
      fromMinor: 4000n,
      fromCurrency: 'KRW',
      toMinor: 4000n,
      toCurrency: 'JPY',
    })
  })

  it('stays an ordinary amount edit when the currency already matches', () => {
    expect(
      editAskOf(
        { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
        nameOf,
        { amountMinor: 4000n, currency: 'KRW' },
      ),
    ).toEqual({ kind: 'amount', amountMinor: 30000n, currency: 'KRW' })
  })

  it('an unusable amount is still refused when a target is known', () => {
    expect(
      editAskOf(
        { kind: 'changeAmount', amount: '1e+21', currency: 'JPY' },
        nameOf,
        { amountMinor: 4000n, currency: 'KRW' },
      ),
    ).toBeNull()
  })
})

// F-T4. Which dispatch a confirmed `changeAmount` takes — the plain amount
// update, or the cancel + re-create swap. One predicate, read by the card copy,
// the action dispatch and the "done" line alike, so the three can never
// disagree about what just happened.
describe('isCurrencySwap', () => {
  it('is true only for an amount change that names another currency', () => {
    expect(
      isCurrencySwap({ kind: 'changeAmount', amount: '4000', currency: 'JPY' }, {
        currency: 'KRW',
      }),
    ).toBe(true)
    expect(
      isCurrencySwap({ kind: 'changeAmount', amount: '4000', currency: 'KRW' }, {
        currency: 'KRW',
      }),
    ).toBe(false)
    expect(isCurrencySwap({ kind: 'cancel' }, { currency: 'KRW' })).toBe(false)
    expect(
      isCurrencySwap({ kind: 'addParticipant', memberId: 'm1' }, {
        currency: 'KRW',
      }),
    ).toBe(false)
  })
})

describe('editBlockedKey', () => {
  /** A plain, single-amount expense — the shape every edit is allowed on. */
  const plain = (currency = 'KRW') => ({ currency, itemCount: 0 })
  /** A receipt with lines: split by its item ASSIGNMENTS, not by these fields. */
  const itemised = (currency = 'KRW') => ({ currency, itemCount: 3 })

  // SANCTIONED CHANGE (F-T4, docs/PROMPT.md [2026-08-14] decision 2): this
  // used to assert `chat.edit.currencyBlocked`. The owner replaced that dead
  // end — a currency change on a SAVED expense is now offered as one confirm
  // card that cancels the old row and re-creates it (`applyCurrencyChange`),
  // so the client-side courtesy check must NOT block it any more. The refusal
  // itself survives as the server-side guard in `applyChangeAmount`, which is
  // the only way to reach that path now.
  it('no longer blocks a change to another currency — that is the swap card', () => {
    expect(
      editBlockedKey(
        { kind: 'changeAmount', amount: '30', currency: 'USD' },
        plain('KRW'),
      ),
    ).toBeNull()
  })

  it('allows a change in the expense\u2019s own currency', () => {
    expect(
      editBlockedKey(
        { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
        plain('KRW'),
      ),
    ).toBeNull()
  })

  it('allows participant edits on a plain expense', () => {
    expect(
      editBlockedKey({ kind: 'addParticipant', memberId: 'm1' }, plain()),
    ).toBeNull()
    expect(
      editBlockedKey({ kind: 'removeParticipant', memberId: 'm1' }, plain()),
    ).toBeNull()
  })

  // Review Critical 1. An itemised expense's shares come from its item
  // assignments: adding a participant would change nobody's share while the
  // reply claimed it worked, and removing one would hide them from every
  // screen while their assigned lines still charged them.
  it('blocks every field edit on an ITEMISED expense', () => {
    expect(
      editBlockedKey({ kind: 'addParticipant', memberId: 'm1' }, itemised()),
    ).toBe('chat.edit.tooComplex')
    expect(
      editBlockedKey({ kind: 'removeParticipant', memberId: 'm1' }, itemised()),
    ).toBe('chat.edit.tooComplex')
    expect(
      editBlockedKey(
        { kind: 'changeAmount', amount: '30000', currency: 'KRW' },
        itemised(),
      ),
    ).toBe('chat.edit.tooComplex')
  })

  it('never blocks a CANCEL — it removes the whole receipt, so nothing half-applies', () => {
    expect(editBlockedKey({ kind: 'cancel' }, itemised('JPY'))).toBeNull()
    expect(editBlockedKey({ kind: 'cancel' }, plain('JPY'))).toBeNull()
  })

  // SANCTIONED CHANGE (F-T4): the currency block no longer exists, so an
  // ITEMISED target is now refused for the reason that DOES still hold — its
  // line totals are the receipt, and re-creating it from a single grand total
  // would throw them away. The swap is offered only on a plain expense.
  it('an itemised target is refused even when the sentence changes the currency', () => {
    expect(
      editBlockedKey(
        { kind: 'changeAmount', amount: '30', currency: 'USD' },
        itemised('KRW'),
      ),
    ).toBe('chat.edit.tooComplex')
  })
})

describe('savedExpenseNote', () => {
  // Review Important 2: the server derives `title` as
  // `payload.note?.trim() || itemRows[0]?.name || ''`, and the composer's
  // session override map has to land on the SAME string — an items card
  // usually carries no note, and mirroring only the note half left that
  // expense blank for the rest of the session (unmatchable by keyword, empty
  // in the disambiguation list).
  it('prefers the typed note', () => {
    expect(savedExpenseNote('\uc774\uc790\uce74\uc57c', [{ name: '\uae40\uce58\ucc0c\uac1c' }])).toBe(
      '\uc774\uc790\uce74\uc57c',
    )
  })

  it('falls back to the FIRST item name, exactly as the server does', () => {
    expect(savedExpenseNote(undefined, [{ name: '\uae40\uce58\ucc0c\uac1c' }, { name: '\ucf5c\ub77c' }])).toBe(
      '\uae40\uce58\ucc0c\uac1c',
    )
    // A whitespace-only note is not a note — same `||` chain the server uses.
    expect(savedExpenseNote('   ', [{ name: '\uae40\uce58\ucc0c\uac1c' }])).toBe('\uae40\uce58\ucc0c\uac1c')
  })

  it('is empty only when there is genuinely nothing to call it', () => {
    expect(savedExpenseNote(undefined, [])).toBe('')
    expect(savedExpenseNote('', [])).toBe('')
  })
})

describe('editDoneKey', () => {
  it('a cancellation is not an update', () => {
    expect(editDoneKey({ kind: 'cancel' })).toBe('chat.edit.doneCancelled')
    expect(editDoneKey({ kind: 'addParticipant', memberId: 'm1' })).toBe(
      'chat.edit.done',
    )
    expect(editDoneKey({ kind: 'changeAmount', amount: '1', currency: 'KRW' })).toBe(
      'chat.edit.done',
    )
  })

  // F-T4: a swap did not update anything — it cancelled one expense and made
  // another. Reporting it as "수정했어요" would misdescribe two rows at once.
  it('a currency swap reports the cancel + re-create, not an update', () => {
    expect(
      editDoneKey({ kind: 'changeAmount', amount: '4000', currency: 'JPY' }, true),
    ).toBe('chat.edit.currencySwap.done')
  })
})
