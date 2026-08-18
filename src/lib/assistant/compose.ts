/**
 * compose.ts — the pure answer composers, spec §5.4 (§4's reply tables are
 * the copy source; every string here is an `assistant.*` i18n KEY, never
 * formatted text).
 *
 * Purity: no DB, no I/O, no React, no `formatMinor` call — same law as
 * `settlement/` and `chat-parse/`. Every composer takes the settlement
 * engine's already-computed OUTPUTS (never its inputs) and the relevant
 * slice of a `Classified` result, and returns `{ lines }` where each line
 * is an i18n key plus the RAW values its placeholders need. Money values
 * are carried as a decimal-string `amount` (never a float, never
 * pre-formatted) paired with its own `currency` key, so the render layer
 * (T6) can call `formatMinor(BigInt(amount), currency)` — the ONE place
 * that decides comma rules, symbols, and decimals (spec §4 house rules).
 *
 * ## Divergences from spec §5.4's literal 7-signature sketch
 *
 * 1. **`hasExpenses` added to `composeMyBalance` and `composeMySpending`.**
 *    §4.1/§4.4 each need to choose between an `empty` template ("no
 *    expenses recorded yet") and a real-answer template (which, for a
 *    perfectly settled group, legitimately has the SAME `transfers: []` /
 *    `paid: 0n, consumed: 0n` shape as "nothing recorded"). Spec's own
 *    5-field sketch for these two composers has no signal to tell the two
 *    states apart, and the T5 brief explicitly requires a "zero expenses"
 *    test case, so it must be decidable from the composer's input alone.
 *    `composeGroupTotal` needed no such addition — its listed `count`
 *    field already disambiguates (`count === 0` -> empty).
 * 2. **An 8th composer, `composeConfirm`, for §4.7's `CONFIRM_*` templates.**
 *    §5.4 lists exactly 7 composer functions and none of them covers
 *    `assistant.confirm.*` (10 keys). Left unimplemented, those 10 keys
 *    would be unreachable from this file — failing the "no orphaned
 *    `assistant.*` key" invariant the brief requires — and CONFIRM_YES /
 *    CONFIRM_NO_CANCEL / CONFIRM_MODIFY would be the only intents without a
 *    pure, testable composer. `composeConfirm` takes a small discriminated
 *    union (one variant per §4.7 key) instead of engine outputs, since
 *    none of the three CONFIRM_* intents does a settlement read (§1).
 * 3. **`composeGuided` silently drops `CONFIRM_YES` / `CONFIRM_NO_CANCEL` /
 *    `CONFIRM_MODIFY` entries from `suggest`.** `classify()` legitimately
 *    emits these as `suggest` values (e.g. ko NEGATIVE `ㄷㄷ` ->
 *    `{suggest:['CONFIRM_YES','CONFIRM_NO_CANCEL']}`, `말고` ->
 *    `{suggest:['CONFIRM_MODIFY']}`), but §4.8's `option.*` table has no
 *    key for any of the three. There is nothing locked-copy to render for
 *    them, so they are filtered out rather than invented; `ack` and
 *    `escape` still always render, so the reply never goes blank.
 *
 * ## Review round 1 fixes (DECISIONS.md 2026-08-10, Task 5 errata (c)/(d))
 *
 * - `composeMyBalance` view:'who' no longer renders the `who` line when the
 *   actor is a CREDITOR (`owes.length === 0`): "send it to {names}" is
 *   backwards when those names are the ones who owe the ACTOR —
 *   `receivesLine` already answers "who" correctly on its own.
 * - `composeMySpending` view:'ahead' with `net === 0n` now reuses the
 *   locked `assistant.balance.even` key instead of a nonsensical
 *   "you're 0 ahead" line — there is no `mySpending`-scoped "even" copy.
 * - `composeGroupTotal`'s transfers view suppresses `transfersTitle` (and
 *   the empty line list under it) when `transfers` is present but empty —
 *   a fully-settled group reuses `assistant.balance.even` instead of a
 *   dangling "here's how it clears" with nothing under it.
 * - `composeGuided` gained a required `cardOpen` field (erratum (c), a
 *   §4.8 addendum): when a card is open AND the post-filter option list
 *   is empty, the reply now opens with `assistant.guided.cardOpenAck`
 *   instead of the generic `ack` — "did you mean one of these?" followed
 *   by zero options is incoherent when there's a confirm card sitting
 *   right there waiting for a decision. T6 supplies `cardOpen` from
 *   `ctx.openCard !== null`; `escape` still always renders.
 * - The `slice(0, 3)` cap now runs AFTER filtering unrenderable intents
 *   out of `suggest`, not before — previously a raw `suggest` of length 3
 *   containing an unrenderable entry (e.g. `CONFIRM_MODIFY`) could produce
 *   fewer than 3 real options even when a 4th, renderable, `suggest` entry
 *   existed past the old slice boundary.
 * - ko `guided.option.expense` needed ICU-escaping (erratum (d)): a bare
 *   `'{input}'` is parsed by ICU MessageFormat as a QUOTED LITERAL (a `'`
 *   immediately before `{` opens a quoted span that swallows everything up
 *   to the next `'`), so the placeholder was never substituted — the user
 *   would see the literal text `{input}`. Fixed by doubling the quotes
 *   (`''{input}''`), which ICU renders as a literal apostrophe on each
 *   side with `{input}` interpolated normally in between. See the new ICU
 *   render-smoke test below, which is the regression net for this class of
 *   bug across all 53 keys.
 *
 * See task-5-report.md for the full writeup.
 */

