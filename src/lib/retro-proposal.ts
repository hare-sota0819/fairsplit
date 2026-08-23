import type { DerivedFundingRow, DerivedItemRow } from '@/lib/expense-derive'
import type { ExpenseInput, ItemSplitMode, RateSource } from '@/lib/settlement'

/**
 * A proposed change, in the shape it is STORED in, and the projection of it
 * the settlement engine prices.
 *
 * Everything here exists to serve one sentence of the spec: "the diff shown to
 * approvers must be identical at request time and approval time". That holds
 * only if the proposal is frozen the moment it is made — the rows AND the
 * rates — so nothing between the two moments can reach it. A wallet topped up
 * while a request sits pending must not quietly reprice what people are being
 * asked to agree to.
 *
 * Money crosses JSON as DECIMAL STRINGS, never numbers. A `bigint` put through
 * `JSON.stringify` throws, and the "fix" someone reaches for is `Number(...)`,
 * which silently loses precision above 2^53 — in a column holding won, that is
 * a real trip's worth of money.
 */

/** One funding portion of a proposal, with the rate it will be frozen at. */
export interface ProposedFunding {
  position: number
  /** Expense-currency minor units. */
  amount: string
  walletId: string | null
  ownRateSnapshot: string | null
  funderId: string | null
  /** The exact rational rate, as it will be written to the freeze columns. */
  frozenRateNum: string
  frozenRateDen: string
  frozenSource: RateSource
  /** Settlement minor units, rounded once. */
  frozenAmount: string
}

export interface ProposedItem {
  name: string
  unitAmount: string
  quantity: number
  splitMode: ItemSplitMode
  assignees: { memberId: string; quantity: number; amount?: string }[]
}

/** The whole of an EDIT proposal, JSON-safe. */
export interface RetroProposal {
  title: string
  payerId: string
  note: string | null
  isPersonal: boolean
  receiptImagePath: string | null
  amount: string
  timestampIso: string
  participantIds: string[]
  items: ProposedItem[]
  funding: ProposedFunding[]
  /** The checkpoint the expense belongs to once the change lands. */
  frozenAtCheckpointId: string | null
}

/** One portion's priced conversion, as `convertFunding` returns it. */
export interface PricedPortion {
  rateNum: bigint
  rateDen: bigint
  source: RateSource
  settlement: bigint
}

export function encodeProposal(input: {
  title: string
  payerId: string
  note: string | null
  isPersonal: boolean
  receiptImagePath: string | null
  amount: bigint
  timestamp: Date
  participantIds: string[]
  items: DerivedItemRow[]
  funding: DerivedFundingRow[]
  /** One per funding row, in the same order. */
  priced: PricedPortion[]
  frozenAtCheckpointId: string | null
}): RetroProposal {
  if (input.priced.length !== input.funding.length) {
    throw new Error('Every proposed funding portion must be priced')
  }
  return {
    title: input.title,
    payerId: input.payerId,
    note: input.note,
    isPersonal: input.isPersonal,
    receiptImagePath: input.receiptImagePath,
    amount: input.amount.toString(),
    timestampIso: input.timestamp.toISOString(),
    participantIds: input.participantIds,
    items: input.items.map((item) => ({
      name: item.name,
      unitAmount: item.unitAmount.toString(),
      quantity: item.quantity,
      splitMode: item.splitMode,
      assignees: item.assignees.map((assignee) => ({
        memberId: assignee.memberId,
        quantity: assignee.quantity,
        ...(assignee.amount === undefined
          ? {}
          : { amount: assignee.amount.toString() }),
      })),
    })),
    funding: input.funding.map((row, index) => ({
      position: row.position,
      amount: row.amount.toString(),
      walletId: row.walletId,
      ownRateSnapshot: row.ownRateSnapshot,
      funderId: row.funderId,
      frozenRateNum: input.priced[index].rateNum.toString(),
      frozenRateDen: input.priced[index].rateDen.toString(),
      frozenSource: input.priced[index].source,
      frozenAmount: input.priced[index].settlement.toString(),
    })),
    frozenAtCheckpointId: input.frozenAtCheckpointId,
  }
}

/**
 * The proposed expense as the engine sees it, for the "after" side of the
 * diff.
 *
 * `frozen` is deliberately NOT set here even though the proposal carries the
 * rates: leaving it off makes the engine resolve the portions live, and the
 * rates it resolves are BY CONSTRUCTION the ones stored (they came out of the
 * same call, at the same moment). The diff is therefore computed by the
 * ordinary code path rather than by a special one that could disagree with it.
 */
export function proposalToEngineExpense(
  proposal: RetroProposal,
  /** Immutable across an edit: an expense never changes what it is priced in. */
  expense: { currency: string; marketRateSnapshot: string },
): ExpenseInput {
  return {
    payerId: proposal.payerId,
    amount: BigInt(proposal.amount),
    currency: expense.currency,
    marketRateSnapshot: expense.marketRateSnapshot,
    funding: proposal.funding.map((row) => ({
      amount: BigInt(row.amount),
      walletId: row.walletId,
      ...(row.ownRateSnapshot === null
        ? {}
        : { ownRateSnapshot: row.ownRateSnapshot }),
      ...(row.funderId === null ? {} : { memberId: row.funderId }),
    })),
    participantIds: proposal.participantIds,
    items: proposal.items.map((item) => ({
      name: item.name,
      unitAmount: BigInt(item.unitAmount),
      quantity: item.quantity,
      splitMode: item.splitMode,
      assignees: item.assignees.map((assignee) => ({
        memberId: assignee.memberId,
        quantity: assignee.quantity,
        ...(assignee.amount === undefined
          ? {}
          : { amount: BigInt(assignee.amount) }),
      })),
    })),
  }
}

/**
 * Whether the proposed expense reaches the balance at all — the same rule as
 * `isSettleable`, asked of a proposal instead of a row. An edit that ticks
 * "personal" takes the expense out of settlement, which is a balance change
 * like any other and has to show up in the diff.
 */
export function proposalIsSettleable(proposal: RetroProposal): boolean {
  return !proposal.isPersonal
}

/** Per-member diff, JSON-safe: minor units as decimal strings. */
export type StoredBalanceDiff = Record<string, string>

export function encodeDiff(
  diff: ReadonlyMap<string, bigint>,
): StoredBalanceDiff {
  return Object.fromEntries(
    [...diff.entries()].map(([memberId, delta]) => [
      memberId,
      delta.toString(),
    ]),
  )
}

export function decodeDiff(stored: StoredBalanceDiff): Map<string, bigint> {
  return new Map(
    Object.entries(stored).map(([memberId, delta]) => [
      memberId,
      BigInt(delta),
    ]),
  )
}
