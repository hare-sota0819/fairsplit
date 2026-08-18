import { parseAmountToMinor } from '@/lib/format'
import { convertAtDisplayRate, displayRateToStorage } from '@/lib/rate-units'
import type { FundingSource } from '@/lib/schemas/expense'
import {
  allocateEveryone,
  consumedShares,
  convertExpense,
  explainShares,
  itemsTotal,
  validateReceipt,
  type ExpenseInput,
  type ExpenseItemInput,
  type ItemSplitMode,
  rateToDecimalString,
  type RateSource,
  type SettlementContext,
  type ShareExplanation,
} from '@/lib/settlement'
import type { FormWallet } from '../form-props'

export interface ItemState {
  key: number
  name: string
  /** Unit price as typed. NOT the line total. */
  unitAmount: string
  quantity: number
  /**
   * How this line divides. Only "Everyone" ever sets BY_AMOUNT, and only
   * when the units will not go round; any hand assignment puts it back to
   * BY_QUANTITY. The per-person AMOUNTS are deliberately NOT held here —
   * they are derived from the current unit price, quantity and member set
   * every time they are needed, so editing the price after tapping
   * "Everyone" cannot leave a stale split behind.
   */
  splitMode: ItemSplitMode
  assignees: { memberId: string; quantity: number }[]
}

/**
 * One source BEYOND the primary one, and how much of the expense it covered.
 *
 * The primary source has no amount of its own: it covers whatever is left
 * once these are taken off. That is not a shortcut — it is what makes "the
 * portions add up to the expense" true by construction rather than by
 * validation, which is the invariant the settlement engine refuses to price
 * an expense without.
 */
export interface ExtraFunding {
  key: number
  /** As typed, in the expense's currency. Always positive. */
  amount: string
  source: FundingSource
  /** The rate this portion was exchanged at (PREPAID_NO_WALLET only). */
  ownRate: string
  /**
   * Who fronted this portion, when it was not the payer. Empty means the
   * payer — the only answer there was before a receipt could be co-funded.
   */
  memberId: string
}

export interface WizardState {
  step: number
  /** Furthest step reached, so already-seen steps stay tappable. */
  maxStep: number
  amount: string
  currency: string
  payerId: string
  funding: FundingSource
  /** Sources beyond the primary one; see ExtraFunding. */
  extraFunding: ExtraFunding[]
  note: string
  /** Device-local wall clock as the datetime input holds it. */
  timestamp: string
  participantIds: string[]
  items: ItemState[]
  nextKey: number
  isPersonal: boolean
  /**
   * Object path of the receipt photo in storage, set by the scan flow. Null
   * for a hand-typed expense. Travels through the wizard so the photo
   * attaches even when parsing failed and the items were typed by hand.
   */
  receiptImagePath: string | null
  /**
   * The payer's OWN exchange rate as typed, in the currency's quote unit —
   * only for PREPAID_NO_WALLET. `actualCharged` used to live here; the bank
   * figure moved to the expense detail screen, because nobody opens their
   * banking app mid-dinner and the statement has not posted yet anyway.
   */
  ownRate: string
  /**
   * A TOP-UP MADE AT THE TILL. When the card cannot cover the bill, what
   * people actually do is exchange more money on the spot and then pay — so
   * the wizard offers that as the first answer, ahead of splitting the
   * receipt across sources. `topUpAmount` is in the wallet's currency (which
   * is the expense currency, or the wallet could not be paying), `topUpRate`
   * is the rate they got in the currency's quote unit, and `topUpPaid` is
   * the settlement-currency cost — empty while the rate computes it, a
   * string once the user types over it.
   *
   * It becomes an ordinary exchange record on save, dated to the expense.
   * That is not a shortcut: the money really was exchanged, so it belongs to
   * the wallet's history whatever later happens to this receipt.
   */
  topUpAmount: string
  topUpRate: string
  topUpPaid: string
  manualOpen: boolean
  manualRate: string
  receiptTotal: string
  receiptTouched: boolean
}