import type { Transfer } from '../settlement'
import type { WalletSummary } from '../wallet-view'
import type { AssistantAnswer, AssistantAnswerLine, Intent } from './types'

function line(
  key: string,
  values?: Record<string, string | number>,
): AssistantAnswerLine {
  return values === undefined ? { key } : { key, values }
}

/** Money stays integer minor units — a decimal-string amount + its currency. */
function money(amount: bigint, currency: string): Record<string, string> {
  return { amount: amount.toString(), currency }
}

function joinNames(names: readonly string[]): string {
  return names.join(', ')
}

// ===========================================================================
// composeMyBalance — spec §4.1
// ===========================================================================

export function composeMyBalance(a: {
  transfers: readonly Transfer[]
  actorId: string
  names: Map<string, string>
  currency: string
  view: 'amount' | 'who'
  /** Disambiguates §4.1's `empty` from a genuinely settled `even`. */
  hasExpenses: boolean
}): AssistantAnswer {
  if (!a.hasExpenses) return { lines: [line('assistant.balance.empty')] }

  const nameOf = (id: string) => a.names.get(id) ?? id
  const owes = a.transfers.filter((t) => t.from === a.actorId)
  const receives = a.transfers.filter((t) => t.to === a.actorId)

  if (owes.length === 0 && receives.length === 0) {
    return { lines: [line('assistant.balance.even')] }
  }

  const direction = owes.length > 0 ? owes : receives
  const lineKey =
    owes.length > 0
      ? 'assistant.balance.owesLine'
      : 'assistant.balance.receivesLine'
  const totalKey =
    owes.length > 0
      ? 'assistant.balance.owesTotal'
      : 'assistant.balance.receivesTotal'
  const counterpartyId = (t: Transfer) => (owes.length > 0 ? t.to : t.from)
  const total = direction.reduce((sum, t) => sum + t.amount, 0n)

  const lines: AssistantAnswerLine[] = []
  // §4.1's `who` line ("send it to {names}") only makes sense when the
  // actor is the one sending — for a CREDITOR (owes.length === 0) it would
  // state the payment direction backwards, and receivesLine already names
  // who owes the actor, so it is skipped entirely (review I1).
  if (a.view === 'who' && owes.length > 0) {
    lines.push(
      line('assistant.balance.who', {
        names: joinNames(direction.map((t) => nameOf(counterpartyId(t)))),
      }),
    )
  }
  for (const t of direction) {
    lines.push(
      line(lineKey, {
        name: nameOf(counterpartyId(t)),
        ...money(t.amount, a.currency),
      }),
    )
  }
  lines.push(line(totalKey, money(total, a.currency)))
  return { lines }
}

