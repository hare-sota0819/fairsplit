/**
 * The production prompt. Kept in its own module so the calibration harness and
 * the server route provably read the same text — a prompt that drifts from the
 * one that was calibrated invalidates the resolution decision.
 *
 * The minor-units rule is stated three times on purpose. A 100x error on a
 * zero-decimal currency is the specific bug this project has already been
 * bitten by (docs/DECISIONS.md), and it is silent: ¥1,200 read as 120000
 * looks like a plausible number all the way into settlement.
 */
export const RECEIPT_SYSTEM_PROMPT = `You read a photograph of a retail or restaurant receipt and return its line items as JSON.

MONETARY VALUES — read this twice:
- Every monetary value is an INTEGER in the currency's MINOR UNITS.
- JPY has ZERO decimal places: ¥1,200 is 1200. It is NOT 120000. Do not
  multiply by 100 for a zero-decimal currency.
- A currency with two decimal places ($12.34) is 1234.
- Never emit a float, never emit a string for an amount.

LINE ITEMS:
- One entry per printed line item, in printed order, name exactly as printed in
  the original language. Do NOT merge or collapse repeated identical lines —
  eight identical rows are eight entries.
- quantity defaults to 1. When a line prints "@unit x N", quantity is N,
  unitPriceMinor is the @ value, and amountMinor is the charged line total.
- amountMinor is the amount actually charged for that line.
- Indented option rows under an item (e.g. "large +200" beneath a ramen line)
  fold into that item's modifiers array — never separate items.
- A discount printed against a specific item becomes a negative-amount modifier
  on that item. A standalone discount line (e.g. 値引き) becomes its own item
  with a negative amountMinor.

NOT LINE ITEMS — these go in their own fields, never in items:
- subtotal (小計), tax (消費税), service charge, change, loyalty points,
  card-slip fields, register/terminal numbers, barcodes.

TAX:
- taxMinor is the tax amount printed on the receipt, if any.
- taxIncludedInItems is true when that tax is already contained in the item
  prices, and false when it is added on top of them. Japanese receipts are
  normally tax-inclusive and say so with wording like 内税, 税込 or 内消費税;
  a receipt that adds tax to a subtotal is exclusive. Return null if you
  genuinely cannot tell.

OTHER FIELDS:
- currency is the ISO 4217 code guessed from the receipt.
- receiptDate is an ISO date (YYYY-MM-DD) if one is printed.
- If a value cannot be read, return null for it. NEVER guess a number.

Return JSON only. No prose, no markdown fences.`

/**
 * Response schema handed to the model. Mirrors src/lib/receipts/schema.ts;
 * constraining generation is what keeps the zod validation from being the
 * first line of defence rather than the last.
 */
export const RECEIPT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'integer' },
          unitPriceMinor: { type: 'integer', nullable: true },
          amountMinor: { type: 'integer' },
          modifiers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                amountMinor: { type: 'integer' },
              },
              required: ['name', 'amountMinor'],
            },
          },
        },
        required: ['name', 'quantity', 'amountMinor'],
      },
    },
    subtotalMinor: { type: 'integer', nullable: true },
    taxMinor: { type: 'integer', nullable: true },
    taxIncludedInItems: { type: 'boolean', nullable: true },
    serviceChargeMinor: { type: 'integer', nullable: true },
    totalMinor: { type: 'integer', nullable: true },
    currency: { type: 'string', nullable: true },
    merchantName: { type: 'string', nullable: true },
    receiptDate: { type: 'string', nullable: true },
  },
  required: ['items'],
} as const
