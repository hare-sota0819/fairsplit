/**
 * compose.ts tests — spec §4's worked templates, exercised with small
 * hand-built engine-output fixtures (spec §5.4's composers never fetch, so
 * every fixture here stands in for `computeNetBalances`/`simplifyDebts`/
 * `pairwiseNetFor`/`consumedShares`/`buildTotalCards`/`walletSummaries`
 * output shapes — see task-5-report.md for the exact engine calls each
 * composer's input corresponds to).
 *
 * Also carries T4's two relay items (progress.md "carried to T5"):
 *  (a) DECISIONS.md 2026-08-10 erratum — a bare `suggest:['HELP']` MAY
 *      render the §4.8 myBalance/groupTotal/help triple (`ZERO_HIT_TRIPLE`).
 *  (b) 'i paid for dinner' -> QUERY_MY_SPENDING(view:'paid') must read
 *      gracefully even though the trigger sentence was a statement, not a
 *      question — asserted directly below (no code path is statement-vs-
 *      question aware; `mySpending.paid`'s copy is a plain fact statement,
 *      so it already reads fine either way).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import type { Transfer } from '../settlement'
import type { WalletSummary } from '../wallet-view'
import {
  composeConfirm,
  composeExplain,
  composeHistory,
  composeHistoryFiltered,
  composeItemsPriceAsk,
  composeWalletCreated,
  composeWhoAmbiguous,
  composeWhoUnknown,
  composeSmallTalk,
  composeGroupTotal,
  composeGuided,
  composeHelp,
  composeMyBalance,
  composeMySpending,
  composePairwise,
  composeWallet,
  MONEY_KEYS,
} from './compose'
import type { AssistantAnswer, AssistantAnswerLine } from './types'

const DIR = dirname(fileURLToPath(import.meta.url))
const KRW = 'KRW'

const names = new Map([
  ['me', '나'],
  ['m1', '민수'],
  ['m2', '유나'],
  ['m3', '철수'],
])

function keysOf(answer: AssistantAnswer): string[] {
  return answer.lines.map((l) => l.key)
}

// ===========================================================================
// composeMyBalance — §4.1 (7 keys)
// ===========================================================================

describe('composeMyBalance', () => {
  it('empty — no expenses recorded at all', () => {
    const a = composeMyBalance({
      transfers: [],
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: false,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.balance.empty' }] })
  })

  it('even — settled pair, expenses exist but net is zero', () => {
    const a = composeMyBalance({
      transfers: [],
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: true,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.balance.even' }] })
  })

  it('view:amount, actor owes one person — line then total', () => {
    const transfers: Transfer[] = [{ from: 'me', to: 'm1', amount: 30_000n }]
    const a = composeMyBalance({
      transfers,
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.balance.owesLine',
          values: { name: '민수', amount: '30000', currency: KRW },
        },
        {
          key: 'assistant.balance.owesTotal',
          values: { amount: '30000', currency: KRW },
        },
      ],
    })
  })

  it('view:amount, actor is owed by two people — one line each then total', () => {
    const transfers: Transfer[] = [
      { from: 'm1', to: 'me', amount: 10_000n },
      { from: 'm2', to: 'me', amount: 5_000n },
    ]
    const a = composeMyBalance({
      transfers,
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.balance.receivesLine',
          values: { name: '민수', amount: '10000', currency: KRW },
        },
        {
          key: 'assistant.balance.receivesLine',
          values: { name: '유나', amount: '5000', currency: KRW },
        },
        {
          key: 'assistant.balance.receivesTotal',
          values: { amount: '15000', currency: KRW },
        },
      ],
    })
  })

  it('review I1 — view:who for a CREDITOR skips the who line (receivesLine already answers "who")', () => {
    const transfers: Transfer[] = [
      { from: 'm1', to: 'me', amount: 10_000n },
      { from: 'm2', to: 'me', amount: 5_000n },
    ]
    const a = composeMyBalance({
      transfers,
      actorId: 'me',
      names,
      currency: KRW,
      view: 'who',
      hasExpenses: true,
    })
    expect(keysOf(a)).toEqual([
      'assistant.balance.receivesLine',
      'assistant.balance.receivesLine',
      'assistant.balance.receivesTotal',
    ])
  })

  it("view:who prepends the who line before the same lines (§2.6 '누구한테 보내면 됨?')", () => {
    const transfers: Transfer[] = [{ from: 'me', to: 'm3', amount: 7_000n }]
    const a = composeMyBalance({
      transfers,
      actorId: 'me',
      names,
      currency: KRW,
      view: 'who',
      hasExpenses: true,
    })
    expect(keysOf(a)).toEqual([
      'assistant.balance.who',
      'assistant.balance.owesLine',
      'assistant.balance.owesTotal',
    ])
    expect(a.lines[0]).toEqual({
      key: 'assistant.balance.who',
      values: { names: '철수' },
    })
  })
})

// ===========================================================================
// composePairwise — §4.2 (3 keys)
// ===========================================================================

describe('composePairwise', () => {
  it('even — settled pair', () => {
    const a = composePairwise({ net: 0n, name: '민수', currency: KRW })
    expect(a).toEqual({
      lines: [{ key: 'assistant.pairwise.even', values: { name: '민수' } }],
    })
  })

  it('positive net — actor owes them (pairwiseNetFor convention)', () => {
    const a = composePairwise({ net: 12_000n, name: '민수', currency: KRW })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.pairwise.youOwe',
          values: { name: '민수', amount: '12000', currency: KRW },
        },
      ],
    })
  })

  it('negative net — they owe the actor', () => {
    const a = composePairwise({ net: -8_000n, name: '유나', currency: KRW })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.pairwise.theyOwe',
          values: { name: '유나', amount: '8000', currency: KRW },
        },
      ],
    })
  })
})

// ===========================================================================
// composeGroupTotal — §4.3 (6 keys)
// ===========================================================================

describe('composeGroupTotal', () => {
  it('empty — zero expenses', () => {
    const a = composeGroupTotal({
      total: 0n,
      count: 0,
      memberCount: 4,
      names,
      currency: KRW,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.groupTotal.empty' }] })
  })

  it('total view — sumWithCount + perPerson estimate', () => {
    const a = composeGroupTotal({
      total: 100_000n,
      count: 3,
      memberCount: 4,
      names,
      currency: KRW,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.groupTotal.sumWithCount',
          values: { count: 3, amount: '100000', currency: KRW },
        },
        {
          key: 'assistant.groupTotal.perPerson',
          values: { amount: '25000', currency: KRW },
        },
      ],
    })
  })

  it('total view skips perPerson when memberCount is 0 (defensive)', () => {
    const a = composeGroupTotal({
      total: 100_000n,
      count: 1,
      memberCount: 0,
      names,
      currency: KRW,
    })
    expect(keysOf(a)).toEqual(['assistant.groupTotal.sumWithCount'])
  })

  it("transfers view ('who owes who') — sum + title + one line per transfer", () => {
    const transfers: Transfer[] = [
      { from: 'm1', to: 'me', amount: 20_000n },
      { from: 'm2', to: 'm3', amount: 5_000n },
    ]
    const a = composeGroupTotal({
      total: 100_000n,
      count: 3,
      memberCount: 4,
      transfers,
      names,
      currency: KRW,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.groupTotal.sum',
          values: { amount: '100000', currency: KRW },
        },
        { key: 'assistant.groupTotal.transfersTitle' },
        {
          key: 'assistant.groupTotal.transferLine',
          values: { from: '민수', to: '나', amount: '20000', currency: KRW },
        },
        {
          key: 'assistant.groupTotal.transferLine',
          values: { from: '유나', to: '철수', amount: '5000', currency: KRW },
        },
      ],
    })
  })

  it('review I3 — transfers view with an empty transfer list (fully settled group) reuses balance.even, no dangling title', () => {
    const a = composeGroupTotal({
      total: 100_000n,
      count: 2,
      memberCount: 4,
      transfers: [],
      names,
      currency: KRW,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.groupTotal.sum',
          values: { amount: '100000', currency: KRW },
        },
        { key: 'assistant.balance.even' },
      ],
    })
  })
})

// ===========================================================================
// composeMySpending — §4.4 (5 keys)
// ===========================================================================

describe('composeMySpending', () => {
  it('empty — zero expenses', () => {
    const a = composeMySpending({
      paid: 0n,
      consumed: 0n,
      net: 0n,
      currency: KRW,
      view: 'paid',
      hasExpenses: false,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.mySpending.empty' }] })
  })

  it("view:paid — '내가 낸 거 얼마야' / statement-shaped 'i paid for dinner' both read as a plain fact", () => {
    const a = composeMySpending({
      paid: 45_000n,
      consumed: 20_000n,
      net: 25_000n,
      currency: KRW,
      view: 'paid',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.mySpending.paid',
          values: { amount: '45000', currency: KRW },
        },
      ],
    })
  })

  it('view:consumed', () => {
    const a = composeMySpending({
      paid: 45_000n,
      consumed: 20_000n,
      net: 25_000n,
      currency: KRW,
      view: 'consumed',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.mySpending.consumed',
          values: { amount: '20000', currency: KRW },
        },
      ],
    })
  })

  it('view:ahead, positive net — ahead', () => {
    const a = composeMySpending({
      paid: 45_000n,
      consumed: 20_000n,
      net: 25_000n,
      currency: KRW,
      view: 'ahead',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.mySpending.ahead',
          values: { amount: '25000', currency: KRW },
        },
      ],
    })
  })

  it('review I2 — view:ahead, net exactly zero reuses balance.even, not "0 ahead"', () => {
    const a = composeMySpending({
      paid: 20_000n,
      consumed: 20_000n,
      net: 0n,
      currency: KRW,
      view: 'ahead',
      hasExpenses: true,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.balance.even' }] })
  })

  it('view:ahead, negative net — behind (never lies about the sign)', () => {
    const a = composeMySpending({
      paid: 5_000n,
      consumed: 20_000n,
      net: -15_000n,
      currency: KRW,
      view: 'ahead',
      hasExpenses: true,
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.mySpending.behind',
          values: { amount: '15000', currency: KRW },
        },
      ],
    })
  })
})

// ===========================================================================
// composeWallet — §4.5 (4 keys)
// ===========================================================================

function wallet(over: Partial<WalletSummary>): WalletSummary {
  return {
    walletId: 'w1',
    label: 'Travel card',
    type: 'TRAVEL_CARD',
    currency: 'JPY',
    loaded: 100_000n,
    spent: 40_000n,
    adjustments: 0n,
    remaining: 60_000n,
    overdrawn: false,
    hasTopUps: true,
    ...over,
  }
}

describe('composeWallet', () => {
  it('empty — no wallets', () => {
    const a = composeWallet({ wallets: [] })
    expect(a).toEqual({ lines: [{ key: 'assistant.wallet.empty' }] })
  })

  it('one — single wallet, not overdrawn', () => {
    const a = composeWallet({
      wallets: [wallet({ label: '지갑', remaining: 12_000n })],
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.wallet.one',
          values: { label: '지갑', amount: '12000', currency: 'JPY' },
        },
      ],
    })
  })

  it('line — multi-currency wallets, each with its own currency', () => {
    const a = composeWallet({
      wallets: [
        wallet({
          walletId: 'w1',
          label: 'JPY wallet',
          currency: 'JPY',
          remaining: 5_000n,
        }),
        wallet({
          walletId: 'w2',
          label: 'USD wallet',
          currency: 'USD',
          remaining: 200n,
        }),
      ],
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.wallet.line',
          values: { label: 'JPY wallet', amount: '5000', currency: 'JPY' },
        },
        {
          key: 'assistant.wallet.line',
          values: { label: 'USD wallet', amount: '200', currency: 'USD' },
        },
      ],
    })
  })

  it('overdrawn — negative remaining renders the positive shortfall', () => {
    const a = composeWallet({
      wallets: [wallet({ label: '지갑', remaining: -3_000n, overdrawn: true })],
    })
    expect(a).toEqual({
      lines: [
        {
          key: 'assistant.wallet.overdrawn',
          values: { label: '지갑', amount: '3000', currency: 'JPY' },
        },
      ],
    })
  })
})

// ===========================================================================
// composeHelp — §4.6 (7 keys, fixed order, no values)
// ===========================================================================

describe('composeHelp', () => {
  it('always renders all seven capability lines in table order', () => {
    const a = composeHelp()
    expect(keysOf(a)).toEqual([
      'assistant.help.intro',
      'assistant.help.entry',
      'assistant.help.balance',
      'assistant.help.pairwise',
      'assistant.help.groupTotal',
      'assistant.help.wallet',
      'assistant.help.manual',
    ])
    expect(a.lines.every((l) => l.values === undefined)).toBe(true)
  })
})

// ===========================================================================
// composeConfirm — §4.7 (10 keys, one per CONFIRM_* kind)
// ===========================================================================

describe('composeConfirm', () => {
  it('saved', () => {
    expect(
      composeConfirm({ kind: 'saved', amount: 30_000n, currency: KRW }),
    ).toEqual({
      lines: [
        {
          key: 'assistant.confirm.saved',
          values: { amount: '30000', currency: KRW },
        },
      ],
    })
  })

  it('cancelled', () => {
    expect(composeConfirm({ kind: 'cancelled' })).toEqual({
      lines: [{ key: 'assistant.confirm.cancelled' }],
    })
  })

  it('updatedAmount', () => {
    expect(
      composeConfirm({ kind: 'updatedAmount', amount: 40_000n, currency: KRW }),
    ).toEqual({
      lines: [
        {
          key: 'assistant.confirm.updatedAmount',
          values: { amount: '40000', currency: KRW },
        },
      ],
    })
  })

  it('updatedPayer', () => {
    expect(composeConfirm({ kind: 'updatedPayer', name: '철수' })).toEqual({
      lines: [
        { key: 'assistant.confirm.updatedPayer', values: { name: '철수' } },
      ],
    })
  })

  it('updatedParticipants', () => {
    expect(
      composeConfirm({ kind: 'updatedParticipants', names: ['민수', '유나'] }),
    ).toEqual({
      lines: [
        {
          key: 'assistant.confirm.updatedParticipants',
          values: { names: '민수, 유나' },
        },
      ],
    })
  })

  it('updatedHalf', () => {
    expect(composeConfirm({ kind: 'updatedHalf', name: '민수' })).toEqual({
      lines: [
        { key: 'assistant.confirm.updatedHalf', values: { name: '민수' } },
      ],
    })
  })

  it('updatedEveryone', () => {
    expect(composeConfirm({ kind: 'updatedEveryone' })).toEqual({
      lines: [{ key: 'assistant.confirm.updatedEveryone' }],
    })
  })

  it('askWhatToChange', () => {
    expect(composeConfirm({ kind: 'askWhatToChange' })).toEqual({
      lines: [{ key: 'assistant.confirm.askWhatToChange' }],
    })
  })

  it('askWhichAmount', () => {
    expect(composeConfirm({ kind: 'askWhichAmount' })).toEqual({
      lines: [{ key: 'assistant.confirm.askWhichAmount' }],
    })
  })

  it('askWhoToRemove', () => {
    expect(composeConfirm({ kind: 'askWhoToRemove' })).toEqual({
      lines: [{ key: 'assistant.confirm.askWhoToRemove' }],
    })
  })

  it('askWhoToAdd', () => {
    expect(composeConfirm({ kind: 'askWhoToAdd' })).toEqual({
      lines: [{ key: 'assistant.confirm.askWhoToAdd' }],
    })
  })
})

// ===========================================================================
// composeGuided — §4.8 (10 keys)
// ===========================================================================

describe('composeGuided', () => {
  it('hold — renders only the hold line, ack/options/escape suppressed', () => {
    const a = composeGuided({
      suggest: [],
      hold: true,
      input: '잠깐만',
      cardOpen: false,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.guided.hold' }] })
  })

  it("bare suggest:['HELP'] renders the myBalance/groupTotal/help triple (DECISIONS.md erratum a)", () => {
    const a = composeGuided({
      suggest: ['HELP'],
      hold: false,
      input: '계산기 어디 있어?',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.option.myBalance',
      'assistant.guided.option.groupTotal',
      'assistant.guided.option.help',
      'assistant.guided.escape',
    ])
  })

  it("a ranked, non-bare suggest list is rendered as given, capped at three ('?' -> HELP/MY_BALANCE/GROUP_TOTAL)", () => {
    const a = composeGuided({
      suggest: ['HELP', 'QUERY_MY_BALANCE', 'QUERY_GROUP_TOTAL'],
      hold: false,
      input: '?',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.option.help',
      'assistant.guided.option.myBalance',
      'assistant.guided.option.groupTotal',
      'assistant.guided.escape',
    ])
  })

  it('minors — the 3-cap applies AFTER filtering, so an unrenderable entry never steals a slot from a later renderable one', () => {
    const a = composeGuided({
      suggest: [
        'CONFIRM_MODIFY', // no §4.8 copy — filtered out, must not count toward the cap
        'QUERY_MY_BALANCE',
        'QUERY_GROUP_TOTAL',
        'QUERY_MY_SPENDING',
        'HELP', // 5th renderable entry — past the 3-option cap, correctly dropped
      ],
      hold: false,
      input: 'x',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.option.myBalance',
      'assistant.guided.option.groupTotal',
      'assistant.guided.option.mySpending',
      'assistant.guided.escape',
    ])
  })

  it('pairwise option fills {name} when a member was bound', () => {
    const a = composeGuided({
      suggest: ['QUERY_PAIRWISE'],
      hold: false,
      input: '민수랑 뭐 했지',
      name: '민수',
      cardOpen: false,
    })
    expect(a.lines[1]).toEqual({
      key: 'assistant.guided.option.pairwise',
      values: { name: '민수' },
    })
  })

  it('pairwise option is dropped (never rendered nameless) when no name was bound', () => {
    const a = composeGuided({
      suggest: ['QUERY_PAIRWISE'],
      hold: false,
      input: 'hi',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.escape',
    ])
  })

  it('expense option echoes the raw input', () => {
    const a = composeGuided({
      suggest: ['EXPENSE_ENTRY'],
      hold: false,
      input: '만두 먹었어',
      cardOpen: false,
    })
    expect(a.lines[1]).toEqual({
      key: 'assistant.guided.option.expense',
      values: { input: '만두 먹었어' },
    })
  })

  it("crossCurrency + CONFIRM_YES wizard pointer (classify's suggest:['EXPENSE_ENTRY'])", () => {
    // §2.2 + T3's M11: a CONFIRM_YES on an open crossCurrency card classifies
    // as UNKNOWN{hold:false, suggest:['EXPENSE_ENTRY']} — the composer has no
    // special knowledge of "wizard handoff"; it renders the same expense
    // option any other EXPENSE_ENTRY suggestion would get. A crossCurrency
    // card IS open, but EXPENSE_ENTRY is always renderable, so the ordinary
    // ack still fires, not cardOpenAck.
    const a = composeGuided({
      suggest: ['EXPENSE_ENTRY'],
      hold: false,
      input: 'ok',
      cardOpen: true,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.option.expense',
      'assistant.guided.escape',
    ])
  })

  it('CONFIRM_YES/CONFIRM_NO_CANCEL suggestions have no §4.8 option copy — dropped, never invented', () => {
    // ko NEGATIVE 3.2: `ㄷㄷ` -> UNKNOWN{suggest:['CONFIRM_YES','CONFIRM_NO_CANCEL']}
    // No card open here, so the generic ack still applies (contrast with
    // the cardOpen ruling test below, where the same empty-options shape
    // gets `cardOpenAck` instead).
    const a = composeGuided({
      suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      hold: false,
      input: 'ㄷㄷ',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.escape',
    ])
  })

  it('CONFIRM_MODIFY suggestion has no §4.8 option copy — dropped', () => {
    // ko NEGATIVE 3.3: `말고` -> UNKNOWN{suggest:['CONFIRM_MODIFY']}
    const a = composeGuided({
      suggest: ['CONFIRM_MODIFY'],
      hold: false,
      input: '말고',
      cardOpen: false,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.escape',
    ])
  })

  it('RULING — card open + zero renderable options renders cardOpenAck instead of ack', () => {
    // ko NEGATIVE 3.2's `ㄷㄷ` row, but with a confirm card open (openCard
    // !== null) — the incoherent case the reviewer's ruling fixes: "did you
    // mean one of these?" followed by nothing, right next to an open card.
    const a = composeGuided({
      suggest: ['CONFIRM_YES', 'CONFIRM_NO_CANCEL'],
      hold: false,
      input: 'ㄷㄷ',
      cardOpen: true,
    })
    expect(a).toEqual({
      lines: [
        { key: 'assistant.guided.cardOpenAck' },
        { key: 'assistant.guided.escape' },
      ],
    })
  })

  it('RULING — card open but at least one renderable option still uses the ordinary ack', () => {
    const a = composeGuided({
      suggest: ['QUERY_MY_BALANCE'],
      hold: false,
      input: '나 얼마 내면 돼?',
      cardOpen: true,
    })
    expect(keysOf(a)).toEqual([
      'assistant.guided.ack',
      'assistant.guided.option.myBalance',
      'assistant.guided.escape',
    ])
  })

  it('RULING — hold takes precedence over cardOpen (still only the hold line)', () => {
    const a = composeGuided({
      suggest: [],
      hold: true,
      input: '잠깐',
      cardOpen: true,
    })
    expect(a).toEqual({ lines: [{ key: 'assistant.guided.hold' }] })
  })
})

// ===========================================================================
// i18n invariant — every key a composer CAN emit exists in both locales,
// and no assistant.* key in either locale is unreachable from compose.ts.
// ===========================================================================

function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (obj !== null && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      flattenKeys(v, prefix ? `${prefix}.${k}` : k),
    )
  }
  return [prefix]
}

/**
 * Every `assistant.*` key each composer can produce, gathered by exercising
 * every branch above (not re-deriving from source — a second copy of the
 * same literals would prove nothing). Kept in one place so it is easy to
 * audit against the `it.each` blocks above.
 */
