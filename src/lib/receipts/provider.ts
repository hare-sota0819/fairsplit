import type { ParsedReceipt } from './schema'

/**
 * Why a parse did not produce a receipt. The caller turns these into user
 * copy, so they are coarse on purpose: the user can only ever do one of two
 * things — try again, or type it in by hand.
 */
export type ReceiptParseErrorKind =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'UNREADABLE' // the model answered, but not with a usable receipt
  | 'PROVIDER_ERROR'

export interface ReceiptUsage {
  /** Input tokens billed, from the provider's own usage report. */
  inputTokens: number
  /** Visible output tokens. */
  outputTokens: number
  /** Reasoning tokens, billed as output. Reported separately (brief §57-59). */
  thinkingTokens: number
  totalTokens: number
  latencyMs: number
}

export type ReceiptParseOutcome =
  | { ok: true; receipt: ParsedReceipt; usage: ReceiptUsage }
  | {
      ok: false
      kind: ReceiptParseErrorKind
      /** Raw provider text, for server-side logging only — never sent to the client. */
      raw?: string
      usage?: ReceiptUsage
    }

/**
 * Reads a receipt photograph into line items.
 *
 * Same shape as `RateProvider` (src/lib/rates/provider.ts): one implementation
 * today, swappable without touching call sites. Implementations must not throw
 * for an expected failure — a timeout, a refusal and a malformed response all
 * come back as `ok: false`.
 */
export interface ReceiptParser {
  /**
   * @param image  JPEG bytes, already resized. Implementations do not resize.
   * @param signal Abort signal carrying the caller's timeout.
   */
  parse(image: Uint8Array, options?: { signal?: AbortSignal }): Promise<ReceiptParseOutcome>
}