// ===========================================================================
// composePairwise — spec §4.2
// ===========================================================================

export function composePairwise(a: {
  net: bigint
  name: string
  currency: string
}): AssistantAnswer {
  if (a.net === 0n) {
    return { lines: [line('assistant.pairwise.even', { name: a.name })] }
  }
  // Convention shared with pairwiseNetFor (§1): positive = the actor owes them.
  const key =
    a.net > 0 ? 'assistant.pairwise.youOwe' : 'assistant.pairwise.theyOwe'
  const amount = a.net > 0 ? a.net : -a.net
  return { lines: [line(key, { name: a.name, ...money(amount, a.currency) })] }
}

// ===========================================================================
// composeGroupTotal — spec §4.3
// ===========================================================================

export function composeGroupTotal(a: {
  total: bigint
  count: number
  memberCount: number
  /** Presence (even if empty) selects the transfers view over the total view. */
  transfers?: readonly Transfer[]
  names: Map<string, string>
  currency: string
}): AssistantAnswer {
  if (a.count === 0) return { lines: [line('assistant.groupTotal.empty')] }

  if (a.transfers !== undefined) {
    const nameOf = (id: string) => a.names.get(id) ?? id
    const lines: AssistantAnswerLine[] = [
      line('assistant.groupTotal.sum', money(a.total, a.currency)),
    ]
    // An empty transfer list with count > 0 means a fully settled group —
    // "here's how it clears" with nothing under it is a dangling title, so
    // it reuses the locked `balance.even` line instead (review I3).
    if (a.transfers.length === 0) {
      lines.push(line('assistant.balance.even'))
      return { lines }
    }
    lines.push(line('assistant.groupTotal.transfersTitle'))
    for (const t of a.transfers) {
      lines.push(
        line('assistant.groupTotal.transferLine', {
          from: nameOf(t.from),
          to: nameOf(t.to),
          ...money(t.amount, a.currency),
        }),
      )
    }
    return { lines }
  }

  const lines: AssistantAnswerLine[] = [
    line('assistant.groupTotal.sumWithCount', {
      count: a.count,
      ...money(a.total, a.currency),
    }),
  ]
  if (a.memberCount > 0) {
    lines.push(
      line(
        'assistant.groupTotal.perPerson',
        money(a.total / BigInt(a.memberCount), a.currency),
      ),
    )
  }
  return { lines }
}

// ===========================================================================
// composeMySpending — spec §4.4
// ===========================================================================

export function composeMySpending(a: {
  paid: bigint
  consumed: bigint
  net: bigint
  currency: string
  view: 'paid' | 'consumed' | 'ahead'
  /** Disambiguates §4.4's `empty` from a real zero (paid nothing, owed nothing). */
  hasExpenses: boolean
}): AssistantAnswer {
  if (!a.hasExpenses) return { lines: [line('assistant.mySpending.empty')] }

  if (a.view === 'paid') {
    return {
      lines: [line('assistant.mySpending.paid', money(a.paid, a.currency))],
    }
  }
  if (a.view === 'consumed') {
    return {
      lines: [
        line('assistant.mySpending.consumed', money(a.consumed, a.currency)),
      ],
    }
  }
  // view === 'ahead': the copy says "ahead" or "behind" per the SIGN of net,
  // never assuming the question's phrasing matched reality. Exactly zero is
  // neither — "0 more" reads as broken copy, so it reuses the locked
  // `balance.even` line instead (review I2); there is no mySpending-scoped
  // "even" template.
  if (a.net < 0n) {
    return {
      lines: [line('assistant.mySpending.behind', money(-a.net, a.currency))],
    }
  }
  if (a.net === 0n) {
    return { lines: [line('assistant.balance.even')] }
  }
  return {
    lines: [line('assistant.mySpending.ahead', money(a.net, a.currency))],
  }
}

// ===========================================================================
// composeWallet — spec §4.5
// ===========================================================================

