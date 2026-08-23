import { toEngineExpense } from '@/lib/engine-map'
import { formatMinor } from '@/lib/format'
import type { GroupData } from '@/lib/group-data'
import { consumedShares } from '@/lib/settlement'

export interface MySpendingRow {
  id: string
  /** The expense's name, falling back to whoever paid for it. */
  title: string
  /** Absolute instant — which day it belongs to is a device-local question. */
  timestampIso: string
  /** This viewer's share, formatted in the settlement currency. */
  amount: string
  personal: boolean
}

/**
 * What I consumed, newest first, and what that adds up to.
 *
 * Personal expenses are IN: this answers "what did I spend on this trip?",
 * not "what do I owe?" — the settlement screens are where the second
 * question lives.
 *
 * Home and the "my spending" screen both render this. They used to derive
 * it separately, which is how home could show a total that the list behind
 * it did not add up to. The order is the order `loadGroupData` returns
 * expenses in (`timestamp desc, id desc`) — purchase order, most recent
 * first (owner, 2026-08-22).
 */
export function mySpending(
  data: Pick<GroupData, 'group' | 'expenses' | 'context' | 'mode'>,
  meId: string,
): { rows: MySpendingRow[]; total: bigint; currency: string } {
  const { group, expenses, context, mode } = data
  const currency = group.settlementCurrency
  const rows: MySpendingRow[] = []
  let total = 0n
  for (const expense of expenses) {
    if (expense.cancelledAt !== null) continue
    const share = consumedShares(toEngineExpense(expense), mode, context).get(
      meId,
    )
    if (share === undefined || share === 0n) continue
    total += share
    rows.push({
      id: expense.id,
      title: expense.title || expense.payer.name,
      timestampIso: expense.timestamp.toISOString(),
      amount: formatMinor(share, currency),
      personal: expense.isPersonal,
    })
  }
  return { rows, total, currency }
}
