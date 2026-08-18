/**
 * Shared types for the settlement engine.
 *
 * Money convention (docs/DECISIONS.md): every amount is a bigint in integer
 * minor units of its currency. Rates are exact bigint rationals expressed in
 * MINOR units: settlement minor units per 1 foreign minor unit.
 */

export type MemberId = string

export type WalletId = string

/** ISO 4217 alphabetic currency code, e.g. "KRW". */
export type CurrencyCode = string

export interface Money {
  amount: bigint
  currency: CurrencyCode
}

export type RateMode = 'AVG_COST' | 'MARKET'

/**
 * How a prepaid pot holds its money. All three are "exchanged before
 * spending", which is the only distinction the maths cares about — a travel
 * card loaded at 913 KRW per 100 JPY is banknotes as far as rates go.
 */
export type WalletType = 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID'

/** Which rate a conversion actually used (rendered as chips). */
export type RateSource =
  | 'WALLET_AVG_COST'
  | 'MARKET_SNAPSHOT'
  | 'ACTUAL_CHARGED'
  | 'MARKET_FALLBACK'
  // Prepaid money the payer holds no wallet for: they typed the rate they
  // actually got when they exchanged it. Not a market rate and not a bank
  // figure — a number the app has no way to look up.
  | 'OWN_EXCHANGE_RATE'
  // The receipt was paid from more than one source, so there is no single
  // rate to name. Each portion converted at its own; the breakdown lists
  // them. Never render a rate figure beside this one.
  | 'SPLIT_FUNDING'

/** Exact rational amount in minor units: num / den (den > 0; num signed). */
export interface Ratio {
  num: bigint
  den: bigint
}

/** Exact rational rate: settlement minor units per foreign minor unit. */
export interface Rate {
  numerator: bigint
  denominator: bigint
}

export interface RateResult {
  rate: Rate
  /** True when the wallet had no top-ups and the market rate was used. */
  usedFallback: boolean
}

/** A wallet's identity, DB-agnostic. The label reaches the UI via RateResolution. */
export interface WalletInfo {
  id: WalletId
  memberId: MemberId
  type: WalletType
  label: string
  currency: CurrencyCode
}

/** One top-up of one wallet (DB-agnostic subset of ExchangeRecord). */
export interface ExchangeRecordInput {
  walletId: WalletId
  /** What the member paid, in settlement-currency minor units. */
  amountPaid: bigint
  /** What the wallet received, in the wallet's currency minor units. */
  amountReceived: bigint
  currency: CurrencyCode
}

/**
 * How one receipt line is divided among the people who had it.
 *
 * `BY_QUANTITY` is the ordinary case and the default: people take whole
 * units, and the line is split in proportion to them.
 *
 * `BY_AMOUNT` exists because whole units do not always go round — 5 skewers
 * between 2 people. Inventing a quantity of 2.5 would put a fraction in an
 * integer column, and leaving the fifth skewer unassigned is what "Everyone"
 * used to do and is not what the word means. So the line's MONEY is divided
 * instead, and each person's amount is stored outright.
 */
export type ItemSplitMode = 'BY_QUANTITY' | 'BY_AMOUNT'

export interface ItemAssigneeInput {
  memberId: MemberId
  /** Units this member took. Must be >= 1; anything else is ignored. */
  quantity: number
  /**
   * BY_AMOUNT only: this member's share of the line, in the expense
   * currency's minor units. These sum exactly to the line total, so the
   * engine takes them as given rather than deriving anything from
   * `quantity`. Undefined under BY_QUANTITY.
   */
  amount?: bigint
}

export interface ExpenseItemInput {
  name: string
  /** Price of ONE unit, in the expense currency's minor units. */
  unitAmount: bigint
  /** Units on the receipt line. Must be >= 1. ALWAYS an integer. */
  quantity: number
  /** Defaults to BY_QUANTITY, which is how every line before Phase 4D-A. */
  splitMode?: ItemSplitMode
  /** Who had it and how many each; empty = unassigned line (tax, etc.). */
  assignees: ItemAssigneeInput[]
}

