import { z } from 'zod'

/**
 * The parsing contract from PHASE5_RECEIPT_PROMPT.md §71-96, as zod.
 *
 * Every monetary field is an INTEGER in the currency's minor units. A float
 * anywhere in this path is a bug (project money policy, docs/DECISIONS.md), so
 * the schema rejects non-integers outright rather than rounding them — a model
 * that answers `12.5` has misread something, and silently flooring it would
 * bury the evidence.
 */
const minorUnits = z.number().int()

export const receiptModifierSchema = z.object({
  name: z.string(),
  amountMinor: minorUnits,
})

export const receiptItemSchema = z.object({
  /** As printed, original language. */
  name: z.string(),
  quantity: z.number().int().min(1).default(1),
  unitPriceMinor: minorUnits.nullable().default(null),
  /** Line total in minor units. May be negative for a standalone discount. */
  amountMinor: minorUnits,
  /** Indented option rows folded into their parent. */
  modifiers: z.array(receiptModifierSchema).default([]),
})

export const parsedReceiptSchema = z.object({
  items: z.array(receiptItemSchema),
  subtotalMinor: minorUnits.nullable().default(null),
  taxMinor: minorUnits.nullable().default(null),
  serviceChargeMinor: minorUnits.nullable().default(null),
  totalMinor: minorUnits.nullable().default(null),
  /** ISO 4217 guess from the receipt. */
  currency: z.string().nullable().default(null),
  merchantName: z.string().nullable().default(null),
  /** ISO date if printed. */
  receiptDate: z.string().nullable().default(null),
  /**
   * Whether `taxMinor` is already inside the item prices.
   *
   * NOT in the brief's schema. Added because the brief's total-match invariant
   * (§117) adds tax on top of the item sum, and Japanese receipts print tax
   * INCLUSIVE (内税) — three of the four test receipts fail the literal rule.
   * See OPEN_QUESTIONS.md #1. Null means the model could not tell, and the
   * invariant then accepts either reading rather than blocking the save.
   */
  taxIncludedInItems: z.boolean().nullable().default(null),
})

export type ParsedReceipt = z.infer<typeof parsedReceiptSchema>
export type ReceiptItem = z.infer<typeof receiptItemSchema>
export type ReceiptModifier = z.infer<typeof receiptModifierSchema>

/**
 * Remove a markdown fence the model was told not to emit but sometimes does.
 * Deliberately conservative: it only strips a fence that WRAPS the whole
 * response, so a stray ``` inside a merchant name cannot truncate the JSON.
 */
export function stripCodeFence(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('```')) return text
  const withoutOpen = text.replace(/^```[a-zA-Z]*[ \t]*\r?\n?/, '')
  return withoutOpen.replace(/\r?\n?```$/, '').trim()
}

export type ReceiptParseFailure =
  | { ok: false; reason: 'INVALID_JSON'; raw: string }
  | { ok: false; reason: 'SCHEMA_MISMATCH'; raw: string; issues: string[] }

export type ReceiptParseResult = { ok: true; receipt: ParsedReceipt } | ReceiptParseFailure

/**
 * Parse a model response defensively (brief §111): strip fences, JSON.parse,
 * validate. Any failure is a typed parse failure carrying the raw text, which
 * the route logs server-side — never a thrown exception and never a partial
 * result.
 */
export function parseReceiptResponse(raw: string): ReceiptParseResult {
  const text = stripCodeFence(raw)
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'INVALID_JSON', raw }
  }
  const result = parsedReceiptSchema.safeParse(json)
  if (!result.success) {
    return {
      ok: false,
      reason: 'SCHEMA_MISMATCH',
      raw,
      issues: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    }
  }
  return { ok: true, receipt: result.data }
}