export function composeWallet(a: {
  // Narrowed to just the fields this composer reads (T6): `WalletSummary`
  // itself carries DB-shaped bookkeeping (`loaded`/`spent`/`adjustments`/
  // `hasTopUps`) this never touches, and the caller only has a serializable
  // slice of it anyway (bigint cannot cross the server → client boundary as
  // a prop in this app — see `assistant-data.ts`). A full `WalletSummary`
  // still satisfies this structurally, so nothing upstream had to change.
  wallets: readonly Pick<
    WalletSummary,
    'label' | 'currency' | 'remaining' | 'overdrawn'
  >[]
}): AssistantAnswer {
  if (a.wallets.length === 0) return { lines: [line('assistant.wallet.empty')] }

  const oneKey =
    a.wallets.length === 1 ? 'assistant.wallet.one' : 'assistant.wallet.line'
  return {
    lines: a.wallets.map((w) =>
      w.overdrawn
        ? line('assistant.wallet.overdrawn', {
            label: w.label,
            ...money(-w.remaining, w.currency),
          })
        : line(oneKey, { label: w.label, ...money(w.remaining, w.currency) }),
    ),
  }
}

// ===========================================================================
// composeHelp — spec §4.6
// ===========================================================================

export function composeHelp(): AssistantAnswer {
  return {
    lines: [
      line('assistant.help.intro'),
      line('assistant.help.entry'),
      line('assistant.help.balance'),
      line('assistant.help.pairwise'),
      line('assistant.help.groupTotal'),
      line('assistant.help.wallet'),
      line('assistant.help.manual'),
    ],
  }
}

// ===========================================================================
// composeConfirm — spec §4.7 (8th composer; see file header divergence #2)
// ===========================================================================

export type ConfirmAnswerInput =
  | { kind: 'saved'; amount: bigint; currency: string }
  | { kind: 'cancelled' }
  | { kind: 'updatedAmount'; amount: bigint; currency: string }
  | { kind: 'updatedPayer'; name: string }
  | { kind: 'updatedParticipants'; names: readonly string[] }
  | { kind: 'updatedHalf'; name: string }
  | { kind: 'updatedEveryone' }
  | { kind: 'askWhatToChange' }
  | { kind: 'askWhichAmount' }
  | { kind: 'askWhoToRemove' }
  | { kind: 'askWhoToAdd' }
  /**
   * 2026-08-14 items-card follow-ups: a typed price landed on one line
   * (`itemPriced`, with the NEXT still-unpriced line's name to keep the
   * conversation moving, or null when none remain), or named a line with a
   * price the card couldn't use (`askItemPrice`).
   */
  | {
      kind: 'itemPriced'
      name: string
      amount: bigint
      currency: string
      nextName: string | null
    }
  | { kind: 'askItemPrice'; name: string }
  /** R4 typed assignment acks. */
  | { kind: 'itemAssigned'; name: string; names: readonly string[] }
  | { kind: 'itemShared'; name: string }

export function composeConfirm(a: ConfirmAnswerInput): AssistantAnswer {
  switch (a.kind) {
    case 'saved':
      return {
        lines: [line('assistant.confirm.saved', money(a.amount, a.currency))],
      }
    case 'cancelled':
      return { lines: [line('assistant.confirm.cancelled')] }
    case 'updatedAmount':
      return {
        lines: [
          line('assistant.confirm.updatedAmount', money(a.amount, a.currency)),
        ],
      }
    case 'updatedPayer':
      return {
        lines: [line('assistant.confirm.updatedPayer', { name: a.name })],
      }
    case 'updatedParticipants':
      return {
        lines: [
          line('assistant.confirm.updatedParticipants', {
            names: joinNames(a.names),
          }),
        ],
      }
    case 'updatedHalf':
      return {
        lines: [line('assistant.confirm.updatedHalf', { name: a.name })],
      }
    case 'updatedEveryone':
      return { lines: [line('assistant.confirm.updatedEveryone')] }
    case 'askWhatToChange':
      return { lines: [line('assistant.confirm.askWhatToChange')] }
    case 'askWhichAmount':
      return { lines: [line('assistant.confirm.askWhichAmount')] }
    case 'askWhoToRemove':
      return { lines: [line('assistant.confirm.askWhoToRemove')] }
    case 'askWhoToAdd':
      return { lines: [line('assistant.confirm.askWhoToAdd')] }
    case 'itemPriced': {
      const lines = [
        line('assistant.confirm.itemPriced', {
          name: a.name,
          ...money(a.amount, a.currency),
        }),
      ]
      if (a.nextName !== null) {
        lines.push(line('assistant.confirm.itemPriceNext', { name: a.nextName }))
      }
      return { lines }
    }
    case 'askItemPrice':
      return { lines: [line('assistant.confirm.askItemPrice', { name: a.name })] }
    case 'itemAssigned':
      return {
        lines: [
          line('assistant.confirm.itemAssigned', {
            name: a.name,
            names: joinNames(a.names),
          }),
        ],
      }
    case 'itemShared':
      return { lines: [line('assistant.confirm.itemShared', { name: a.name })] }
  }
}

