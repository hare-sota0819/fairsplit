# Decisions

<!--
Records of "why we did it this way" — design and tooling decisions
that are not obvious from the code alone.

Entry format:

## [YYYY-MM-DD] Decision title
- **Decision**: What was decided
- **Reasoning**: Why this option was chosen; alternatives considered
  and why they were rejected
-->

## [2026-07-30] Money & precision policy (project-wide, non-negotiable)

- **Decision**:
  1. All money amounts are integer minor units of their currency (JPY: 1 = 1 yen,
     USD: 1 = 1 cent). DB type `BigInt`, engine type `bigint`. Never floats.
  2. Currency exponents (minor-unit digits) come from the `currency-codes` npm
     package. No hand-written ISO 4217 tables.
  3. Exchange rates are never floats. In the DB: `Decimal(24, 10)`, expressed as
     settlement-currency MAJOR units per 1 MAJOR unit of foreign currency
     (e.g. 9.205 KRW per 1 JPY). In the engine: exact bigint rationals
     (`numerator/denominator`); a member's average-cost rate is the rational
     `sum(amountPaid) / sum(amountReceived)` in minor units, kept unreduced.
  4. (AMENDED 2026-07-31, see below) Rounding happens exactly once per
     conversion, at settlement-currency minor units, using round-half-even
     (banker's rounding).
  5. (AMENDED 2026-07-31, see below) Splitting never rounds: shares are
     allocated with the largest remainder method so per-expense shares always
     sum exactly to the converted total.
- **Reasoning**: Floats destroy money math (spliit's float share math drifts up
  to ~n/2 minor units per group; SplitPro's hand-rolled currency table has wrong
  exponents for ~15 currencies — both verified while studying them). BigInt over
  Int because high-nominal currencies (IDR, VND) overflow Int32. Rationals over
  scaled integers inside the engine because the average-cost rate is _defined_
  as a quotient of two integer sums — keeping it a fraction makes conversion
  exact until the single final rounding. Half-even over half-up to avoid
  systematic upward bias across many conversions.

## [2026-07-30] Prisma schema shape (Phase 1)

- **Decision**: `ExpenseParticipant` join table added beyond the brief's model
  list; `Member.userId` is a bare nullable column (no `User` table yet);
  `Checkpoint` is `@@unique([groupId, timestamp])` boundary rows; settlements
  in later phases will be ordinary expenses (Splitwise convention).
- **Reasoning**: Unassigned receipt lines fall back to "equal split among
  participants" (brief, Step 3.3) — that participant set must be stored, hence
  ExpenseParticipant. A `User` table without auth (out of scope) would be dead
  schema; the nullable column keeps the zero-friction-join promise and the
  migration path. Boundary-timestamp checkpoints match the brief and make
  "expense belongs to nearest future checkpoint" a simple ordered lookup.

## [2026-07-31] Payer-favored rounding (supersedes policy points 4–5 above)

- **Decision**: Whenever a division doesn't come out even, rounding favors
  the payer. Each non-payer's exact rational share is rounded UP exactly once
  at settlement-currency minor units; the payer's receivable is the sum of
  those consumer debits (surplus ≤ participants − 1 minor units per division
  event, intended). `convertExpense` also rounds up. Shares are carried as
  exact rationals (`Ratio`) until that single rounding; the largest-remainder
  method remains only for payer-neutral decompositions.
- **Reasoning**: Product decision from the owner (docs/PROMPT.md 2026-07-31):
  the payer fronted the money and must never come out behind; a few minor
  units of surplus to the payer feels fair, being short-changed does not.
  Half-even's no-systematic-bias goal is deliberately abandoned — the bias
  toward the payer is the product.

## [2026-08-01] Per-method rates, actual-charged asymmetry, refund rounding, soft delete

- **Decision**: (1) AVG_COST converts CASH expenses at the payer's
  average-cost rate and CARD expenses at the market snapshot; an optional
  `actualChargedAmount` (the bank's billed line) supersedes the snapshot in
  AVG_COST only — MARKET mode ignores it. (2) Refunds are supported:
  negative amounts/items flow through the engine, with negative shares
  rounded toward zero (signed ceiling — payer-favored in both directions).
  (3) Expenses are soft-deleted (`cancelledAt`/`cancelledById`), excluded
  from all settlement/wallet math, kept in feeds; no hard delete.
  (4) Rate snapshots come from Frankfurter behind a RateProvider interface
  with a (date, base, quote) DB cache; manual entry is an override and the
  network-failure fallback.
- **Reasoning**: A card purchase never consumed exchanged cash, so the
  average-cost rate misprices it (Phase 3A brief). The actual-charged
  asymmetry keeps MARKET mode's group fairness: one member's card fees must
  not move others' numbers. Toward-zero on negatives preserves the "payer
  never loses" invariant proven by the sign-agnostic property tests.
  Soft delete preserves audit history in a money app.

## [2026-08-10] Assistant-brain spec errata (classify() Task 4, round-2 review)

- **Decision (a) — §4.8's "zero-hit fallback triple" is a compose-time
  option, not classify()'s output.** §4.8 states the GUIDED zero-hit
  fallback is `[myBalance, groupTotal, help]`, but the §3 test tables
  themselves pin many zero-signal rows (`커피 2`, `ok`, `계산기 어디
있어?`, …) to the single value `suggest:['HELP']`. `classify()` keeps
  emitting `['HELP']` for a genuine zero-partial-hit input — the §3 tables
  are law and this is what they assert. The composer (T5) MAY still choose
  to render the 3-option triple at reply time from a bare `['HELP']`
  signal, since `suggest` only carries INTENT names, not full reply text —
  that's a presentation choice downstream of classify(), not a
  reclassification. Non-zero partial hits DO get a real ranked list now
  (§4.8's own priority order, ≤3 items) — see `rankedGuidedSuggest` in
  `classify.ts`.
- **Decision (b) — the `samsung phone charger 40` spec-table cell (§3.6 en
  NEGATIVE) is wrong, not a classify() gap.** The row asserts
  `EXPENSE_ENTRY | → parse()`, but a bare 2-digit trailing number with no
  currency unit/symbol is exactly the shape `extractAmount` is DESIGNED to
  reject — the same settled-law null as `커피 2` (§3.1 NEGATIVE, T1/T3's
  own established design: "the two 'not money' nulls stay null"). The
  settled 커피-2 rule wins; `classify()` correctly returns
  `UNKNOWN{suggest:['HELP']}` for this input. Widening P5 to accept a bare
  digit alone (so `samsung phone charger 40` becomes EXPENSE_ENTRY) would
  also flip `커피 2`, breaking settled law for one wrong spec cell — not
  done. Moved out of task-4-report.md's gap list into this erratum note;
  the test itself is unchanged (`classify.test.ts`'s §3.6 en NEGATIVE
  block), only its framing.
- **Reasoning**: Both are cases where the LITERAL spec text (a research
  distillation, not infallible) conflicts with an already-settled, tested
  invariant from an earlier task. Per the project's own precedent (T1's
  amount.test.ts null→value flips were the one sanctioned exception;
  "ANY other existing-test change = stop-and-report"), the settled
  behavior wins and the spec cell is corrected here instead of silently
  reinterpreted or worked around with a special case.
- **Note on Decision (a)'s breadth (added Task 5 review round 1)**: the
  compose-time triple substitution in `composeGuided` (`compose.ts`) is
  applied to ANY `suggest` array of shape `['HELP']`, not only the
  zero-partial-hit fallback `rankedGuidedSuggest` itself falls back to.
  `classify()`'s `DECOY_PHRASES` table can also produce a bare `['HELP']`
  directly (e.g. `카드값 땡겼어`). The composer cannot see which of the two
  produced the array — it only ever receives the intent-name list — so it
  treats the shape uniformly rather than trying to infer provenance. This
  matches Decision (a)'s own framing ("a presentation choice downstream of
  classify()"): the choice is about the shape of `suggest`, not about why
  classify() produced it.

## [2026-08-10] Assistant-brain compose() review errata (Task 5, round 1)

- **Decision (c) — §4.8 addendum: a card-open GUIDED reply with zero
  renderable options gets a dedicated ack, not the generic one.**
  `composeGuided` can legitimately end up with an empty options list while
  a confirm/askAmount/crossCurrency card is open — e.g. ko NEGATIVE §3.2's
  `ㄷㄷ` classifies as `UNKNOWN{suggest:['CONFIRM_YES','CONFIRM_NO_CANCEL']}`,
  and neither intent has a §4.8 `option.*` key (Decision, T5 divergence
  #3), so both get filtered out. Rendering the generic `ack` ("did you mean
  one of these?") immediately followed by nothing, right next to a card
  still waiting on save/cancel, reads as broken. Added a new locked key,
  `assistant.guided.cardOpenAck` (ko: "확인 카드가 열려 있어요. 카드에서
  저장할지 취소할지 선택해 주세요." / en: "Your confirm card is still
  open — choose save or cancel on the card."), rendered instead of `ack`
  exactly when `cardOpen === true` AND the filtered options list is empty;
  `escape` still always renders. `composeGuided` gained a required
  `cardOpen: boolean` field for this — T6 supplies it from
  `ctx.openCard !== null`, since this module never imports `OpenCard`.
- **Decision (d) — §4 erratum: ko `guided.option.expense` needed ICU
  quote-escaping.** The transcribed copy was `'{input}'을 지출로
적을까요?`. ICU MessageFormat treats a `'` immediately followed by a
  syntax character (`{`, `}`, `#`, `|`, or another `'`) as the start of a
  QUOTED LITERAL that runs to the next `'` — so `'{input}'` was parsed as
  a literal, unsubstituted span, and the rendered output was the bare text
  `{input}` with the quote marks consumed. Fixed by doubling the quotes —
  `''{input}''을 지출로 적을까요?` — which ICU renders as a literal
  apostrophe on each side with `{input}` interpolated normally in between
  (verified: renders `'만두 먹었어'을 지출로 적을까요?`). The en pair
  (`"Should I log \"{input}\" as an expense?"`) needed no change — ICU
  quoting only triggers on `'`, never on `"`. Added a render-smoke test
  (`compose.test.ts`'s "ICU render smoke" block) that drives every
  `assistant.*` key through `next-intl`'s `createTranslator` with dummy
  values for every placeholder and asserts no thrown parse error and no
  leftover `{`/`}` in the rendered output — the regression net for this
  whole class of defect across all 53 keys, present and future.
- **Reasoning**: (c) is a coherence gap the spec's own option table didn't
  anticipate (it never considered the "card open, nothing to suggest"
  intersection); fixing it needed one new locked key rather than reusing
  an existing one, since no existing §4.8 copy fits "the card is still
  open." (d) is a plain transcription defect — the ko cell's INTENT (frame
  the echoed input in quote marks) was right, its ICU-unsafe encoding was
  not — caught by manual review rather than the original i18n invariant
  test, which only checked KEY EXISTENCE parity between locales, not
  render correctness. The new ICU render-smoke test closes that gap.

## [2026-08-10] Assistant-brain Task 6 review erratum

- **Decision (e) — QUERY_GROUP_TOTAL's total/count keep personal spending
  EXCLUDED.** `assistant-data.ts` folds `groupTotal`/`expenseCount` from
  `engineExpenses` (`engine-map.ts`'s `isSettleable` filter: non-personal,
  non-cancelled), the same settleable set `computeNetBalances`/
  `status/page.tsx`'s own totals already use — NOT the wider `expenses`
  list `QUERY_MY_SPENDING`'s paid/consumed figures deliberately DO include
  personal spending on (spec §1, "my aggregates include personal expenses,"
  matching `total-cards.ts`). This was already the implementation as
  shipped; recorded here as a ruling (review I6) because the two
  `QUERY_*` intents READ as if they should agree ("how much have we
  spent" vs. "how much have I spent") while their underlying sets
  deliberately differ, and a future editor could easily "fix" one to
  match the other without realizing they answer different questions.
- **Reasoning**: A personal expense is, by definition, not shared with the
  group — it never enters settlement math anywhere else in the app
  (`computeNetBalances`, `simplifyDebts`, the status page's totals all
  exclude it the same way), so "how much have WE spent" including a
  purchase only one person even knows about would contradict every other
  screen's own group-total semantics. "How much have I paid," by contrast,
  is a personal accounting question the app already answers with personal
  spending folded in (the wizard lets you log a personal expense
  specifically so it counts toward YOUR OWN totals, just not the group's).
  `expenseCount` stays consistent with `groupTotal` (both settleable-only)
  for the same reason `sumWithCount`'s count must describe the same set
  its sum was folded from.

## [2026-08-10] Assistant-brain Task 7 review errata

- **Decision (f) — `으로` and its trailing politeness/request suffixes are
  fragment-check noise; the reply to the assistant's own "얼마로 바꿀까요?"
  question must not supersede the card.** A bare amount reply carrying the
  "change it TO ___" particle (`3만원으로`) — the single most natural way to
  answer that follow-up question, and 7 further natural sibling phrasings
  (`3만원으로요`, `3만원으로 해줘`, `3만원이요`, `3만원요`, `3만원 해줘`,
  `3만원으로 해주세요`, `3만원 해주세요`) — previously failed `isFragment` on
  their trailing residue and fell through to `EXPENSE_ENTRY`, superseding the
  open card with a junk draft literally described by that residue (`"으로"`,
  `"해줘"`, …). **This was destructive, not a mere unanswered question**: the
  open card — its amount, its edits so far — is gone, replaced by a new draft
  built from noise, the same class of defect as the split-half money bug
  (SOLVED.md 2026-08-10) in kind if not in stakes. Closed in two layers:
  1. `{ word: '으로', locale: 'ko' }` in `lexicons/noise.ts`'s
     `FRAGMENT_FILLER_WORDS` (substring-safe anywhere — closes `3만원으로`/
     `금액 3만원으로`/`30000원으로`).
  2. `FRAGMENT_TRAILING_WORDS` (`해주세요`, `해줘`, `요` — longest first),
     a NEW positional rule: `isFragmentIn` (`classify.ts`) strips these to a
     FIXPOINT from the very END of the remainder, AFTER
     `FRAGMENT_NOISE_CHARS`. Positional, not substring — safe precisely
     because a trailing-only match can only ever consume characters that
     were already the last un-accounted-for scrap, never eat into real
     content earlier in the message. Longest-first ordering is load-bearing:
     `해주세요` itself ends in `요`, so a shortest-first order would strip it
     to `해주세` and strand there (one syllable short of any other listed
     word), leaving the fixpoint loop stuck on a non-empty residue.
  Verified live against all 8 phrasings under BOTH open-card kinds (`confirm`
  and `askAmount`) before pinning; zero regressions across the full 1013-test
  `src/lib/assistant/` suite. Pinned as `classify.test.ts`'s `§3.4 addendum`
  block, kept out of `MODIFY_CORPUS` since these extend beyond the spec's own
  attested §3.4 corpus.
  - **Accepted safe-miss, unchanged by either round**: `금액을 3만원으로` (a
    particle riding on top of the `금액` field noun) still resolves to
    `{field:'amount', amount:null}` — the assistant asks "얼마로 바꿀까요?"
    again rather than guessing. Adding `을/를` to either noise list would
    close this too, but `을`/`를` are common enough as word-internal
    substrings (unlike a purely TRAILING check, they would need to be
    checked as a substring anywhere, since 을/를 legitimately follow a real
    noun mid-sentence too) that doing so untested is refused; a polite
    re-ask is a safe, non-destructive outcome, not a defect.
- **Decision (g) — en `groupTotal.sum`/`sumWithCount` reworded to a group
  subject.** The prior copy ("You've spent {amount} so far.") was, word for
  word up to the verb, indistinguishable from `mySpending.paid` ("You've
  paid {amount} so far.") — a real risk of the two answers reading as the
  same claim about the same person when they answer different questions
  ("how much have WE spent" vs. "how much have I paid"). ko was already
  unambiguous (우리 vs 내가) and is untouched. Reworded: `sum` → "Together
  you've spent {amount} so far."; `sumWithCount` → "Together you've spent
  {amount} so far, across {count} expenses." (same lead as `sum`, its own
  count clause folded in rather than dropped). This closes the T5/T7 carry
  item ("en groupTotal.sum's 'You've spent' near-collision with mySpending
  copy," `progress.md`) with a real fix instead of leaving it open.
- **Reasoning**: (f) is a real conversational reply the spec's own corpus
  never happened to attest, in the same "found by review, not by the spec"
  category as (c)/(d) — but unlike those two, its untreated form was
  destructive (a card-killing supersede), not merely awkward copy, which is
  why it earned a positional fragment-check rule rather than another
  lexicon entry. The corpus stays byte-faithful to the spec rather than
  absorbing this finding into it; the fix lives in its own
  `classify.test.ts` block instead. (g) is a plain copy-collision defect
  with no code-behavior
  change — `compose.ts`'s tests assert only the KEY, never the rendered
  text, so no test needed updating beyond the message file itself and the
  generic ICU render-smoke check (which passes unchanged, since it never
  hardcodes these two keys' text).
- **Decision (h) — the three §3.3-NEG bare-modify rows (`말고`/`빼줘`/`제외`)
  were flipped from their pinned `UNKNOWN{suggest:['CONFIRM_MODIFY']}` to
  concrete `CONFIRM_MODIFY` slots that render `askWhoToRemove`/
  `askWhatToChange`.** Commissioned in the final-review fix wave: the
  pinned form delivered a card-abandoning generic ack, while §2.6's own
  intent for a bare correction word is "ask who/what". Strictly better UX,
  recorded here because it edits main NEG rows, which tables-are-law
  otherwise forbids. Residual noted with it: bare `포함` (an add) reuses
  the remove-phrased ask (`누구를 뺄까요?`) because §4.7 has no
  `askWhoToAdd` key — copy candidate for the design/wording pass.

## [2026-08-11] Design overhaul T8 — ₩ system-font fallback (GA-fork ruling)

- **Decision**: `--font-sans` in `src/app/globals.css` (`:root`, the
  `@theme`-mapped design-token block) now reads `var(--font-geist-sans),
  'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif`
  instead of the bare `var(--font-geist-sans)`. All three added names are
  SYSTEM fonts already installed on their platforms — iOS/macOS (Apple SD
  Gothic Neo), Android (the name Android's bundled Noto CJK resolves under),
  Windows Vista+ (Malgun Gothic) — so this adds **zero new font loads**, per
  the plan's explicit constraint. Geist stays first in the stack, so every
  Latin glyph it already covers is unaffected; the fallback names only
  engage for a codepoint Geist's `subsets: ['latin']` build has no glyph
  for, which includes U+20A9 (₩) and all of Hangul.
  This is the **GA-fork boundary, ruled deliberately, not an oversight**:
  the full guarantee — every ₩ figure rendering cleanly for every user, on
  every OS, with no dependency on what fonts happen to be locally installed
  — needs one of (a) a webfont that actually covers U+20A9 (a new font
  load, which the plan forbids for this pass) or (b) rendering the ISO 4217
  code (`KRW 12,000`) instead of the symbol (a copy change out of scope for
  a token-file pass). Neither is done here. What this pass buys is real but
  bounded: it closes the gap on every desktop OS and every mobile OS the
  app targets, because all three ship a Korean-capable system font. It does
  **not** close a bare-Linux case with no CJK/symbol font installed at
  all — Task 7 (`docs/SOLVED.md` 2026-08-11) isolated exactly that
  environment as the one where the artifact was found and reproduced, and
  this sandbox is one, so the T8 verification screenshots taken inside it
  are still expected to show the artifact even after this fix. That is the
  correct, predicted outcome of this ruling, not a regression.
- **Reasoning**: Owner was silent when Task 7 raised this as a carry item;
  the ruling defaults to option ① from that carry note (system-font
  fallback now, webfont/ISO-code fork deferred to GA) rather than either
  blocking T8 on an owner reply or silently picking the heavier fix. KRW is
  the app's primary/default settlement currency (`groups/new`'s currency
  picker defaults to it), so the desktop/PWA share of the gap this closes is
  the majority of real usage; the deferred bare-Linux case is a minority
  platform for this app's actual audience.
