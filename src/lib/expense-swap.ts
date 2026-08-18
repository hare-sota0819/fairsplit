/**
 * What the chat's currency SWAP refuses, in one pure function.
 *
 * The swap (`applyCurrencyChange`, chat-edit-actions.ts) answers "그거
 * 4000엔으로 바꿔줘" on a SAVED expense by cancelling it and re-creating it in
 * the new currency. That is only safe for the ordinary shape — one plain
 * pay-as-you-go portion and no receipt lines — and every other shape has to be
 * declined rather than half-carried-over. Keeping the whole set here, pure,
 * is what lets each refusal be pinned by a test instead of by prose in a
 * server action nothing can call from a unit test (the `expense-cancel.ts`
 * precedent).
 *
 * All of them point at the full form (`chat.edit.tooComplex`), which really
 * can do this surgery — unlike the chat's one confirm card, which by design
 * asks exactly one question.
 */
import { isKnownCurrency } from '@/lib/settlement'

/** One funding portion, as much of it as the refusal set reads. */
export interface SwapFundingRow {
  /** The bank's own figure once a statement posted. */
  actualChargedAmount: bigint | null
  /** The pot this portion came out of, when it came out of one. */
  walletId: string | null
  /** The payer's own exchange rate, for money they changed themselves. */
  ownRateSnapshot: string | null
  /** Who fronted this portion; null means the expense's payer. */
  funderId: string | null
}

/**
 * The i18n key this swap must be refused with, or `null` when it may proceed.
 *
 * `currency` is checked first and separately: it arrives from parsed text, and
 * `minorUnitDigits` THROWS on a code ISO 4217 does not know, which would reach
 * the user as a generic failure instead of as a reason. Reported as
 * `chat.edit.badAmount` — the money mention in the sentence is what could not
 * be used — rather than as "too complex", which would blame the expense.
 *
 * The shapes, all `chat.edit.tooComplex`:
 *  - ITEMISED: its line totals ARE the receipt; there is no single grand total
 *    to re-create it from.
 *  - a WALLET ADJUSTMENT: a counted-cash correction belongs to its wallet's
 *    own currency and its own screen; re-created as an ordinary expense
 *    elsewhere it would move what that wallet is worth. Defence in depth
 *    rather than a path a user reaches: one is written `isPersonal`, and the
 *    chat only ever resolves a reference against SETTLEABLE expenses
 *    (`isSettleable`, page.tsx), so no sentence can name one today.
 *  - anything but exactly ONE funding portion (split funding has no single row
 *    to move).
 *  - a portion already corrected against a bank statement (the figure was
 *    billed in the OLD currency and cannot follow the money to a new one).
 *  - a portion that drew on a WALLET, or that carries the payer's own rate.
 *    A wallet holds ONE currency, so the pot that paid the old row cannot have
 *    paid the new one — and the swap's single confirm card has nowhere to ask
 *    which pot did. Re-creating it as an on-the-spot expense would silently
 *    move the wallet's balance and its average cost, so it is refused instead.
 *  - a portion somebody OTHER than the payer fronted. `funderId` is who gets
 *    the credit for the money (`balances.ts`: `portion.funding.memberId ??
 *    expense.payerId`), and the re-create writes the plain "the payer fronted
 *    it" portion — which for a co-funded receipt would move the whole credit
 *    off the person who actually paid, changing every balance derived from it.
 *
 * That is the COMPLETE set of `ExpenseFunding` columns the re-create does not
 * carry over: `funderId`, `walletId`, `actualChargedAmount` and
 * `ownRateSnapshot` are each refused above; `id`/`expenseId` belong to the new
 * row by definition; `position` is 0 because exactly one portion is allowed;
 * and `amount` is the number the user asked to change. Nothing else exists on
 * the model (prisma/schema.prisma), so no column can be discarded in silence.
 */
export function currencySwapBlockedKey(
  expense: { itemCount: number; isWalletAdjustment: boolean },
  funding: SwapFundingRow[],
  currency: string,
): string | null {
  if (!isKnownCurrency(currency)) {
    return 'chat.edit.badAmount'
  }
  if (expense.itemCount > 0 || expense.isWalletAdjustment) {
    return 'chat.edit.tooComplex'
  }
  if (funding.length !== 1) {
    return 'chat.edit.tooComplex'
  }
  const [portion] = funding
  if (
    portion.actualChargedAmount !== null ||
    portion.walletId !== null ||
    portion.ownRateSnapshot !== null ||
    portion.funderId !== null
  ) {
    return 'chat.edit.tooComplex'
  }
  return null
}
