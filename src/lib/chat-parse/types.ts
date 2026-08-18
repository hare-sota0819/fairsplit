/** Pure chat-sentence parsing. No DB, no I/O — same law as src/lib/settlement. */

export interface ChatMember {
  id: string
  /** Display name as shown in the group. Matching is done against this. */
  name: string
}

export interface ParseContext {
  members: ChatMember[]
  /** The acting member (the person typing). */
  actorId: string
  /** Group settlement currency, ISO 4217 (e.g. "KRW"). */
  defaultCurrency: string
}

/**
 * How a split expression divides the bill.
 *  - `everyone`  — every member of the group (엔빵/다같이/evenly/split).
 *  - `half`      — two ways (반반/절반/half).
 *  - `n-ways`    — an explicit count ("split three ways"), carried alongside.
 *  - `named-only` — only the members the sentence names. Reserved for the
 *    participant logic that reads NAMES (parsers/people.ts + its caller); no
 *    keyword produces it, because no keyword can: a named-only split is
 *    expressed by naming people, not by a word.
 */
export type SplitMode = 'everyone' | 'half' | 'named-only' | 'n-ways'

/** One split expression in a lexicon: the text that says it, and what it
 * means. Shared by the ko and en tables so both are read by one matcher. */
export interface SplitEntry {
  text: string
  mode: SplitMode
  /** 0..1 — per entry, since some words say "split" far less certainly. */
  confidence: number
}

/** A money mention found in the sentence, with its span for removal. */
export interface AmountHit {
  /** Decimal string exactly as parseAmountToMinor expects (e.g. "35000", "45.60"). */
  amount: string
  currency: string
  start: number
  end: number
}

export interface ParsedExpense {
  /** null = the sentence carried no amount; UI must ask before save. */
  amount: string | null
  currency: string
  payerId: string
  /** Always non-empty; defaults to every member in context. */
  participantIds: string[]
  /**
   * The input MINUS every span the parse consumed, whitespace collapsed — a
   * word survives exactly when no hit claimed it. There is no keyword sweep.
   * Notably (controller ruling, T8 fix round 1): an English `with` binds into
   * the person's span so nothing is stranded ("… with Sam" → "…"), commas are
   * RETAINED as ordinary punctuation of the description, and a dangling
   * coordinator can survive ("for lunch with Sam and Alex" → "for lunch and").
   * See `parse()`'s own doc comment for the full contract.
   */
  description: string
  funding: 'PAY_AS_YOU_GO' | 'NEW_CASH_WALLET'
  missing: Array<'amount'>
  /**
   * How many DISTINCT currency/unit-marked amounts the WHOLE sentence
   * carries (every MARKED hit the pipeline kept) — not just the first, which
   * is all `amount` above reflects. A2 review guard: a value of 2+ means
   * this is a multi-item sentence ("13000원 김치찌개 3개, 7000원 콜라 2개"),
   * and `amount` above is only the FIRST of several — a confident
   * single-amount confirm card must never be built from it.
   */
  amountMentions: number
}