/**
 * One source an expense's money came from, and everything needed to price it.
 *
 * A travel card holding ¥50,000 cannot pay an ¥82,000 receipt on its own, and
 * the rest is not a rounding detail: the funding source decides the RATE, so
 * converting the whole ¥82,000 at the card's average cost overcharges the
 * group for money that never touched the card.
 */
export interface FundingSourceInput {
  /** Minor units of the EXPENSE currency paid from this source. */
  amount: bigint
  /**
   * Who fronted THIS portion. Undefined means the expense's payer, which is
   * what every portion meant before a receipt could be co-funded and is still
   * what the DB stores for one.
   *
   * "My card ran out so Bob paid the rest" had nowhere to live: `payerId` was
   * the only member money could come from. Entering it as a second expense —
   * the group's usual workaround — makes one dinner look like two and divides
   * the receipt's items wrongly, so the portion carries its own funder here
   * instead.
   */
  memberId?: MemberId
  /**
   * A wallet id means this portion was prepaid — exchanged before the trip
   * and drawn down from that wallet, so it converts at that wallet's average
   * cost. Null means pay-as-you-go: an ordinary card the bank converts at
   * purchase time.
   */
  walletId: WalletId | null
  /**
   * Settlement minor units the payer's bank actually billed for THIS portion
   * (pay-as-you-go). In AVG_COST mode it supersedes the snapshot conversion;
   * MARKET mode ignores it for group fairness (see README).
   */
  actualChargedAmount?: bigint
  /**
   * The rate the payer themselves got when they exchanged the money, for
   * PREPAID spending they hold no wallet for — settlement MAJOR units per 1
   * foreign MAJOR unit, the same storage form as `marketRateSnapshot`.
   *
   * Set only alongside `walletId: null`, which is the pairing that
   * distinguishes it from pay-as-you-go. Requiring a wallet before a coffee
   * can be recorded is worse than the problem it solves, but the app still
   * must not pretend the market rate applies to money bought at a different
   * one. MARKET mode ignores it, like everything else that is one member's
   * own cost.
   */
  ownRateSnapshot?: string
}

export interface ExpenseInput {
  payerId: MemberId
  /** Total in `currency` minor units (negative = refund; never zero). */
  amount: bigint
  currency: CurrencyCode
  /**
   * Where the money came from, in portions that sum to `amount`. This is the
   * truth whenever it is present, and it is what the DB stores.
   *
   * Omit it and the expense had a SINGLE source, described by the three flat
   * fields below — the shape every expense had before a receipt could be paid
   * from two places, and still the shape a caller writing one by hand wants.
   * `fundingSources()` is the one place that normalises the two.
   */
  funding?: FundingSourceInput[]
  /** Single-source shorthand: see `funding`. */
  walletId?: WalletId | null
  /** Single-source shorthand: see `funding` and `FundingSourceInput`. */
  actualChargedAmount?: bigint
  /** Single-source shorthand: see `funding` and `FundingSourceInput`. */
  ownRateSnapshot?: string
  /**
   * Market rate foreign -> settlement captured at input time, as a decimal
   * string in MAJOR units per MAJOR unit (e.g. "9.205" KRW per JPY).
   */
  marketRateSnapshot: string
  /** Members sharing this expense (used for equal-split fallbacks). */
  participantIds: MemberId[]
  /** Receipt line items; empty = split the whole amount equally. */
  items: ExpenseItemInput[]
}

/** Everything settlement math needs besides the expenses themselves. */
export interface SettlementContext {
  settlementCurrency: CurrencyCode
  /** Every wallet in play; the label travels out on the rate source. */
  walletsById: Map<WalletId, WalletInfo>
  /** Each wallet's top-ups; wallets absent here have none. */
  recordsByWallet: Map<WalletId, ExchangeRecordInput[]>
}

export interface RateResolution {
  rate: Rate
  source: RateSource
  /** The wallet the rate came from, for "your Travel Wallet rate" copy. */
  walletLabel?: string
}

export interface ConvertedMoney extends Money {
  source: RateSource
  walletLabel?: string
}

export interface Transfer {
  from: MemberId
  to: MemberId
  /** Settlement-currency minor units, always positive. */
  amount: bigint
}
