import { z } from 'zod'

/** How many units of a line one member had. */
export const itemAssigneeSchema = z.object({
  memberId: z.string(),
  quantity: z.number().int().min(1),
})

/**
 * A receipt line as the form holds it: the UNIT price as typed plus how many
 * units. The line total is always unitAmount * quantity and is never sent —
 * deriving it in one place is what keeps the two from disagreeing.
 */
export const expenseItemSchema = z.object({
  name: z.string().trim().min(1),
  unitAmount: z.string(),
  quantity: z.number().int().min(1),
  /**
   * How the line divides. Only the MODE travels — the per-person amounts are
   * derived server-side from the unit price, quantity and member set, so a
   * client cannot post shares that fail to sum to the line total.
   */
  splitMode: z.enum(['BY_QUANTITY', 'BY_AMOUNT']).optional(),
  assignees: z.array(itemAssigneeSchema),
})

/**
 * Where the money came from. "Prepaid" means it was exchanged before it was
 * spent — banknotes or a travel card, the maths does not care — so it
 * converts at that wallet's average cost. NEW_CASH_WALLET is the shorthand
 * for "cash, and I have not set a wallet up for this currency yet": the
 * server creates one rather than making wallet setup a prerequisite for
 * recording a coffee.
 */
export const fundingSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('WALLET'), walletId: z.string() }),
  z.object({ kind: z.literal('NEW_CASH_WALLET') }),
  z.object({ kind: z.literal('PAY_AS_YOU_GO') }),
  // Prepaid, but this member keeps no wallet to draw it down from. They tell
  // us the rate they exchanged at instead (`ownRateDisplay`), and are OFFERED
  // a wallet afterwards — never given one silently.
  z.object({ kind: z.literal('PREPAID_NO_WALLET') }),
])

export type FundingSource = z.infer<typeof fundingSourceSchema>

/**
 * One source BEYOND the primary one, and how much of the expense came out of
 * it. The primary source covers whatever is left, so the portions cannot fail
 * to add up to the expense.
 *
 * Each carries its own rate answer for the same reason the expense does: a
 * wallet portion settles at what that wallet's money cost, and a portion the
 * payer exchanged themselves settles at the rate they say they got.
 */
export const extraFundingSchema = z.object({
  amount: z.string(),
  source: fundingSourceSchema,
  ownRateDisplay: z.string().optional(),
  /**
   * Who fronted this portion, when it was not the payer. "My card ran out so
   * Bob paid the rest" is one dinner, not two, and entering it as two divides
   * the receipt's items wrongly. Absent means the payer.
   */
  memberId: z.string().optional(),
})

/**
 * The expense form serializes its state into one JSON payload field; this is
 * its schema. Money stays as decimal strings here — parsed to exact minor
 * units server-side (parseAmountToMinor), never floats.
 */
export const expensePayloadSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  payerId: z.string(),
  fundingSource: fundingSourceSchema,
  /** Empty for the ordinary receipt paid from one place. */
  extraFunding: z.array(extraFundingSchema).default([]),
  /** Absolute instant (ISO). The browser resolves its own wall clock. */
  timestampIso: z.string().min(1),
  note: z.string().optional(),
  isPersonal: z.boolean(),
  /**
   * Receipt photo path in the `receipts` bucket. Shape-checked here rather
   * than trusted: this value comes from the client, and it is what the image
   * route later resolves a group from to authorise a read.
   */
  receiptImagePath: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.jpg$/)
    .nullable()
    .optional(),
  /**
   * Optional manual market-rate override AS TYPED, in the currency's quote
   * unit (e.g. "916.66" for 100 JPY). Converted to storage units in exactly
   * one place — `displayRateToStorage` — server-side.
   */
  marketRateDisplay: z.string().optional(),
  /**
   * The payer's OWN exchange rate, AS TYPED, in the currency's quote unit
   * (e.g. "913" for 100 JPY) — sent only when the money was prepaid and the
   * payer keeps no wallet for it. Converted to storage units in exactly one
   * place, `displayRateToStorage`, server-side.
   *
   * `actualCharged` (the bank-statement figure) is deliberately absent from
   * this payload: it is corrected on the expense detail screen, not entered
   * in the wizard.
   */
  ownRateDisplay: z.string().optional(),
  /**
   * Money exchanged AT THE TILL, when the paying wallet could not cover the
   * bill. It becomes an ordinary exchange record on that wallet, dated to
   * the expense — the money really was exchanged, so it belongs to the
   * wallet's history whatever later happens to this receipt.
   */
  topUp: z
    .object({
      walletId: z.string().min(1),
      /** What went onto the wallet, in ITS currency, as typed. */
      amount: z.string(),
      /** What it cost, settlement currency, as typed. */
      paid: z.string(),
    })
    .optional(),
  participantIds: z.array(z.string()).min(1),
  items: z.array(expenseItemSchema),
  force: z.boolean(),
})

export type ExpensePayload = z.infer<typeof expensePayloadSchema>