const ALL_EMITTABLE_KEYS: readonly string[] = [
  'assistant.balance.empty',
  'assistant.balance.even',
  'assistant.balance.owesLine',
  'assistant.balance.owesTotal',
  'assistant.balance.receivesLine',
  'assistant.balance.receivesTotal',
  'assistant.balance.who',
  'assistant.pairwise.even',
  'assistant.pairwise.youOwe',
  'assistant.pairwise.theyOwe',
  'assistant.groupTotal.empty',
  'assistant.groupTotal.sum',
  'assistant.groupTotal.sumWithCount',
  'assistant.groupTotal.perPerson',
  'assistant.groupTotal.transfersTitle',
  'assistant.groupTotal.transferLine',
  'assistant.mySpending.empty',
  'assistant.mySpending.paid',
  'assistant.mySpending.consumed',
  'assistant.mySpending.ahead',
  'assistant.mySpending.behind',
  'assistant.wallet.empty',
  'assistant.wallet.one',
  'assistant.wallet.line',
  'assistant.wallet.overdrawn',
  'assistant.help.intro',
  'assistant.help.entry',
  'assistant.help.balance',
  'assistant.help.pairwise',
  'assistant.help.groupTotal',
  'assistant.help.wallet',
  'assistant.help.manual',
  'assistant.confirm.saved',
  'assistant.confirm.cancelled',
  'assistant.confirm.updatedAmount',
  'assistant.confirm.updatedPayer',
  'assistant.confirm.updatedParticipants',
  'assistant.confirm.updatedHalf',
  'assistant.confirm.updatedEveryone',
  'assistant.confirm.askWhatToChange',
  'assistant.confirm.askWhichAmount',
  'assistant.confirm.askWhoToRemove',
  'assistant.confirm.askWhoToAdd',
  'assistant.confirm.itemPriced',
  'assistant.confirm.itemPriceNext',
  'assistant.confirm.askItemPrice',
  'assistant.confirm.itemAssigned',
  'assistant.confirm.itemShared',
  'assistant.explain.empty',
  'assistant.explain.header',
  'assistant.explain.rowEven',
  'assistant.explain.rowItems',
  'assistant.explain.footer',
  'assistant.guided.itemsPriceAsk',
  'assistant.guided.settleAck',
  'assistant.guided.whoAmbiguous',
  'assistant.guided.whoUnknown',
  'assistant.wallet.created',
  'assistant.history.empty',
  'assistant.history.headerMine',
  'assistant.history.headerGroup',
  'assistant.history.row',
  'assistant.history.more',
  'assistant.history.filteredHeader',
  'assistant.history.filteredEmpty',
  'assistant.history.totalLine',
  'assistant.history.loadMore',
  'assistant.smallTalk.greeting',
  'assistant.smallTalk.thanks',
  'assistant.smallTalk.farewell',
  'assistant.guided.ack',
  'assistant.guided.cardOpenAck',
  'assistant.guided.hold',
  'assistant.guided.option.myBalance',
  'assistant.guided.option.pairwise',
  'assistant.guided.option.groupTotal',
  'assistant.guided.option.mySpending',
  'assistant.guided.option.wallet',
  'assistant.guided.option.expense',
  'assistant.guided.option.help',
  'assistant.guided.escape',
]

