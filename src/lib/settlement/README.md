# Settlement engine

Pure money math for FairSplit: no DB access, no I/O, no Prisma imports.
Everything here is unit-tested; amounts are bigint integer minor units and
rates are exact bigint rationals (see docs/DECISIONS.md).

## Rounding always favors the payer — product decision, not a bug

Whenever a division doesn't come out even:

- Each NON-payer's exact rational share is rounded **up** to the next
  settlement-currency minor unit (`ceilDiv`), exactly once.
- **Refunds (negative amounts) round toward zero** — the same signed
  ceiling: consumers get slightly less back instead of the payer paying
  out more. Payer-favored in both directions; property-tested for any sign.
- The payer's receivable is the **sum of those rounded consumer debits** —
  up to (participants − 1) minor units more than the exact amount, per
  division event. The payer must never receive less than they paid.
- Balances stay zero-sum by construction (credit == sum of debits).
- `allocateLargestRemainder` remains for payer-neutral decompositions only
  (e.g. splitting a quantity of items), never for consumer money shares.

## Rate selection (`resolveRate`) and the actual-charged asymmetry

AVG_COST mode: CASH expenses convert at the payer's average-cost rate
(their exchange records; market-snapshot fallback when they have none) —
a card purchase never consumed exchanged cash, so CARD expenses convert
at the market snapshot instead. If the payer recorded what the bank
actually billed (`actualChargedAmount`), that IS their true cost and
supersedes the snapshot **in AVG_COST mode only**: MARKET mode keeps the
snapshot for everyone so one member's card fees never move other members'
numbers (deliberate asymmetry). Every conversion reports its `RateSource`
(`AVG_COST | MARKET_SNAPSHOT | ACTUAL_CHARGED | MARKET_FALLBACK`).

## Map of the modules

- `types.ts` — shared types (`Ratio` = exact rational minor units).
- `money.ts` — primitives: `ceilDiv`, `ratio`/`addRatio`,
  `allocateLargestRemainder`, `roundDivHalfEven`, `rateFromDecimalString`,
  `minorUnitDigits` (ISO 4217 via `currency-codes`).
- `rates.ts` — average-cost rate from a member's exchange records.
- `convert.ts` — `settlementRate` + payer-favored `convertExpense`.
- `items.ts` — `allocateExactShares`: receipt lines -> exact rational
  shares per member; `validateReceipt`.
- `balances.ts` — `consumerDebits` (payer-favored rounding happens here),
  `computeNetBalances`, `payerRateFor`.
- `consumed.ts` — `consumedShares`: per-member own consumption (payer
  included) for display; not used for balances.
- `pairwise.ts` — `pairwiseContributions`/`pairwiseContribution`: one
  expense's effect on the ledger between two members; `pairwiseNetFor`: raw
  per-other-member ledger, folded from the per-expense function.
- `simplify.ts` — `simplifyDebts`: greedy transfer minimization.
- `report.ts` — `compareModesReport`: AVG_COST vs MARKET diff.
- `wallet.ts` — `remainingCash` (exchanged minus CASH spends per currency,
  personal included / cancelled excluded by the caller) and
  `walletAdjustmentAmount` (counted-vs-computed diff, recorded as a
  personal CASH expense so "My spending" stays consistent).
