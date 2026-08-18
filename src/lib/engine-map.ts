import type {
  ExpenseInput,
  FundingSourceInput,
  ItemSplitMode,
} from '@/lib/settlement'

/** One row of the expense's funding list, as Prisma returns it. */
export interface FundingRow {
  /** Portion of the expense, in its currency's minor units. */
  amount: bigint
  /** The prepaid wallet this portion came out of, or null for pay-as-you-go. */
  walletId: string | null
  actualChargedAmount?: bigint | null
  /** Prepaid-with-no-wallet: the rate the payer actually exchanged at. */
  ownRateSnapshot?: { toString(): string } | null
  /** Who fronted this portion; null (or absent) means the expense's payer. */
  funderId?: string | null
}

/**
 * Structural subset of the Prisma expense include shape the engine needs.
 * Kept structural so the mapper stays pure and unit-testable without a DB.
 */
export interface ExpenseRow {
  payerId: string
  amount: bigint
  currency: string
  marketRateSnapshot: { toString(): string }
  /** Where the money came from; the amounts sum to `amount`. */
  funding: FundingRow[]
  participants: { memberId: string }[]
  items: {
    name: string
    unitAmount: bigint
    quantity: number
    /** Absent on a row read before Phase 4D-A added the column. */
    splitMode?: ItemSplitMode
    assignments: {
      memberId: string
      quantity: number
      amount?: bigint | null
    }[]
  }[]
}

/**
 * Whether an expense participates in settlement math: personal spending
 * and cancelled (soft-deleted) expenses never do. Wallet math has its own
 * rule (personal INCLUDED, cancelled excluded) — do not reuse this there.
 */
export function isSettleable(expense: {
  isPersonal: boolean
  cancelledAt: Date | null
}): boolean {
  return !expense.isPersonal && expense.cancelledAt === null
}

/** One funding row in the shape the engine prices portions from. */
export function toEngineFunding(row: FundingRow): FundingSourceInput {
  return {
    amount: row.amount,
    walletId: row.walletId,
    ...(row.actualChargedAmount == null
      ? {}
      : { actualChargedAmount: row.actualChargedAmount }),
    ...(row.ownRateSnapshot == null
      ? {}
      : { ownRateSnapshot: row.ownRateSnapshot.toString() }),
    ...(row.funderId == null ? {} : { memberId: row.funderId }),
  }
}

/** Map a DB expense row (with includes) to the engine's ExpenseInput. */
export function toEngineExpense(row: ExpenseRow): ExpenseInput {
  return {
    payerId: row.payerId,
    amount: row.amount,
    currency: row.currency,
    marketRateSnapshot: row.marketRateSnapshot.toString(),
    funding: row.funding.map(toEngineFunding),
    participantIds: row.participants.map((p) => p.memberId),
    items: row.items.map((item) => ({
      name: item.name,
      unitAmount: item.unitAmount,
      quantity: item.quantity,
      splitMode: item.splitMode ?? 'BY_QUANTITY',
      assignees: item.assignments.map((a) => ({
        memberId: a.memberId,
        quantity: a.quantity,
        ...(a.amount == null ? {} : { amount: a.amount }),
      })),
    })),
  }
}