/**
 * Stable string key for a funding source, so it can drive a `<select>` or a
 * toggle group, and its inverse. They live here rather than beside either
 * control because both the wizard step and its dialog need them, and a shared
 * helper is not something a screen should have to import from another screen.
 */
export function fundingKey(source: FundingSource): string {
  return source.kind === 'WALLET' ? `wallet:${source.walletId}` : source.kind
}

export function sourceFromKey(key: string): FundingSource {
  if (key.startsWith('wallet:')) {
    return { kind: 'WALLET', walletId: key.slice('wallet:'.length) }
  }
  return key === 'PREPAID_NO_WALLET'
    ? { kind: 'PREPAID_NO_WALLET' }
    : { kind: 'PAY_AS_YOU_GO' }
}

/** A top-up typed into the payment step but not yet saved. */
export interface PendingTopUp {
  walletId: string
  /** Wallet-currency minor units it puts on the card. */
  received: bigint
  /** Settlement-currency minor units it cost. */
  paid: bigint
}

/**
 * The at-the-till top-up, once it is complete enough to mean anything.
 *
 * Null unless the primary source IS a wallet holding this expense's
 * currency and both figures parse to something positive — a half-typed rate
 * must not move the balance the step is reasoning about.
 */
export function pendingTopUp(
  state: WizardState,
  wallets: FormWallet[],
  settlementCurrency: string,
): PendingTopUp | null {
  if (state.funding.kind !== 'WALLET') return null
  const walletId = state.funding.walletId
  const wallet = wallets.find((w) => w.id === walletId)
  if (!wallet || wallet.currency !== state.currency) return null
  const received = parseAmountToMinor(state.topUpAmount, wallet.currency)
  if (received === null || received <= 0n) return null
  const paid = state.topUpPaid
    ? parseAmountToMinor(state.topUpPaid, settlementCurrency)
    : convertAtDisplayRate(
        received,
        state.topUpRate,
        wallet.currency,
        settlementCurrency,
      )
  if (paid === null || paid <= 0n) return null
  return { walletId, received, paid }
}

/** What /api/rates answered, plus what it considers today. */
export interface MarketQuote {
  rate: string | null
  asOf: string | null
  /**
   * The source's exact timestamp when it publishes one — the live primary
   * restamps every minute. Null when the daily-fixing fallback answered, or
   * for a same-currency expense that was never looked up.
   */
  asOfInstant?: string | null
  today: string | null
}

/** One funding portion as the preview prices it. */
export interface PortionMath {
  /** React key: the extra's own key, or 'primary'. */
  key: string
  /** This portion in the expense currency's minor units. */
  amount: bigint
  /** Storage-unit rate it converts at; null while unknown. */
  rate: string | null
  source: RateSource
  /** The wallet it was drawn from, when one was. */
  wallet: FormWallet | null
}

export interface ExpenseMath {
  foreign: boolean
  /** The wallet the money is coming from, when one was chosen. */
  wallet: FormWallet | null
  /** Storage-unit rate this expense will convert at; null until known. */
  effectiveRate: string | null
  /** Which of the engine's rate sources that corresponds to. */
  rateSource: RateSource
  /**
   * Every portion, primary first. One entry is the ordinary case; more than
   * one is a receipt paid from several places, and then `effectiveRate` is
   * null and `rateSource` is SPLIT_FUNDING, because no single rate covers it.
   */
  portions: PortionMath[]
  /**
   * What the PRIMARY source covers: the total minus every extra. Negative
   * means the extras overshoot the expense, which the step blocks on.
   */
  primaryAmount: bigint | null
  amountMinor: bigint | null
  /** Parsed items; null while any unit price is unparseable. */
  engineItems: ExpenseItemInput[] | null
  /** Sum of unit price x quantity over every line. */
  itemsSum: bigint | null
  /** items total minus the receipt total; null when they agree or unknown. */
  discrepancy: bigint | null
  /**
   * What is still unaccounted for: the expense total minus the items entered
   * so far. Positive = that much left to itemise, negative = over.
   *
   * Distinct from `discrepancy`, which is null the moment the two agree —
   * fine for the review step's "do these match?" question, useless for the
   * ITEMS step, where the whole point is to watch the number fall to zero
   * while typing. Null only when either side is unknown.
   */
  remaining: bigint | null
  /** Converted total in the settlement currency. */
  total: bigint | null
  /** Per-member settlement figures (payer included). */
  shares: Map<string, bigint>
  /** Per-member working, in the EXPENSE's currency. */
  explanations: Map<string, ShareExplanation>
}

