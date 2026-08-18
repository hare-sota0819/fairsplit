import { minorToDecimalInput } from '@/lib/format'
import { effectiveItemAmount } from './invariant'
import type { ParsedReceipt, ReceiptItem } from './schema'

/**
 * Parsed receipt -> the wizard's item rows, PHASE5_RECEIPT_PROMPT.md §156.
 *
 * The confirm screen hands over to the EXISTING item-assignment step, so this
 * has to produce exactly what a hand-typed line produces: a unit price as
 * text, an integer quantity, and no assignments yet.
 */

/** Mirrors `ItemState` in the wizard, without importing a client module. */
export interface HandoffItem {
  key: number
  name: string
  /** UNIT price as text, in the expense currency's display form. */
  unitAmount: string
  quantity: number
  splitMode: 'BY_QUANTITY'
  assignees: never[]
}

/**
 * How one parsed line becomes a row.
 *
 * `ExpenseItem` has no modifier concept and stores a per-unit integer price
 * (OPEN_QUESTIONS.md #4), so modifiers fold into the line's effective amount
 * first. The quantity is then only kept when the folded amount divides by it
 * exactly — otherwise the row collapses to a single unit priced at the whole
 * line, because the money has to stay right even when the unit price cannot
 * be represented. A "large +150" modifier on a 2x ramen line is exactly this
 * case: 2670/2 is fine, 2595/2 is not.
 */
export function itemToRow(item: ReceiptItem, key: number, currency: string): HandoffItem {
  const amount = effectiveItemAmount(item)
  const divisible = item.quantity > 0 && amount % item.quantity === 0
  const quantity = divisible ? item.quantity : 1
  const unit = divisible ? amount / item.quantity : amount
  return {
    key,
    name: item.name,
    unitAmount: minorToDecimalInput(BigInt(unit), currency),
    quantity,
    splitMode: 'BY_QUANTITY',
    assignees: [],
  }
}

export interface Handoff {
  items: HandoffItem[]
  nextKey: number
  /** Expense total as input text, for the amount field. */
  amount: string
}

/**
 * Build the wizard patch for a confirmed receipt.
 *
 * @param startKey the wizard's `nextKey`, so rows never collide with any the
 *                 user typed by hand before scanning.
 */
export function receiptToWizardPatch(
  receipt: ParsedReceipt,
  currency: string,
  startKey: number,
): Handoff {
  const items = receipt.items.map((item, index) => itemToRow(item, startKey + index, currency))
  // The total the user confirmed on the receipt screen wins. It has already
  // passed the total-match invariant, so it agrees with the item sum.
  const total = receipt.totalMinor ?? receipt.items.reduce((s, i) => s + effectiveItemAmount(i), 0)
  return {
    items,
    nextKey: startKey + items.length,
    amount: minorToDecimalInput(BigInt(total), currency),
  }
}