/**
 * The items card's own never-dead-end reply (2026-08-14): a message the
 * classifier could not bind while lines are still unpriced answers with WHAT
 * is missing and a copyable example, instead of the generic cardOpenAck that
 * told the user nothing ("카드가 아직 열려 있어요" — owner screenshot 3).
 */
/**
 * QUERY_HISTORY — the recent-expense list, IN CHAT (2026-08-14 owner
 * screenshot: 사용내역/내 기록 fell to the confused menu; prime directive:
 * a bounce to the history screen is a failure). Rows arrive already
 * scoped and capped by the caller; `total` is the full matching count so
 * the reply can say how many more exist beyond the listed rows.
 */
export function composeHistory(a: {
  scope: 'mine' | 'group'
  rows: ReadonlyArray<{
    title: string
    amount: bigint
    currency: string
    payerName: string
  }>
  total: number
}): AssistantAnswer {
  if (a.rows.length === 0) {
    return { lines: [line('assistant.history.empty')] }
  }
  const lines: AssistantAnswerLine[] = [
    line(
      a.scope === 'mine'
        ? 'assistant.history.headerMine'
        : 'assistant.history.headerGroup',
      { count: a.rows.length },
    ),
    ...a.rows.map((r) =>
      line('assistant.history.row', {
        title: r.title,
        name: r.payerName,
        ...money(r.amount, r.currency),
      }),
    ),
  ]
  if (a.total > a.rows.length) {
    lines.push(line('assistant.history.more', { count: a.total - a.rows.length }))
  }
  return { lines }
}

/**
 * R4 QUERY_EXPLAIN — "왜 내가 만원이야?": MY share, expense by expense,
 * newest first. Each row is either an even split (evenAmong people) or an
 * itemised share (the lines I took). Amounts stay per-expense currency.
 */
export function composeExplain(a: {
  rows: ReadonlyArray<{
    title: string
    share: bigint
    currency: string
    evenAmong: number | null
    items: readonly string[]
  }>
}): AssistantAnswer {
  if (a.rows.length === 0) {
    return { lines: [line('assistant.explain.empty')] }
  }
  return {
    lines: [
      line('assistant.explain.header'),
      ...a.rows.map((r) =>
        r.evenAmong !== null
          ? line('assistant.explain.rowEven', {
              title: r.title,
              count: r.evenAmong,
              ...money(r.share, r.currency),
            })
          : line('assistant.explain.rowItems', {
              title: r.title,
              items: r.items.join(', '),
              ...money(r.share, r.currency),
            }),
      ),
      line('assistant.explain.footer'),
    ],
  }
}

/**
 * Social acts answered in kind (2026-08-14 owner screenshot: "안녕" got
 * the confused-ack menu). One line, Sem's voice, with a light nudge back
 * to the domain on a greeting.
 */
export function composeSmallTalk(act: 'greeting' | 'thanks' | 'farewell'): AssistantAnswer {
  const key =
    act === 'greeting'
      ? 'assistant.smallTalk.greeting'
      : act === 'thanks'
        ? 'assistant.smallTalk.thanks'
        : 'assistant.smallTalk.farewell'
  return { lines: [line(key)] }
}

