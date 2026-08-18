import type { ParsedReceipt } from '../receipts/schema'
import type { TotalCheck } from '../receipts/invariant'
import type { ParsedItemList } from '../chat-parse/items'
import { itemToRow } from '../receipts/handoff'
import { minorToDecimalInput } from '../format'

/**
 * Parsed receipt + total-invariant check -> what the chat should show next.
 *
 * Pure (no I/O), mirrors the confirm-screen rules from
 * `docs/handoff/C-chat-image-receipt.md` and the plan's "Merge rules"
 * section. Reuses `itemToRow` (src/lib/receipts/handoff.ts) for the
 * quantity/unit-price derivation so a chat-scanned line and a wizard-scanned
 * line never disagree.
 */

export type ReceiptChatOutcome =
  | { kind: 'items'; list: ParsedItemList; title: string | null }
  | {
      kind: 'totalOnly'
      amount: string
      currency: string
      title: string | null
      reason: 'NO_ITEMS' | 'SUM_MISMATCH'
    }
  | { kind: 'refuse' }

const CURRENCY_SHAPE = /^[A-Z]{3}$/

function resolveCurrency(receipt: ParsedReceipt, defaultCurrency: string): string {
  const normalized = receipt.currency?.trim().toUpperCase() ?? ''
  return CURRENCY_SHAPE.test(normalized) ? normalized : defaultCurrency
}

function resolveTitle(receipt: ParsedReceipt): string | null {
  const trimmed = receipt.merchantName?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function mergeReceiptIntoChat(
  receipt: ParsedReceipt,
  check: TotalCheck,
  defaultCurrency: string,
): ReceiptChatOutcome {
  const currency = resolveCurrency(receipt, defaultCurrency)
  const title = resolveTitle(receipt)

  // No items were parsed at all: this is never a numeric mismatch (there is
  // nothing to reconcile against), it's "the receipt had no line items" —
  // handled before the MISMATCH branch below so a printed total on an
  // item-less receipt always reads as NO_ITEMS, never SUM_MISMATCH.
  if (receipt.items.length === 0) {
    if (receipt.totalMinor == null) {
      return { kind: 'refuse' }
    }
    return {
      kind: 'totalOnly',
      amount: minorToDecimalInput(BigInt(receipt.totalMinor), currency),
      currency,
      title,
      reason: 'NO_ITEMS',
    }
  }

  if (check.status === 'MATCH' || check.status === 'NO_TOTAL') {
    const list: ParsedItemList = {
      currency,
      items: receipt.items.map((item, index) => {
        const row = itemToRow(item, index, currency)
        // A receipt names no eaters and shares nothing out — assignment is
        // the card's job here, so both parser-side fields stay empty.
        return {
          name: row.name,
          unitAmount: row.unitAmount,
          quantity: row.quantity,
          assigneeIds: [],
          shareAll: false,
        }
      }),
    }
    return { kind: 'items', list, title }
  }

  // check.status === 'MISMATCH': the printed total is what was actually
  // paid, so it wins over any per-line reconciliation. readTotal is
  // non-null whenever status is MISMATCH (invariant.ts only returns
  // MISMATCH after reading a total), but fall back to computedTotal
  // defensively rather than assume that can never change.
  const readTotal = check.readTotal ?? check.computedTotal
  return {
    kind: 'totalOnly',
    amount: minorToDecimalInput(BigInt(readTotal), currency),
    currency,
    title,
    reason: 'SUM_MISMATCH',
  }
}
