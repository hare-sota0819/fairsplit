import type { ParsedReceipt, ReceiptItem } from './schema'

/**
 * The total-match invariant, PHASE5_RECEIPT_PROMPT.md §115-126.
 *
 * The brief states it as `sum(items) + tax + service == total`. That is only
 * right when tax is EXCLUSIVE. Japanese receipts print tax inclusive (内税):
 * the tax line discloses tax already inside the item prices, and adding it
 * again breaks three of the four test receipts and would block saving on
 * nearly every receipt from the trip this is being built for. See
 * OPEN_QUESTIONS.md #1.
 *
 * So tax is added only when we know it is exclusive. When the model could not
 * tell (`taxIncludedInItems === null`) we accept a receipt that balances under
 * EITHER reading — but a receipt that balances under neither still blocks,
 * which is the guarantee §126 actually cares about: numbers that do not add up
 * never save silently.
 */

/** One line's contribution: its own amount plus every modifier folded onto it. */
export function effectiveItemAmount(item: ReceiptItem): number {
  return item.amountMinor + item.modifiers.reduce((sum, m) => sum + m.amountMinor, 0)
}

export function itemSum(items: readonly ReceiptItem[]): number {
  return items.reduce((sum, item) => sum + effectiveItemAmount(item), 0)
}

export type TotalCheckStatus = 'MATCH' | 'MISMATCH' | 'NO_TOTAL'

export interface TotalCheck {
  status: TotalCheckStatus
  /** True only when the receipt may be saved (brief §120-124). */
  canSave: boolean
  /** Sum of item amounts including modifiers. */
  itemSum: number
  /** What the items imply the total should be, under the accepted reading. */
  computedTotal: number
  /** The total read off the receipt, when one was read. */
  readTotal: number | null
  /** computedTotal - readTotal. Null when no total was read. */
  difference: number | null
  /** Whether tax was added to reach computedTotal. */
  taxTreatedAsExclusive: boolean
}

export function checkTotal(receipt: ParsedReceipt): TotalCheck {
  const items = itemSum(receipt.items)
  const tax = receipt.taxMinor ?? 0
  const service = receipt.serviceChargeMinor ?? 0

  const inclusiveTotal = items + service
  const exclusiveTotal = items + tax + service

  const readTotal = receipt.totalMinor

  if (readTotal === null) {
    return {
      status: 'NO_TOTAL',
      canSave: false,
      itemSum: items,
      // With no total to reconcile against, report the reading the model gave
      // us, defaulting to inclusive — the common case and the safer display.
      computedTotal: receipt.taxIncludedInItems === false ? exclusiveTotal : inclusiveTotal,
      readTotal: null,
      difference: null,
      taxTreatedAsExclusive: receipt.taxIncludedInItems === false,
    }
  }

  const candidates: Array<{ total: number; exclusive: boolean }> =
    receipt.taxIncludedInItems === true
      ? [{ total: inclusiveTotal, exclusive: false }]
      : receipt.taxIncludedInItems === false
        ? [{ total: exclusiveTotal, exclusive: true }]
        : // Unknown: either reading may be the right one.
          [
            { total: inclusiveTotal, exclusive: false },
            { total: exclusiveTotal, exclusive: true },
          ]

  const hit = candidates.find((c) => c.total === readTotal)
  if (hit) {
    return {
      status: 'MATCH',
      canSave: true,
      itemSum: items,
      computedTotal: hit.total,
      readTotal,
      difference: 0,
      taxTreatedAsExclusive: hit.exclusive,
    }
  }

  // Mismatch: report against whichever reading is closest, so the number the
  // user is asked to reconcile is the smallest honest discrepancy.
  const closest = candidates.reduce((best, c) =>
    Math.abs(c.total - readTotal) < Math.abs(best.total - readTotal) ? c : best,
  )
  return {
    status: 'MISMATCH',
    canSave: false,
    itemSum: items,
    computedTotal: closest.total,
    readTotal,
    difference: closest.total - readTotal,
    taxTreatedAsExclusive: closest.exclusive,
  }
}