/**
 * G4 clarifying questions for an unresolved person reference (dialogue
 * layer step 1): "걔" with two equally recent candidates asks WHICH, with
 * no candidate at all asks WHO — never a guess, never the confused menu.
 */
/**
 * Filtered expense list (R2a: '수탉과 먹은 지출 다 보여줘'). Totals are
 * PER CURRENCY — a mixed JPY/KRW match set never gets one invented sum.
 * `remaining` > 0 renders the load-more line, which the composer wires as
 * a tappable chip.
 */
export function composeHistoryFiltered(a: {
  rows: ReadonlyArray<{
    title: string
    amount: bigint
    currency: string
    payerName: string
  }>
  totalCount: number
  totals: ReadonlyArray<{ amount: bigint; currency: string }>
  remaining: number
}): AssistantAnswer {
  if (a.rows.length === 0) {
    return { lines: [line('assistant.history.filteredEmpty')] }
  }
  const lines: AssistantAnswerLine[] = [
    line('assistant.history.filteredHeader', { count: a.totalCount }),
    ...a.rows.map((r) =>
      line('assistant.history.row', {
        title: r.title,
        name: r.payerName,
        ...money(r.amount, r.currency),
      }),
    ),
    ...a.totals.map((t) =>
      line('assistant.history.totalLine', money(t.amount, t.currency)),
    ),
  ]
  if (a.remaining > 0) {
    lines.push(line('assistant.history.loadMore', { count: a.remaining }))
  }
  return { lines }
}

/** Chat-action ack: the wallet exists now (2026-08-14 prime directive). */
export function composeWalletCreated(label: string): AssistantAnswer {
  return { lines: [line('assistant.wallet.created', { label })] }
}

export function composeWhoAmbiguous(names: readonly string[]): AssistantAnswer {
  return { lines: [line('assistant.guided.whoAmbiguous', { names: joinNames(names) })] }
}

export function composeWhoUnknown(): AssistantAnswer {
  return { lines: [line('assistant.guided.whoUnknown')] }
}

export function composeItemsPriceAsk(names: readonly string[]): AssistantAnswer {
  return {
    lines: [
      line('assistant.guided.itemsPriceAsk', {
        names: joinNames(names),
        example: names[0] ?? '',
      }),
      line('assistant.guided.escape'),
    ],
  }
}

// ===========================================================================
// composeGuided — spec §4.8, the never-dead-end reply
// ===========================================================================

/** §4.8's option table — the only intents with a locked-copy `option.*` key. */
const GUIDED_OPTION_KEY: Partial<Record<Intent, string>> = {
  QUERY_MY_BALANCE: 'assistant.guided.option.myBalance',
  QUERY_PAIRWISE: 'assistant.guided.option.pairwise',
  QUERY_GROUP_TOTAL: 'assistant.guided.option.groupTotal',
  QUERY_MY_SPENDING: 'assistant.guided.option.mySpending',
  QUERY_WALLET: 'assistant.guided.option.wallet',
  EXPENSE_ENTRY: 'assistant.guided.option.expense',
  HELP: 'assistant.guided.option.help',
}

/**
 * DECISIONS.md 2026-08-10 erratum (a): a bare `['HELP']` may render the
 * triple. Applied uniformly to ANY `suggest` array of shape `['HELP']`,
 * regardless of provenance — `classify()`'s zero-partial-hit fallback and
 * its `DECOY_PHRASES`-forced `['HELP']` rows are indistinguishable from
 * here (this composer only ever sees the intent-name array, never why it
 * was produced), and the erratum's own text says the substitution is a
 * presentation choice downstream of classify(), not a reclassification —
 * so it is not scoped to one cause.
 */
const ZERO_HIT_TRIPLE: readonly Intent[] = [
  'QUERY_MY_BALANCE',
  'QUERY_GROUP_TOTAL',
  'HELP',
]

