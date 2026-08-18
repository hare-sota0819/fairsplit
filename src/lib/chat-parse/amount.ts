import { tokenize } from './engine/tokenizer'
import { findAmounts } from './parsers/amount'
import type { AmountHit } from './types'

/**
 * Money extraction, as the rest of the app consumes it. A thin adapter over
 * `parsers/amount.ts`'s `findAmounts` — the token-based parser is the single
 * owner of currency binding, Korean/English numeral composition and the "is
 * this number money at all" decision; this file only reshapes its hits into
 * the shape callers already use.
 */

/**
 * Finds the money mention in a sentence. Returns null rather than guessing:
 * a null makes the UI ask "얼마였어?", which is cheaper than a wrong save.
 *
 * The first MARKED mention wins, falling back to the first mention of any
 * kind. Leftmost-wins alone was a silent wrong-save path: in "카톡 1234
 * 그리고 5만원" the leftmost hit is an unmarked 1234 (a chat-room name, a
 * table number, an order id — anything), while 5만원 is the one number the
 * sentence actually marks as money; and because the multi-amount guard
 * (`parse()`'s `amountMentions` field, chat-parse/index.ts) counts MARKED
 * mentions only, it sees a single amount and never asks. A bare number must
 * therefore never outrank an explicit one.
 */
export function extractAmount(
  input: string,
  defaultCurrency: string,
): AmountHit | null {
  const hits = findAmounts(tokenize(input), input, defaultCurrency)
  const first = hits.find((h) => h.value.marked) ?? hits[0]
  if (!first) return null
  return {
    amount: first.value.amount,
    currency: first.value.currency,
    start: first.start,
    end: first.end,
  }
}