const EMPTY_CONTEXT = (settlementCurrency: string): SettlementContext => ({
  settlementCurrency,
  walletsById: new Map(),
  recordsByWallet: new Map(),
})

/**
 * Everything the wizard needs to show a number, derived in ONE place.
 *
 * The rate is resolved here the same way `resolveRate` resolves it on the
 * server, then handed to the real engine as a snapshot so the preview and
 * the saved result cannot drift: a manual override wins, then a prepaid
 * wallet's own average cost, then the market rate — except in MARKET mode,
 * where the group has decided the wallet is irrelevant.
 */
export function computeMath(
  state: WizardState,
  options: {
    wallets: FormWallet[]
    settlementCurrency: string
    rateMode: 'AVG_COST' | 'MARKET'
    /**
     * Before the payment question has been ANSWERED, preview at the market
     * rate.
     *
     * `state.funding` is pre-seeded from whatever this payer used last, so
     * without this the very first screen quoted a specific wallet's average
     * cost — a number the user had not chosen and might not even own a
     * wallet for. The preview is not wrong once the wallet IS chosen; it was
     * wrong to assume the answer.
     */
    previewAtMarket?: boolean
  },
  market: MarketQuote | null,
): ExpenseMath {
  const foreign = state.currency !== options.settlementCurrency
  const funding = state.funding
  const walletFor = (source: FundingSource): FormWallet | null =>
    source.kind === 'WALLET'
      ? (options.wallets.find((w) => w.id === source.walletId) ?? null)
      : null
  const wallet = walletFor(funding)

  const manualStorage =
    state.manualOpen && state.manualRate
      ? displayRateToStorage(state.manualRate, state.currency)
      : null
  const marketRate = foreign ? (market?.rate ?? null) : '1'

  const topUp = options.previewAtMarket
    ? null
    : pendingTopUp(state, options.wallets, options.settlementCurrency)
  const amountMinor = parseAmountToMinor(state.amount, state.currency)
  // The snapshot that WOULD be stored: a manual override if one was typed,
  // otherwise the looked-up rate.
  const snapshot = manualStorage ?? marketRate

  /**
   * Mirrors `resolveSourceRate` on the server, branch for branch. Getting the
   * precedence wrong here is not cosmetic: the preview would promise a number
   * the save would not produce. In particular a manual override sets the
   * MARKET snapshot only — in AVG_COST mode a prepaid wallet still settles at
   * what that wallet's money cost.
   */
  const rateFor = (
    source: FundingSource,
    ownRateText: string,
  ): {
    rate: string | null
    rateSource: RateSource
    wallet: FormWallet | null
  } => {
    const sourceWallet = walletFor(source)
    // Prepaid money with no wallet behind it: the payer's own rate is their
    // cost, so it outranks the market snapshot. Ignored in MARKET mode, like
    // every other per-member cost.
    const ownStorage =
      options.rateMode === 'AVG_COST' &&
      source.kind === 'PREPAID_NO_WALLET' &&
      ownRateText &&
      !options.previewAtMarket
        ? displayRateToStorage(ownRateText, state.currency)
        : null
    // Drawn from an actual pot. PREPAID_NO_WALLET is prepaid but has no pot,
    // so it must NOT reach the wallet branch: the server keys that branch on
    // a non-null walletId, and calling the result "market (fallback)" would
    // blame a wallet that does not exist.
    const fromWallet =
      (source.kind === 'WALLET' || source.kind === 'NEW_CASH_WALLET') &&
      !options.previewAtMarket
    if (!foreign) {
      return { rate: '1', rateSource: 'MARKET_SNAPSHOT', wallet: sourceWallet }
    }
    if (ownStorage !== null) {
      return {
        rate: ownStorage,
        rateSource: 'OWN_EXCHANGE_RATE',
        wallet: sourceWallet,
      }
    }
    if (options.rateMode === 'AVG_COST' && fromWallet) {
      // A top-up made at the till is part of this wallet's cost the moment
      // it is saved, so the preview has to blend it in — otherwise the
      // screen quotes the old average and the save produces another number.
      const blended =
        topUp !== null &&
        sourceWallet !== null &&
        topUp.walletId === sourceWallet.id
          ? rateToDecimalString(
              {
                numerator: BigInt(sourceWallet.topUpPaidMinor) + topUp.paid,
                denominator:
                  BigInt(sourceWallet.topUpReceivedMinor) + topUp.received,
              },
              options.settlementCurrency,
              sourceWallet.currency,
              12,
            )
          : null
      const walletRate = blended ?? sourceWallet?.avgRate ?? null
      return {
        rate: walletRate ?? snapshot,
        rateSource: walletRate ? 'WALLET_AVG_COST' : 'MARKET_FALLBACK',
        wallet: sourceWallet,
      }
    }
    return {
      rate: snapshot,
      rateSource: 'MARKET_SNAPSHOT',
      wallet: sourceWallet,
    }
  }

  // Extras first: the primary covers whatever they leave, so its amount is
  // not known until they are counted.
  const extras = state.extraFunding.map((extra) => ({
    key: `extra-${extra.key}`,
    amount: parseAmountToMinor(extra.amount, state.currency),
    ...rateFor(extra.source, extra.ownRate),
  }))
  const extrasTotal = extras.reduce(
    (sum, extra) =>
      sum === null || extra.amount === null ? null : sum + extra.amount,
    0n as bigint | null,
  )
  const primaryAmount =
    amountMinor === null || extrasTotal === null
      ? null
      : amountMinor - extrasTotal
  const primaryRate = rateFor(funding, state.ownRate)

  const portions: PortionMath[] =
    primaryAmount === null || primaryAmount < 0n
      ? []
      : [
          // A primary of exactly zero is dropped: the extras cover the whole
          // receipt on their own, and a zero portion has no rate to resolve.
          ...(primaryAmount === 0n
            ? []
            : [{ key: 'primary', amount: primaryAmount, ...primaryRate }]),
          ...extras.map((extra) => ({ ...extra, amount: extra.amount! })),
        ].map(({ key, amount, rate, rateSource, wallet: portionWallet }) => ({
          key,
          amount,
          rate,
          source: rateSource,
          wallet: portionWallet,
        }))

  // With several sources there IS no single rate, and saying there is one is
  // the defect this whole change exists to remove. With exactly one, the
  // answer describes THAT portion — which is not always the primary: extras
  // covering the whole receipt leave the primary paying for none of it, and
  // naming it would be its own small lie. With none (nothing typed yet, or
  // portions that overshoot) the primary's answer stands in, so step 1 can
  // still quote a rate before an amount exists.
  const single = portions.length === 1 ? portions[0] : null
  const effectiveRate =
    portions.length > 1 ? null : (single?.rate ?? primaryRate.rate)
  const rateSource: RateSource =
    portions.length > 1
      ? 'SPLIT_FUNDING'
      : (single?.source ?? primaryRate.rateSource)

  const engineItems = parseItems(state.items, state.currency, state.payerId)
  const itemsSum = engineItems === null ? null : itemsTotal(engineItems)

  const receiptText = state.receiptTouched ? state.receiptTotal : state.amount
  const receiptMinor = parseAmountToMinor(receiptText, state.currency)
  const discrepancy =
    engineItems === null || engineItems.length === 0 || receiptMinor === null
      ? null
      : (() => {
          const result = validateReceipt(engineItems, receiptMinor)
          return result.ok ? null : result.discrepancy
        })()
  const remaining =
    itemsSum === null || receiptMinor === null ? null : receiptMinor - itemsSum

  const empty: ExpenseMath = {
    foreign,
    // The wallet the single rate above belongs to, so a label can never name
    // a pot that priced none of the receipt.
    wallet: single?.wallet ?? wallet,
    effectiveRate,
    rateSource,
    portions,
    primaryAmount,
    amountMinor,
    engineItems,
    itemsSum,
    discrepancy,
    remaining,
    total: null,
    shares: new Map(),
    explanations: new Map(),
  }
  // A bank-billed figure IS the conversion, so it can stand in even when the
  // market lookup failed; every other source needs a rate to work with.
  if (
    amountMinor === null ||
    amountMinor === 0n ||
    portions.length === 0 ||
    portions.some((portion) => portion.rate === null) ||
    engineItems === null ||
    state.participantIds.length === 0
  ) {
    return empty
  }

  const participantIds = state.isPersonal
    ? [state.payerId]
    : state.participantIds
  const expense: ExpenseInput = {
    payerId: state.payerId,
    amount: amountMinor,
    currency: state.currency,
    marketRateSnapshot: portions[0].rate ?? '1',
    // Every rate is already resolved above, so the preview runs the engine
    // with an empty wallet context and hands each portion its own rate
    // through the own-rate branch — the one branch that prices a walletless
    // portion at a number it is given rather than one it looks up.
    funding: portions.map((portion) => ({
      amount: portion.amount,
      walletId: null,
      ownRateSnapshot: portion.rate ?? '1',
    })),
    participantIds,
    items: state.isPersonal ? [] : engineItems,
  }
  const context = EMPTY_CONTEXT(options.settlementCurrency)
  try {
    return {
      ...empty,
      total: convertExpense(expense, 'AVG_COST', context).amount,
      shares: consumedShares(expense, 'AVG_COST', context),
      explanations: explainShares(expense),
    }
  } catch {
    return empty
  }
}

