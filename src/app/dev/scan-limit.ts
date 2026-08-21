import { evaluateAllowance } from '@/lib/receipts/limit'
import type { AccountRole } from './role-policy'

/**
 * Whether a receipt scan is allowed, and how many are left — PLAN.md Stage 2,
 * "Dev effects: receipt-scan daily limit lifted" (W2 package item 4).
 *
 * The cap itself is unchanged and still owned by `src/lib/receipts/limit.ts`;
 * this only decides who it applies to. Two things it deliberately does NOT
 * do:
 *
 *  - It does not stop the `ReceiptScan` row from being written. That row is
 *    the token/cost log (Phase 5 brief §183), and lifting a rate limit is
 *    exactly when you most want the spend to stay observable.
 *  - It does not raise the limit for dev — it removes it. A raised number is
 *    another number to be wrong about; `remainingAfter: null` says "no cap"
 *    honestly, and nothing in the app reads that field to render anything.
 *
 * `countToday` is a THUNK so a dev account never runs the count query at
 * all, and so a unit test can prove that rather than assume it.
 */
export interface ScanDecision {
  /** false = refuse the scan with DAILY_LIMIT_REACHED. */
  allowed: boolean
  limit: number
  /** Scans left after this one; null = uncapped. */
  remainingAfter: number | null
}

export async function decideScanAllowance(
  role: AccountRole,
  countToday: () => Promise<number>,
  limit: number,
): Promise<ScanDecision> {
  if (role === 'dev') {
    return { allowed: true, limit, remainingAfter: null }
  }
  const allowance = evaluateAllowance(await countToday(), limit)
  return {
    allowed: allowance.allowed,
    limit: allowance.limit,
    remainingAfter: allowance.allowed ? allowance.remaining - 1 : 0,
  }
}