describe('assistant.* i18n invariant', () => {
  const en = JSON.parse(
    readFileSync(join(DIR, '../../messages/en.json'), 'utf8'),
  ) as Record<string, unknown>
  const ko = JSON.parse(
    readFileSync(join(DIR, '../../messages/ko.json'), 'utf8'),
  ) as Record<string, unknown>
  const enKeys = new Set(flattenKeys(en.assistant).map((k) => `assistant.${k}`))
  const koKeys = new Set(flattenKeys(ko.assistant).map((k) => `assistant.${k}`))

  it("has exactly 81 assistant.* keys (76 through R4 assignment, + QUERY_EXPLAIN's five)", () => {
    expect(enKeys.size).toBe(81)
    expect(koKeys.size).toBe(81)
  })

  it.each(ALL_EMITTABLE_KEYS)('%s exists in en.json', (key) => {
    expect(enKeys.has(key)).toBe(true)
  })

  it.each(ALL_EMITTABLE_KEYS)('%s exists in ko.json', (key) => {
    expect(koKeys.has(key)).toBe(true)
  })

  it('en and ko have identical assistant.* key sets', () => {
    expect([...enKeys].sort()).toEqual([...koKeys].sort())
  })

  it('no orphaned assistant.* key — every key in en.json is emitted by some composer', () => {
    const emittable = new Set(ALL_EMITTABLE_KEYS)
    const orphaned = [...enKeys].filter((k) => !emittable.has(k))
    expect(orphaned).toEqual([])
  })

  it('ALL_EMITTABLE_KEYS itself has no duplicates', () => {
    expect(new Set(ALL_EMITTABLE_KEYS).size).toBe(ALL_EMITTABLE_KEYS.length)
  })
})

