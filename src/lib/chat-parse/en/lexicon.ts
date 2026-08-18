import type { SplitEntry } from '../types'

/**
 * English pay-verb, split and currency-word lexicons.
 *
 * Entries are written as SPACE-SEPARATED PHRASES and matched over the token
 * stream word by word ("picked up the tab" = four latin tokens). That is what
 * makes "tabloid" a non-match without a single \b: a token is already the
 * maximal run of same-kind characters, so the token IS "tabloid", never "tab"
 * (the same property parsers/people.ts relies on for latin names).
 */

export interface PayVerbEntryEn {
  /** Lowercase phrase; one or more space-separated words. */
  phrase: string
  /** 0..1 — below 1 where the phrase has a common non-payment reading. */
  confidence: number
}

export const PAY_VERB_ENTRIES_EN: readonly PayVerbEntryEn[] = [
  { phrase: 'paid', confidence: 1 },
  { phrase: 'covered', confidence: 1 },
  { phrase: 'picked up the tab', confidence: 1 },
  { phrase: 'picked up the bill', confidence: 1 },
  { phrase: 'chipped in', confidence: 1 },
  { phrase: 'fronted', confidence: 1 },
  { phrase: 'spotted', confidence: 1 },
  { phrase: 'treated', confidence: 1 },
  { phrase: 'bought', confidence: 1 },
  // "got it" is the brief's entry and a real idiom for paying ("I got it"),
  // but it is also the most common way in English to say "understood" — a
  // lower confidence so a refiner can drop it against any competing signal,
  // rather than a silent equal-weight hit.
  { phrase: 'got it', confidence: 0.6 },
]

export const PAY_VERBS_EN: readonly string[] = PAY_VERB_ENTRIES_EN.map((e) => e.phrase)

/**
 * English split vocabulary.
 *
 * "three ways" is NOT here, on purpose: an n-ways expression is a GRAMMAR (a
 * number, then `ways`) and belongs to the parser, which reads the number with
 * the same `readEnglishNumber` the amount parser uses. Listing "three ways"
 * as a literal would silently mean "four ways" is unrecognised — the exact
 * enumerated-narrower-than-its-domain failure docs/SOLVED.md logs.
 */
export const SPLIT_ENTRIES_EN: readonly SplitEntry[] = [
  { text: 'split', mode: 'everyone', confidence: 1 },
  { text: 'evenly', mode: 'everyone', confidence: 1 },
  { text: 'everyone', mode: 'everyone', confidence: 1 },
  { text: 'all together', mode: 'everyone', confidence: 1 },
  { text: 'went dutch', mode: 'everyone', confidence: 1 },
  { text: 'going dutch', mode: 'everyone', confidence: 1 },
  { text: 'half', mode: 'half', confidence: 1 },
  { text: 'went halves', mode: 'half', confidence: 1 },
  // "each" is a split signal ("20 bucks each") but also an ordinary
  // distributive ("each receipt"), so it carries a lower confidence.
  { text: 'each', mode: 'everyone', confidence: 0.6 },
]

export const SPLIT_EN: readonly string[] = SPLIT_ENTRIES_EN.map((e) => e.text)

/**
 * English funding vocabulary — the words that say the money came out of cash
 * rather than a card or an account.
 *
 * It lives here, with the rest of the English lexicon, and is READ by
 * `engine/pipeline.ts`'s funding parser and by `parsers/amount.ts`'s
 * money-confirming follower set. One vocabulary, two readers.
 */
export const FUNDING_WORDS_EN: readonly string[] = ['cash']

/**
 * The closed set of English words that BIND a price to the thing it bought:
 * "45 for lunch", "spent 200 on groceries", "lunch 12000 with Minsu".
 *
 * These are not a licence for a bare number to be money — that is the default
 * (see `isDisqualifiedBareNumber` in parsers/amount.ts). They are one half of
 * the money-CONFIRMING set that OVERRIDES the year disqualifier, so a real
 * price that happens to fall in the 1000-2100 band still reads: "1500 for
 * lunch", "1899 each", "2000 with Sam".
 *
 * `in`/`at`/`by` are deliberately absent: they date and locate things ("born
 * in 1770", "at 9000 feet"), which is exactly the reading the year rule exists
 * to keep out.
 */
export const PRICE_BINDERS_EN: readonly string[] = ['for', 'on', 'with']

/**
 * Words that say a number IS the bill, rather than something else about it:
 * "dinner 12000 total", "3 tickets $120 total".
 *
 * Money vocabulary in this domain, and it is READ as such elsewhere already —
 * `dinner 12000 total` is an asserted corpus row outside the year band, so the
 * year band refusing the same word was an inconsistency rather than a
 * conservative choice (Task 11 fix round 2, controller ruling). Held to
 * `total` alone: `altogether`/`sum`/`in all` are plausible siblings and none of
 * them has turned up in the corpus yet, so they stay out until one does.
 */
export const TOTAL_WORDS_EN: readonly string[] = ['total']

/**
 * English currency WORDS → ISO 4217 code. The formal and the slang names of a
 * currency, in one table, consumed by parsers/amount.ts's lexicon builder so
 * the two files can never drift into separate copies of the same vocabulary.
 *
 * `pound`/`pounds` are deliberately absent — a weight at least as often as
 * money in expense chat; `quid` names GBP unambiguously.
 */
export const CURRENCY_WORDS_EN: ReadonlyMap<string, string> = new Map([
  ['dollar', 'USD'],
  ['dollars', 'USD'],
  ['buck', 'USD'],
  ['bucks', 'USD'],
  ['quid', 'GBP'],
  ['euro', 'EUR'],
  ['euros', 'EUR'],
  ['won', 'KRW'],
  ['yen', 'JPY'],
])

/**
 * Money units that MULTIPLY the number they follow but name no currency of
 * their own: "5 grand" is 5000 of whatever currency is in play, so the
 * group's default (or a symbol elsewhere in the text) supplies the code.
 *
 * Kept out of `CURRENCY_WORDS_EN` rather than mapped to some default there:
 * that map's value is an ISO code, and `grand` has none — writing one in
 * would be a lie the whole parser would then believe.
 */
export const MONEY_UNITS_EN: ReadonlyMap<string, bigint> = new Map([['grand', 1000n]])
