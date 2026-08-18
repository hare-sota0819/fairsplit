import { RECEIPT_DAILY_SCAN_LIMIT } from './config'

/**
 * Per-user daily scan cap, PHASE5_RECEIPT_PROMPT.md §181.
 *
 * This exists to contain a stuck client or an abusive one, not to ration real
 * use — the brief puts a heavy travel day at ~15 scans against a limit of 50.
 *
 * The window is a UTC calendar day. Following the device's timezone would let
 * anyone reset their own quota by changing a phone clock, and the offset is
 * client-supplied on this codebase (src/lib/datetime.ts) so it is not
 * trustworthy for a guardrail. The cost is that a traveller in Japan sees the
 * window roll over at 09:00 local, which for a 50-a-day ceiling nobody is
 * expected to reach is not worth a spoofable boundary.
 */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

export interface ScanAllowance {
  allowed: boolean
  used: number
  limit: number
  remaining: number
}

export function evaluateAllowance(
  usedToday: number,
  limit: number = RECEIPT_DAILY_SCAN_LIMIT,
): ScanAllowance {
  const used = Math.max(0, usedToday)
  return {
    allowed: used < limit,
    used,
    limit,
    // Never negative: a limit lowered below someone's existing usage should
    // read as "0 left", not as a negative allowance.
    remaining: Math.max(0, limit - used),
  }
}