export function composeGuided(a: {
  suggest: readonly Intent[]
  hold: boolean
  input: string
  name?: string
  /**
   * True when a confirm/askAmount/crossCurrency card is on screen
   * (`ctx.openCard !== null`, T6 supplies it — this module never sees
   * `OpenCard` itself). Erratum (c), §4.8 addendum: with a card open and
   * zero renderable options, the reply opens with `cardOpenAck` instead of
   * the generic `ack`, since "did you mean one of these?" followed by
   * nothing is incoherent right next to a card still waiting on a decision.
   */
  cardOpen: boolean
  /**
   * 2026-08-14: the sentence named the DOMAIN without a request
   * ("정산할래") — open engaged with the topic ("정산이요! 어떤 걸
   * 도와드릴까요?"), never the confused ack. Options still follow.
   */
  topic?: 'settle'
}): AssistantAnswer {
  if (a.hold) return { lines: [line('assistant.guided.hold')] }

  const suggest =
    a.suggest.length === 1 && a.suggest[0] === 'HELP'
      ? ZERO_HIT_TRIPLE
      : a.suggest

  // Filter to renderable options FIRST, cap at three AFTER — capping the
  // raw `suggest` array first could drop a later, renderable entry in
  // favor of an earlier one with no §4.8 copy (e.g. `CONFIRM_MODIFY`),
  // under-filling the reply below three even when a valid 4th existed.
  const options: AssistantAnswerLine[] = []
  for (const intent of suggest) {
    if (options.length >= 3) break
    const key = GUIDED_OPTION_KEY[intent]
    if (key === undefined) continue // divergence #3 — no locked copy for this intent
    if (intent === 'QUERY_PAIRWISE') {
      if (a.name === undefined) continue
      options.push(line(key, { name: a.name }))
    } else if (intent === 'EXPENSE_ENTRY') {
      options.push(line(key, { input: a.input }))
    } else {
      options.push(line(key))
    }
  }

  const lines: AssistantAnswerLine[] =
    a.cardOpen && options.length === 0
      ? [line('assistant.guided.cardOpenAck')]
      : [
          line(a.topic === 'settle' ? 'assistant.guided.settleAck' : 'assistant.guided.ack'),
          ...options,
        ]
  lines.push(line('assistant.guided.escape'))
  return { lines }
}

// ===========================================================================
// MONEY_KEYS — the render-layer contract every `money()` call site adds to
// ===========================================================================

/**
 * Every `assistant.*` key whose `values.amount` is a RAW minor-units
 * decimal string (paired with `values.currency`), not display text — i.e.
 * every key produced via the internal `money()` helper above. T6's render
 * layer MUST check `MONEY_KEYS.has(line.key)` and, when true, replace
 * `values.amount` with `formatMinor(BigInt(values.amount), values.currency)`
 * BEFORE calling `t(line.key, values)` — passing these straight through
 * would print raw minor units ("35000") instead of "35,000원"/"$350.00".
 * `compose.test.ts`'s MONEY_KEYS invariant test cross-checks this list
 * against every composer branch actually exercised, so this and `money()`'s
 * call sites cannot silently drift apart.
 */
export const MONEY_KEYS: ReadonlySet<string> = new Set([
  'assistant.balance.owesLine',
  'assistant.balance.owesTotal',
  'assistant.balance.receivesLine',
  'assistant.balance.receivesTotal',
  'assistant.pairwise.youOwe',
  'assistant.pairwise.theyOwe',
  'assistant.groupTotal.sum',
  'assistant.groupTotal.sumWithCount',
  'assistant.groupTotal.perPerson',
  'assistant.groupTotal.transferLine',
  'assistant.mySpending.paid',
  'assistant.mySpending.consumed',
  'assistant.mySpending.ahead',
  'assistant.mySpending.behind',
  'assistant.wallet.one',
  'assistant.wallet.line',
  'assistant.wallet.overdrawn',
  'assistant.confirm.saved',
  'assistant.confirm.updatedAmount',
  'assistant.confirm.itemPriced',
  'assistant.history.row',
  'assistant.history.totalLine',
  'assistant.explain.rowEven',
  'assistant.explain.rowItems',
])