function parseItems(
  items: ItemState[],
  currency: string,
  payerId: string,
): ExpenseItemInput[] | null {
  const parsed: ExpenseItemInput[] = []
  for (const item of items) {
    const unitAmount = parseAmountToMinor(item.unitAmount, currency)
    if (unitAmount === null) return null
    parsed.push({
      name: item.name,
      unitAmount,
      quantity: item.quantity,
      ...divideLine(item, unitAmount, payerId),
    })
  }
  return parsed
}

/**
 * Resolve a line's assignees for the engine, deriving the BY_AMOUNT shares
 * rather than carrying them in form state. `saveExpense` calls the same
 * `allocateEveryone` on the same inputs, so the preview cannot promise a
 * split the save will not produce.
 */
export function divideLine(
  item: Pick<ItemState, 'splitMode' | 'quantity' | 'assignees'>,
  unitAmount: bigint,
  payerId: string,
): { splitMode: ItemSplitMode; assignees: ExpenseItemInput['assignees'] } {
  if (item.splitMode !== 'BY_AMOUNT' || item.assignees.length === 0) {
    return { splitMode: 'BY_QUANTITY', assignees: item.assignees }
  }
  return allocateEveryone(
    { quantity: item.quantity, unitAmount },
    item.assignees.map((a) => a.memberId),
    payerId,
  )
}