// ===========================================================================
// MONEY_KEYS invariant (minors) — `money()`'s call sites and the exported
// contract can't silently drift apart.
// ===========================================================================

describe('MONEY_KEYS invariant', () => {
  const sample: AssistantAnswerLine[] = [
    ...composeMyBalance({
      transfers: [{ from: 'me', to: 'm1', amount: 1n }],
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: true,
    }).lines,
    ...composeMyBalance({
      transfers: [{ from: 'm1', to: 'me', amount: 1n }],
      actorId: 'me',
      names,
      currency: KRW,
      view: 'amount',
      hasExpenses: true,
    }).lines,
    ...composePairwise({ net: 1n, name: '민수', currency: KRW }).lines,
    ...composePairwise({ net: -1n, name: '민수', currency: KRW }).lines,
    ...composeGroupTotal({
      total: 1n,
      count: 1,
      memberCount: 2,
      names,
      currency: KRW,
    }).lines,
    ...composeGroupTotal({
      total: 1n,
      count: 1,
      memberCount: 2,
      transfers: [{ from: 'm1', to: 'me', amount: 1n }],
      names,
      currency: KRW,
    }).lines,
    ...composeMySpending({
      paid: 1n,
      consumed: 1n,
      net: 1n,
      currency: KRW,
      view: 'paid',
      hasExpenses: true,
    }).lines,
    ...composeMySpending({
      paid: 1n,
      consumed: 1n,
      net: 1n,
      currency: KRW,
      view: 'consumed',
      hasExpenses: true,
    }).lines,
    ...composeMySpending({
      paid: 2n,
      consumed: 1n,
      net: 1n,
      currency: KRW,
      view: 'ahead',
      hasExpenses: true,
    }).lines,
    ...composeMySpending({
      paid: 1n,
      consumed: 2n,
      net: -1n,
      currency: KRW,
      view: 'ahead',
      hasExpenses: true,
    }).lines,
    ...composeWallet({ wallets: [wallet({ remaining: 1n })] }).lines,
    ...composeWallet({
      wallets: [wallet({ remaining: -1n, overdrawn: true })],
    }).lines,
    ...composeWallet({
      wallets: [wallet({ remaining: 1n }), wallet({ remaining: 2n })],
    }).lines,
    ...composeConfirm({ kind: 'saved', amount: 1n, currency: KRW }).lines,
    ...composeConfirm({ kind: 'updatedAmount', amount: 1n, currency: KRW })
      .lines,
    ...composeConfirm({
      kind: 'itemPriced',
      name: '콜라',
      amount: 1n,
      currency: KRW,
      nextName: '우동',
    }).lines,
    ...composeConfirm({ kind: 'askItemPrice', name: '콜라' }).lines,
    ...composeConfirm({ kind: 'itemAssigned', name: '우동', names: ['빅헤드'] }).lines,
    ...composeConfirm({ kind: 'itemShared', name: '우유롤' }).lines,
    ...composeExplain({ rows: [] }).lines,
    ...composeExplain({
      rows: [
        { title: '김치찌개', share: 6500n, currency: KRW, evenAmong: 2, items: [] },
        {
          title: '점심',
          share: 12000n,
          currency: KRW,
          evenAmong: null,
          items: ['우동 ×2'],
        },
      ],
    }).lines,
    ...composeItemsPriceAsk(['콜라', '우동']).lines,
    ...composeSmallTalk('greeting').lines,
    ...composeHistory({ scope: 'mine', rows: [], total: 0 }).lines,
    ...composeWhoAmbiguous(['민수', '유나']).lines,
    ...composeWhoUnknown().lines,
    ...composeWalletCreated('엔화 현금').lines,
    ...composeHistoryFiltered({ rows: [], totalCount: 0, totals: [], remaining: 0 }).lines,
    ...composeHistoryFiltered({
      rows: [{ title: '커피', amount: 5000n, currency: KRW, payerName: '민수' }],
      totalCount: 7,
      totals: [{ amount: 35000n, currency: KRW }],
      remaining: 6,
    }).lines,
    ...composeHistory({
      scope: 'group',
      rows: [
        { title: '김치찌개', amount: 13000n, currency: KRW, payerName: '민수' },
      ],
      total: 6,
    }).lines,
    ...composeHistory({
      scope: 'mine',
      rows: [{ title: '커피', amount: 5000n, currency: KRW, payerName: '유나' }],
      total: 1,
    }).lines,
    ...composeSmallTalk('thanks').lines,
    ...composeSmallTalk('farewell').lines,
    ...composeGuided({
      suggest: ['QUERY_MY_BALANCE'],
      hold: false,
      input: '정산할래',
      cardOpen: false,
      topic: 'settle',
    }).lines,
    ...composeConfirm({ kind: 'cancelled' }).lines,
    ...composeHelp().lines,
    ...composeGuided({
      suggest: ['HELP'],
      hold: false,
      input: 'x',
      cardOpen: false,
    }).lines,
  ]

  it('every emitted line carrying both amount and currency has a key listed in MONEY_KEYS', () => {
    for (const l of sample) {
      const carriesMoney =
        l.values !== undefined && 'amount' in l.values && 'currency' in l.values
      if (carriesMoney) expect(MONEY_KEYS.has(l.key)).toBe(true)
    }
  })

  it('every MONEY_KEYS entry was actually observed carrying amount+currency (no stale entries)', () => {
    const observed = new Set(
      sample
        .filter((l) => l.values !== undefined && 'currency' in l.values)
        .map((l) => l.key),
    )
    for (const key of MONEY_KEYS) {
      expect(observed.has(key)).toBe(true)
    }
  })
})

