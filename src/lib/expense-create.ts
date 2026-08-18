/**
 * The expense CREATE argument, in one place — and pure, so it can be pinned.
 *
 * There are two callers, and there must never be a third shape between them:
 * the wizard/chat save (`saveExpense`, expenses/actions.ts) and the chat's
 * currency swap (`applyCurrencyChange`, chat-edit-actions.ts), which cancels
 * an expense and re-creates it in the currency the user asked for. The swap
 * re-creating the row by hand is exactly how a "new" expense would quietly
 * miss a column the save path fills — so it does not: both build their create
 * argument here, and `expense-create.test.ts` pins every field of it.
 *
 * The rate that prices a new expense used to live here too; it moved to
 * `expense-snapshot-rate.ts` (review round 1) precisely so this module could
 * stay a pure function of its input — it reaches the database and the rate
 * provider, and a module that does cannot be unit-tested against a fixture.
 *
 * It lives in `src/lib` rather than beside `saveExpense` for the same reason
 * `expense-cancel.ts` does: both callers are `'use server'` modules, and a
 * Server Actions file may only export async functions.
 */
import type { ItemSplitMode } from '@/lib/settlement'

/** One receipt line, already in Prisma's nested-create shape (the same value
 *  `saveExpense` builds once and uses for both its update and its create). */
export interface ExpenseItemCreate {
  name: string
  unitAmount: bigint
  quantity: number
  splitMode: ItemSplitMode
  assignments: {
    create: { memberId: string; quantity: number; amount: bigint | null }[]
  }
}

/** One funding portion. `position` 0 is the primary; the portions sum to the
 *  expense's amount by construction, which is the caller's invariant to keep. */
export interface ExpenseFundingCreate {
  position: number
  amount: bigint
  walletId: string | null
  ownRateSnapshot: string | null
  funderId: string | null
  /** The bank's own figure, when one is already known — only ever carried
   *  over by an EDIT; a genuinely new expense has none. */
  actualChargedAmount?: bigint | null
}

export interface NewExpenseInput {
  groupId: string
  title: string
  payerId: string
  amount: bigint
  currency: string
  timestamp: Date
  /** Decimal string, foreign → settlement. Immutable after this write. */
  marketRateSnapshot: string
  marketRateProvisional: boolean
  note: string | null
  isPersonal: boolean
  receiptImagePath: string | null
  /** Who typed it in — not necessarily the payer. */
  enteredById: string
  participantIds: string[]
  items: ExpenseItemCreate[]
  funding: ExpenseFundingCreate[]
}

/** The `data` for `prisma.expense.create`, participants/items/funding nested
 *  exactly as the save path has always nested them. */
export function expenseCreateData(input: NewExpenseInput) {
  return {
    groupId: input.groupId,
    title: input.title,
    payerId: input.payerId,
    amount: input.amount,
    currency: input.currency,
    timestamp: input.timestamp,
    marketRateSnapshot: input.marketRateSnapshot,
    marketRateProvisional: input.marketRateProvisional,
    note: input.note,
    isPersonal: input.isPersonal,
    receiptImagePath: input.receiptImagePath,
    enteredById: input.enteredById,
    participants: {
      create: input.participantIds.map((memberId) => ({ memberId })),
    },
    items: { create: input.items },
    funding: { create: input.funding },
  }
}