// ===========================================================================
// ICU render smoke (C1 regression net) — every assistant.* key actually
// renders through next-intl with dummy values: no throw, no leftover
// `{`/`}` in the output. This is what would have caught the ko
// guided.option.expense quoting bug (a `'{input}'` literal swallowed by
// ICU's quoted-literal rule) before it shipped.
// ===========================================================================

describe('ICU render smoke', () => {
  const enMessages = JSON.parse(
    readFileSync(join(DIR, '../../messages/en.json'), 'utf8'),
  )
  const koMessages = JSON.parse(
    readFileSync(join(DIR, '../../messages/ko.json'), 'utf8'),
  )
  // `onError` rethrows so a genuine ICU parse failure fails the test instead
  // of next-intl's default (log + fall back to the bare key).
  const tEn = createTranslator({
    locale: 'en',
    messages: enMessages,
    onError: (error) => {
      throw error
    },
  })
  const tKo = createTranslator({
    locale: 'ko',
    messages: koMessages,
    onError: (error) => {
      throw error
    },
  })

  /** One dummy value per placeholder name used anywhere across §4's templates. */
  const DUMMY_VALUES: Record<string, string | number> = {
    amount: '35,000원',
    name: '민수',
    names: '민수, 유나',
    count: 3,
    label: '지갑',
    from: '민수',
    to: '유나',
    input: '만두 먹었어',
    example: '콜라',
    title: '김치찌개',
    items: '우동 ×2',
  }

  const enKeys = flattenKeys(enMessages.assistant).map((k) => `assistant.${k}`)
  const koKeys = flattenKeys(koMessages.assistant).map((k) => `assistant.${k}`)

  it.each(enKeys)(
    '%s renders in en with no parse error and no leftover braces',
    (key) => {
      let rendered = ''
      expect(() => {
        rendered = tEn(key, DUMMY_VALUES)
      }).not.toThrow()
      expect(rendered).not.toMatch(/[{}]/)
    },
  )

  it.each(koKeys)(
    '%s renders in ko with no parse error and no leftover braces',
    (key) => {
      let rendered = ''
      expect(() => {
        rendered = tKo(key, DUMMY_VALUES)
      }).not.toThrow()
      expect(rendered).not.toMatch(/[{}]/)
    },
  )

  it('C1 — the ko guided.option.expense fix keeps its literal quote marks around the interpolated input', () => {
    const rendered = tKo('assistant.guided.option.expense', {
      input: '만두 먹었어',
    })
    expect(rendered).toBe("'만두 먹었어'을 지출로 적을까요?")
  })

  it('C1 regression check — the pre-fix template WOULD have failed this smoke test', () => {
    const broken = createTranslator({
      locale: 'ko',
      messages: { assistant: { x: "'{input}'을 지출로 적을까요?" } },
    }) as (key: string, values?: Record<string, string | number>) => string
    const rendered = broken('assistant.x', { input: '만두 먹었어' })
    // Documents the exact defect: the placeholder is swallowed, not filled.
    expect(rendered).toBe('{input}을 지출로 적을까요?')
    expect(rendered).toMatch(/[{}]/)
  })
})
