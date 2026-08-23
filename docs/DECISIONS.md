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

## [2026-08-19] Design & branding reset — only the name "Sem" survives

- **Decision**: every design/branding decision recorded so far is retired
  (brand book v1/v2, the pitch.com teardown, the Phase 4B extraction spec,
  the 2026-08-11 T8 `--font-sans` ₩-fallback ruling that used to sit here).
  The only surviving brand decision is the assistant's name: **셈 / Sem**
  (see `docs/BRAND.md`). The app name stays FairSplit.
- **Reasoning**: owner (2026-08-19) is starting a full design overhaul and
  asked for a clean slate so the new direction is not shaped by the old one.
- **Scope note**: this retires the *decisions*, not the running code. The
  current UI, tokens, fonts and Sem 3D component stay in place until the new
  design replaces them; code comments still citing the deleted docs are
  expected to go away with that overhaul.

## [2026-08-19] R1 — "ask" is a first-class answer (parser contract + goat harness)

- **Decision**:
  1. The parse result carries an ordered list `asks: Ask[]`, replacing
     `ParsedExpense.missing: Array<'amount'>` (whose only consumer,
     `resolveChatOutcome`/ChatComposer, reconstructs the same fact from
     `amount === null` anyway). `Ask = { field: 'amount' | 'payer' |
     'participants' | 'counterparty' | 'interpretation'; options?:
     AskOption[] }`. `counterparty` exists for SETTLE_RECORD (R2);
     `interpretation` options are full alternative record bundles (shape
     ruled in R5). `options` for payer/participants/counterparty are
     member ids; for `amount` an optional suggested value. SETTLE_RECORD
     results and every BatchDraft row (R3) carry the same `asks` list.
     Priority inside the list is fixed: interpretation → amount → payer →
     participants/counterparty; the composer asks `asks[0]` first.
  2. `asks` is NOT a new intent. The intent stays what the sentence is
     about (EXPENSE_ENTRY / SETTLE_RECORD); `asks` says what blocks
     saving. UNKNOWN keeps its meaning ("not understood") — an ask means
     "understood, one thing is open".
  3. The goat `Expect` shape gains `asks` (member NAMES in options,
     resolved by the harness like `payer` today). Scoring: asking where
     the row expects an ask is CORRECT; asking where the row expects none
     is a FAILURE — an ask is never a free pass, so a parser cannot buy
     accuracy by asking everywhere. A row without `expect.asks` means the
     derived default: `[{field:'amount'}]` when `expect.amount === null`,
     else `[]` — every existing row keeps passing without edits.
  4. Fuzz gates extend: on a fuzz sentence, a SETTLE_RECORD of any shape,
     an EXPENSE_ENTRY with an amount, or an ask of kind payer/
     participants/counterparty/interpretation is a false positive. The
     pre-existing amount-ask class (EXPENSE_ENTRY with `amount: null`;
     measured today: ko 9 rows, en 0) stays tolerated — no existing fuzz
     row is edited — but the harness REPORTS it as a number so it can
     shrink.
  5. App rule (binding on W2): `asks.length > 0` ⇒ never a plain confirm
     card; the card asks `asks[0]`. A bare CONFIRM_YES never resolves an
     `interpretation` ask (it has ≥2 live readings; the user must tap an
     option).
- **Reasoning**: Today "ask" exists as five unrelated shapes
  (`missing:['amount']` → askAmount card; `UNKNOWN{suggest}`;
  `CONFIRM_MODIFY` with `memberId: null`; the dialogue engine's
  `Resolution.ambiguous`; the items card's unpriced lines), and the corpus
  can express only the first. R4 (hearsay), R5 (composite amounts),
  homograph names and batch rows with a missing payer all need "the right
  answer is a question" about a payer, a counterparty or an
  interpretation — the fixture must be able to say so, and the app needs
  ONE router from ask to card. Generalizing `missing` (already a list on
  the parse result, already what the composer routes on) is the smallest
  change that covers every case. Rejected: a separate ASK intent (drops
  the parsed draft out of the result, collides with UNKNOWN's role, and
  silently escapes the fuzz gate keyed on EXPENSE_ENTRY); fixture-only
  `ask` with no type change (payer/interpretation asks would assert
  nothing observable).

## [2026-08-19] R2 — SETTLE_RECORD: repayments/settlements are a separate intent

- **Decision**:
  1. New intent `SETTLE_RECORD { from, to, amount, currency, asks }` —
     `from` = the member whose money moved (sender/repayer), `to` = the
     receiver, both read from the sentence; a missing side becomes
     `asks: [{field:'counterparty'}]` (the actor fills the other side by
     default: "sam paid me back" → from Sam, to actor). Bare settlement
     confirmations with no amount ("we're square", "퉁치자") parse to
     SETTLE_RECORD with `amount: null` — whether they fire at all outside
     a supporting dialogue state is Stage 6's gate, and the composer (not
     the pure parser) proposes the current pairwise balance on the card.
  2. Storage is unchanged (2026-07-30 ruling stands): a saved settlement
     is an ordinary expense with payer = `from` and participants =
     `[to]`. The card is a dedicated "settlement record" confirm (says
     who → who), not the expense confirm.
  3. Boundary: debt STATEMENTS stay expenses — "sam owes me 20" / "i owe
     sam 20" assign a debt (someone fronted money: PLAN 4.2), no money
     moved today. SETTLE_RECORD is only for money having MOVED (paid
     back, venmoed/zelled/sent/received, 갚았어/보냈어/받았어/입금/이체/
     토스) or an explicit "we are settled" confirmation.
  4. Sanctioned re-annotation (explicit, narrow exception to the
     "existing ko rows unchanged" inviolable, reported here per the
     conflict rule): the existing ko dative transfer rows currently
     pinned as EXPENSE_ENTRY with participants [actor, X] — "민수한테
     3만원 보냈어", "민수에게 3만원 줬어", "서연이한테 2만원 줬어",
     "민수한테3만원보냈어" (F-1), "유나가 보냈어" (known-miss) — are
     re-annotated to SETTLE_RECORD by W5 as part of this ruling. No other
     existing row may change. (사줬어 "bought for" stays an expense —
     the give-verb alone is not the signal; the dative + money-moved
     frame is.)
- **Reasoning**: This error class flips the sign of a debt — the worst
  possible error. Measured today: "민수가 3만원 갚았어" books a 30,000
  expense with the ACTOR as payer (backwards); "sam paid me back $20"
  books Sam paying $20 split across all five members (backwards AND
  spread); "venmoed sam 30" loses direction entirely. A separate intent
  is chosen over a field on EXPENSE_ENTRY because the direction rule is
  the OPPOSITE of the expense payer rule (subject = payer vs subject =
  sender), and a field would make every consumer of EXPENSE_ENTRY (cards,
  fuzz gates, scoring, batch rows) responsible for branching on it — one
  missed branch reintroduces the sign flip silently. A separate intent
  makes ignoring it a type error. Deferral was rejected: repayments are
  among the most frequent real sentences (they are how groups actually
  close out), and the current behavior is not "unsupported" but
  "confidently wrong".

## [2026-08-19] R3 — batch fixtures live in their own files, unread rows are explicit

- **Decision**:
  1. New fixtures `test-fixtures/goat/batch-ko.json` / `batch-en.json`,
     same `_members/_actorId/_currency/_locale` header as the sentence
     corpora, rows shaped `{ text, expectRows: [RowExpect, ...], note?,
     known? }` — one input, N expected rows. `RowExpect` = the R1-extended
     `Expect` plus `status: 'row' | 'unread' | 'total'`. `'total'` is a
     checksum line ("total 98000"): asserted as read-but-not-an-expense,
     compared against the sum of the other rows. An `'unread'` row
     carries the source text span it covers, so the coverage check can
     verify WHICH line was surrendered, not just how many.
  2. Coverage invariant, asserted by the harness: every input line and
     every amount hit appears in `expectRows` as a row or an explicit
     unread row — silent loss is a test failure, in both directions
     (a produced row the fixture doesn't expect also fails).
  3. Entry condition (when the segmenter engages at all):
     `amountMentions ≥ 2`, or a newline plus 2+ amounts — `mentions` is
     already computed by the pipeline, so the trigger is free.
  4. The existing `ko/en-sentences.json` stay single-expectation files and
     are not touched by batch work — the "existing rows unchanged" gate
     stays auditable as "file untouched" (R2's sanctioned re-annotation
     is the one exception, listed there).
- **Reasoning**: Measured grounding: a 3-line batch today collapses into
  ONE expense with line 2's payer bound to line 1's amount ("lunch $20,
  dinner $45 sam paid, and cab $18" → $20, payer Sam) — a plausible-
  looking wrong card. One-to-N scoring is a different harness contract
  (segment → per-row check → coverage invariant), so folding `expectRows`
  into the existing Row type would union the fixture schema and force
  every existing-file diff to be re-audited; separate files keep both the
  schema and the no-edit gate clean. Count-only unread accounting was
  rejected because the invariant's whole point is IDENTITY (which line
  was dropped), the LLM-class failure this feature exists to beat.
  Note for W2: the chat input is a single-line `<Input>`
  (ChatComposer.tsx) — newline-form batch requires the composer to accept
  multi-line input; connective-form batch does not.

## [2026-08-19] R4 — hearsay/hedging demotes to a confirmation ask, never silently records

- **Decision**:
  1. A hedging/hearsay marker on an otherwise-recordable sentence keeps
     the parsed intent and slots (EXPENSE_ENTRY or SETTLE_RECORD, amounts
     and people read as usual) and appends `asks:
     [{field:'interpretation', options: [record-as-heard, discard]}]`.
     Auto-recording is forbidden: the card must name the hedge ("들은
     얘기 같아요 — 기록할까요?"), a batch-table row with a hedge is
     status `ask`, never `completed`, and per R1 a bare CONFIRM_YES does
     not resolve it — the user taps an option.
  2. Marker lexicon seed (payload data, grows red-first from here):
     - ko: -다던데/-라던데, -다더라/-라더라, 카더라, 듣기로는, 들었는데,
       아마(도), ~인 것 같아, ~였나/~던가, 인가
     - en: said/says (incl. quoted speech "he said 'i'll pay'"),
       apparently, i think, i guess, i believe, maybe, probably,
       supposedly, iirc / if i remember right
  3. Hedge markers only ever DEMOTE (recordable → ask); they never create
     an entry from a sentence that wasn't otherwise recordable, and they
     never change a captured value.
- **Reasoning**: Measured today: "민수가 3만원 냈다던데" books a 30,000
  expense with payer 민수 — hearsay recorded as fact. The English
  hedges ("i think it was 40", "apparently dinner was 80") come back
  UNKNOWN today only by ACCIDENT — bare 2-digit numbers aren't money yet —
  and will flip to confident cards the moment Stage 4 accepts bare
  numbers, which is why this ruling must precede corpus writing. Keeping
  the parsed draft (rather than demoting to UNKNOWN) preserves
  "reviewing beats retyping": the user confirms or discards one card
  instead of retyping the whole sentence. Status quo was rejected
  because the batch review table and any future confidence gating would
  classify hearsay rows as complete.

## [2026-08-19] R5 — narrative arithmetic resolves via an interpretation ask of complete record bundles

- **Decision**:
  1. Detection is rules-only (W1 skeleton; verb vocabulary is a language
     plugin): two amount hits + a transfer/contribution verb (gave,
     chipped in, covered, threw in, handed; 줬-/보태-/빼-/제하-) + a
     contrast/causal connective (but, so, minus; -는데/-니까/빼면/제하고).
  2. Resolution is an `interpretation` ask whose options are COMPLETE
     record bundles — each option is an array of drafts, and choosing one
     applies exactly those records. For "저녁 8만원 냈는데 민수가 2만원
     줬어": option A = [expense 80,000 payer actor] + [SETTLE_RECORD from
     민수 to actor 20,000]; option B = [one expense only]. A derived
     amount (80,000 − 20,000 = 60,000) may appear ONLY inside an
     explicitly labeled option showing its arithmetic — never pre-filled,
     never default, never auto-saved. Tapping the option IS the user
     supplying the number, which satisfies invariant 4.8 (the ask is the
     "when insufficient, ask" branch; nothing uncertain is saved without
     the user's explicit choice).
  3. The parser never forces a single numeric answer for this pattern,
     and never auto-picks a bundle.
- **Reasoning**: Measured today this pattern fails three different ways:
  "hotel 300 minus the 50 alex handed me" → a confident $300 card
  (plausible wrong answer); "저녁 8만원 냈는데 민수가 2만원 줬어" → the
  multiAmount dead-end notice; "dinner was 80, sam gave me 20" → no
  amount at all. A numeric-only ask ("60 or 80?") was rejected because it
  cannot express the CORRECT accounting — an 80,000 expense plus a
  20,000 repayment — which is the entire failure mode this ruling blocks
  (arithmetic right, accounting wrong). Detect-only (UNKNOWN + notice)
  was rejected as another dead end: the user would hand-enter two records
  the parser had already read.

## [2026-08-19] Corpus process rules (PLAN.md 1.2, made law)

- **Decision**:
  1. **Red-first**: supporting a new expression always means corpus row
     added → failure confirmed → parser fixed, in that order.
  2. **No expect-editing**: never adjust an expectation to match parser
     output. A mismatch is resolved only via `known` + a written reason,
     or a DECISIONS ruling (as R2's re-annotation exception demonstrates:
     the ruling comes first, the edit cites it).
  3. **Role separation**: corpus-generation sessions never see parser
     source — they receive personas, scenarios, and the schema only.
     (W3's charter extends this to its generator scripts: script-writing
     sessions and sentence-generating sessions are separate.)
  4. **Blocking-question exception**: implementation questions remain
     forbidden mid-run. Expectation-semantics rulings ("what is the
     correct answer for 'i think it was 40'?") are product decisions and
     may block — amended for autonomous workers (WORKERS.md): quarantine
     to docs/QUESTIONS.md, pin the row known-pending (reason: awaiting
     ruling), continue; the owner drains the queue.
  5. Precedence on conflict: newest DECISIONS ruling > PLAN.md >
     WORKERS.md — and the conflict itself must be reported, never
     silently resolved.
- **Reasoning**: These four rules are what made the Korean corpus
  trustworthy (the goat harness's own header bans weakening rows); they
  are recorded here because Waves 1–2 run them across five parallel
  workers, where an unwritten rule is a rule each worker reinvents
  differently. The ruling of record for R1–R5 lives in the five entries
  above; Wave 0 is complete and workers may launch against them.

## [2026-08-20] Rulings session #2 — the Wave-1 question queue, drained

Every entry in `docs/questions/{W1,W2,W3,W4}.md` and every owner-facing row
of `docs/requests/{W1,W2,W3,W4}.md` was put to the owner in one interactive
session. Each ruling below carries a stable id (`D2-n`); the question and
request files cite it. Precedence: these rulings are the newest DECISIONS
entries, so they outrank PLAN.md and WORKERS.md wherever they speak
(Corpus process rules 5). Wave 2 may launch against them.

### D2-1 — Recognizers make-or-buy: MAKE. The oracle stays as a tripwire

> **VOID 2026-08-21.** The parser this measured was removed with the chat
> surface (docs/PROMPT.md [2026-08-21]). The oracle, its report under
> `docs/oracle/`, the CI drift gate and the `@microsoft/recognizers-text-suite`
> devDependency are all gone. Kept as the record of a decision that was made
> and why, not as a standing rule.

- **Decision**: PLAN.md 4.1(c) is closed as a measured **NO-BUY**. Our own
  English amount extractor stays the candidate generator.
  `@microsoft/recognizers-text-suite` remains a devDependency pinned exactly
  at `1.3.1`, and `docs/oracle/recognizers-report.{md,json}` keeps being
  regenerated by every `npx vitest run` with CI failing on a drift — it is
  now a regression tripwire, not a pending adoption decision. W4 keeps
  mining fixtures.
- **Reasoning**: the criterion is "at least half of our known amount misses,
  with zero new fuzz false positives". W3 measured 8 of 18 (44.4%) on
  `w3-data`. Re-run on merged main the population is different, because W4's
  amounts axis fixed ten of those misses natively and their pins were
  deleted: **1 of 8 (12.5%)** against the 50% baseline. The cost side moved
  the other way at the same time — settled rows where we are right and
  Recognizers is wrong grew from 26 (4 real regressions) to 55 (**30 real
  regressions**: the `a grand` / `5 grand` / `a fiver` / `twelve fifty` /
  `99 cents` / `30ish` families, all of which W4 built). So adoption would
  now buy one candidate (`split it half` → 0.5, which is not money) and pay
  30 working rows for it. A hybrid ("consult Recognizers only when we find
  nothing") was rejected: it adds a second engine to the hot path and hands
  back 45 extra non-money candidates on 998 fuzz rows for the same single
  win.

### D2-2 — Real user sentences never enter the repository verbatim

- **Decision**: output of `scripts/corpus/recover-chat-logs.mts` — and any
  future recall harvest of real sentences — is **staged outside git**.
  `test-fixtures/staging/chat-log-recovered.json` is untracked and
  gitignored alongside the existing `*.local.json` quarantine files. Only
  **rewritten** sentences enter the repo: member names replaced, non-member
  names and any other personal detail removed by hand, entering as ordinary
  corpus rows whose `note` cites the run label — never the original text.
  The 8 rows currently tracked (label `local-dev`, the owner's own
  smoke-test lines) go with the file; W3 already recorded them as too thin
  to be corpus material.
- **Reasoning**: the script's redaction is provably complete only for names
  it can identify as members. W3 recorded the residual limit itself: a
  friend, a payee or a restaurant named in a sentence is not a group member,
  so nothing marks it and nothing redacts it. A commit is permanent, so the
  one irreversible step is the one that must not rely on a redactor that
  cannot see everything. Rewriting costs a human read per sentence, which is
  the same read R-W3-2 already demanded — the ruling only changes where the
  read's output lands.
- **Consequence**: R-W3-2's wording ("READ … before committing it") is
  superseded. Run the recovery, read the output, rewrite what is worth
  keeping; the recovered file itself is never committed.

### D2-3 — The Gemini chat fallback is env-gated, off in dev/test/e2e

- **Decision**: `interpretUtterance` leaves the chat path behind a single
  environment flag. Default **off** in development, test and e2e — those
  environments are rules-only from now on. Production keeps the fallback
  until the English rebuild lands, at which point the flag is removed and
  the call site with it. Receipt scanning is untouched (PLAN.md 1.3 disables
  the CHAT fallback only).
- **Reasoning**: PLAN.md 1.3's ordering ("recover first, disable second")
  exists to stop data being lost, and W3 measured that there is nothing to
  lose: the fallback persists nothing, and the artefact that matters — every
  `ChatMessage` a user typed — accumulates whether the fallback runs or not.
  So the ordering constraint is satisfied trivially and no longer blocks
  R-W3-1. Off in dev/e2e makes every wave-2 measurement honest (a fallback
  that quietly produces a card masks exactly the failures the corpus is
  built to catch); on in production keeps the shipped product working while
  80 pinned reds are still open.
- **Closes**: R-W3-1 (was: blocked on R-W3-2).

### D2-4 — Q-W1-02: an unstated per-row payer asks only where inheritance is plausible

- **Decision**: reading (B), the shipped default, is law. A batch row that
  states no payer takes the scope header's payer if there is one; otherwise
  it raises `asks: [{ field: 'payer', reason: 'omitted-payer' }]` **only
  when at least one other row states a non-actor payer**; otherwise it keeps
  the actor default and status `completed`.
- **Reasoning**: (A) "always ask in an engaged batch" charges three payer
  taps for `점심 2만원 / 저녁 45000 / 택시 8000`, which is the common case
  and the reason batch entry exists. (C) "never ask" books `lunch $20` and
  `cab $18` to the actor with no flag in a list that names Sam on the middle
  line — the silent inheritance R3/PLAN 5 forbid. (B) fires precisely where
  the list itself provides evidence that inheritance is live.

### D2-5 — Q-W1-04: in a batch, a line-leading name attributes; a trailing name asks

- **Decision**: batch-only structural rule. `Name:` / `Name -` at the start
  of a line attributes that line to that member as **payer**, and the
  separator is not description text (`지훈: 고기 8만원` → payer 지훈,
  description `고기`). A bare name **trailing** a batch row raises a payer
  ask rather than binding silently. Single-sentence behaviour is unchanged:
  outside batch a bare member name is still a participant, so no existing
  corpus row moves.
- **Reasoning**: in a list, `Name:` is the near-universal attribution
  convention and reading it as a participant loses the line's whole point,
  plus the `: 고기` cosmetic. A trailing name is genuinely ambiguous, so it
  gets a question rather than a guess — binding it outright would move money
  onto a person the sentence never named as payer, which is the class R1/R4
  exist to prevent.

### D2-6 — Q-W1-05: a payer bound to its own amount does not cover the other clusters

- **Decision**: the discriminator is structural. If the segment's only payer
  event is **bound to its own amount** (`12만원은 서연이가 미리 냈음`), it
  does not cover the earlier clusters: when the segment also states a total,
  raise an R5 `interpretation` ask whose options are complete record bundles;
  when it does not, raise a payer ask on the uncovered clusters. A payer
  event with **no amount of its own** trailing the list
  (`13000원 김치찌개, 7000원 콜라 민수가 냈어`) keeps today's behaviour and
  covers the whole segment.
- **Reasoning**: the two measured sentences differ in structure, not in
  mood, so the rule can be structural instead of probabilistic. The
  숙소비 case is also literally narrative arithmetic — a total and a part —
  which is the shape R5 already rules on, so it routes into machinery that
  exists rather than into a bare "who paid?" question that has no good
  answer.

### D2-7 — INT-2: revoking a scope row is a BatchOverrides entry, not a per-row edit

- **Decision**: `BatchOverrides` gains a scope-revocation entry keyed by the
  scope line's offset, fed back into `parseBatch` like `join`/`split`. The
  draft stays derived from one producer.
- **Reasoning**: merge/split already re-run the segmenter through
  `BatchOverrides`; revocation is the same shape and belongs in the same
  channel. Making per-row edits the revoke path would leave the scope row
  still rendering "applied across rows" while the rows below it no longer
  obey it — a UI that states something false — and would charge one edit per
  affected row.

### D2-8 — Q-W1-03: the R5 interpretation ask keeps all three bundles

- **Decision**: three options stand — `expense-plus-settlement`,
  `single-expense` (as read), `single-expense-derived` (arithmetic shown,
  omitted when not positive).
- **Reasoning**: R5 exists so the parser does not guess between readings;
  the option set IS the answer. Dropping the as-read bundle removes the only
  option whose amount is literally in the sentence (invariant 4.8); dropping
  the derived one removes the net figure most users mean. The derived bundle
  already disappears when it is not positive, so the degenerate cases do not
  show three.

### D2-9 — Q-W3-2: under an interpretation ask the draft carries the first literal amount

- **Decision**: W3's applied assumption is law. The draft's `amount` holds
  the first literal amount (80,000 in `저녁 8만원 냈는데 민수가 2만원 줬어`);
  the `PROVISIONAL` notes come off the generated `composite-amount` rows and
  no regeneration is needed.
- **Reasoning**: the row is not a failed parse — the money was read, only
  the record shape is open — and `null` would render it identically to a
  `no-amount` unread row in the batch table. It also agrees with D2-8's
  as-read bundle.

### D2-10 — Q-W3-3 + Q-W3-4: a bare settlement confirmation is dialogue-gated, and carries its amount ask

- **Decision**: a bare confirmation (`we're square`, `퉁치자`) produces
  `SETTLE_RECORD` **only when the dialogue state supports it** — an open
  settle card, or a previous turn that named the counterparty. Otherwise it
  stays `UNKNOWN`. When it does fire it carries `asks: [{ field: 'amount' }]`
  (plus `counterparty` when unbound), and the composer's pairwise-balance
  proposal enters as that ask's suggested **option**, not as a replacement
  for it.
- **Reasoning**: the pinned English row `we're square → UNKNOWN` is pinned
  for a stated reason — `square` is a pairwise frame and "we" binds no
  member — so a dialogue gate keeps it correct without any expect-editing,
  which R2's five-row Korean re-annotation exception would not have covered.
  R1.1 already allows an `amount` ask to carry a suggested value, so
  "the parser asks" and "the composer proposes" are both true at once
  instead of contradicting each other. Firing with no supporting state would
  put a settlement card on screen for a passing remark.
- **Affects**: the staging `settle-confirmation` family gains the
  dialogue-state precondition; Stage 6 inherits the gate rather than the
  question.

### D2-11 — Q-W4-1 / Q-W4-2 / R-W4-2: PLAN 4.1 wins; the erratum's English half is retired

- **Decision**: the 2026-08-10 erratum's English rule ("a bare 1–2-digit
  number is a count, not money") is **retired**. PLAN.md 4.1's bare-number
  policy with decoy blocking is the law of record. All seven re-annotated
  English rows stand (`paid 45 for lunch`, `taxi 20`, `paid 45 for lunch can
  you split it`, `put 60 on the hotel`, `45.60`, `I owe for the groceries,
  like 35`, `the check came out to 80, split three ways`), as does W4's
  re-pin of `samsung phone charger 40 → EXPENSE_ENTRY 40` in
  `classify.test.ts`. The erratum's **Korean** half (`커피 2` → no amount)
  is untouched.
- **Reasoning**: W4's entire amounts axis, including the decoy stack that
  makes bare numbers safe, is built on the plan's premise; reverting the
  premise discards the work that made it defensible. The precedence conflict
  W4 reported (newest DECISIONS entry vs a later PLAN) is resolved here, in
  the newest DECISIONS entry, as the rule requires.

### D2-12 — Q-W4-3: `I owe for the groceries, like 35` is an expense with a payer ask

- **Decision**: `EXPENSE_ENTRY`, amount 35, payer unknown →
  `asks: [{ field: 'payer' }]`. The `known` pin comes off in the same change.
- **Reasoning**: PLAN.md 4.2 reads `i owe X` as "X fronted it", so the actor
  is the one person the sentence rules OUT as payer — today's card states
  the opposite. contract-v2 landed the ask that makes the right answer
  expressible, which is exactly what the pin was waiting for. `zelle me for
  the groceries` is a different class (no amount) and is not covered here.

### D2-13 — Q-W4-4: a lone bare number opens an entry card

- **Decision**: `45.60` or `20` typed with no card open opens an expense
  card with an empty description, as `$45.60` always has. No
  `description` ask is added to the `Ask` union.
- **Reasoning**: it matches the marked-amount case and the Korean 3+-digit
  rule, and the open card with an empty description already asks "what was
  this for?" in the only place the user can answer it. Asking first would
  require extending R1's `Ask` field enum and every fixture's grammar with
  it, to save nothing.
- **Consequence**: the bare-digit rows of `duckling-en-decoys.json` (`33`,
  `100,000`, `100k`) are **not** promotable as negatives — under this policy
  they are amounts. The ordinal and word-numeral rows are unaffected.

### D2-14 — Q-W4-5: the MultiWOZ system-turn rows keep their intent

- **Decision**: the five promoted MultiWOZ rows keep
  `intent: EXPENSE_ENTRY, payer: actor, participants: everyone`.
  `Expect.intent` stays a required field.
- **Reasoning**: the expectation is derived from the spec's P5 rule, not
  from parser output, and given the sentence text alone it is the correct
  answer — the parser has no channel that could know a sentence was a
  booking agent's turn. Making `intent` optional to sidestep the question
  would hand every future row a way to dodge the hard call, which is a
  larger cost than the discomfort of these five.

### D2-15 — Q-W1-01: a hedge marker is consumed from `description`

- **Decision**: option B. A hedge marker's span is consumed like any other
  read span, so `apparently dinner was $80` yields the description
  `dinner was`. R4.3 gains an explicit carve-out: a hedge never changes a
  captured **value** (amount, payer, participants, counterparty); the
  marker's own span may leave `description`.
- **Reasoning**: both `en/signals.ts` and `ko/signals.ts` are still empty
  stubs, so no hedge row is pinned anywhere and the rewrite cost is zero
  today and rises with every row written later. The alternative leaves
  hedge words in card titles, which is user-visible copy.

### D2-16 — Q-W3-1 + R-W4-7: Korean approximations and ranges match English

- **Decision**: full parity. `3만원쯤`, `3만원 정도`, `한 3만원` resolve to
  the stated value; `2~3만원` / `3만원~5만원` become an amount ask. W5 adds
  the Korean range rows red-first, then W4 (parsers owner) lifts
  `dropRanges`' Hangul-free gate.
- **Reasoning**: the distinction PLAN 4.1 draws for English — an
  approximation is an amount FORM, a range is two candidates — is a property
  of the expression, not of the language. Parity also keeps invariant 4.8
  satisfied (30000 appears literally in `3만원쯤`). The staging rows W3
  generated under this assumption stand unchanged.

### D2-17 — Q-W2-1 + R-W2-R1: give `emailVerified` a producer and gate on the column

- **Decision**: `src/auth.ts` gains an Auth.js event that stamps
  `User.emailVerified` when an OAuth account links, and
  `src/app/dev/role-policy.ts` drops its OR clause and tests
  `emailVerified !== null` alone. R-W2-R1 moves from optional to live work.
- **Reasoning**: the effect on who gets the dev role is identical today —
  the ruling only writes down, in one place, the claim the OR clause was
  already making. PLAN Stage 2's wording ("matched only against
  verified-email accounts") becomes literally true, and a future reader of
  the gate no longer has to re-derive why a linked OAuth row counts.

### D2-18 — Q-W2-4: the composer becomes multi-line; Enter inserts a newline

- **Decision**: `ChatComposer`'s `<Input>` becomes a `<textarea>` that grows
  with its content. **Enter inserts a newline**; the existing SEND button
  sends; Ctrl/Cmd+Enter also sends for desktop habit.
- **Reasoning**: measured, not assumed — no e2e spec sends with Enter. All
  60 `chat-input` call sites fill the field and click `chat-send`, so W2's
  stated cost ("touches every e2e spec") does not exist. Enter-to-send with
  Shift+Enter for a newline is the desktop convention, but this app is
  phone-first and phone keyboards have no Shift+Enter — it would leave
  newline-form batch, the whole point of the change, unreachable on the
  primary device.

### D2-19 — Q-W2-2 + Q-W2-3: no `User.role` column, and `/dev/sem` stays open

- **Decision**: both of W2's assumptions stand. The role is computed per
  request from the `DEV_EMAILS` allowlist plus verification state — no
  stored column. `/dev/sem` keeps no role check.
- **Reasoning**: one source of truth cannot diverge from itself, and adding
  the column later is an additive migration if a per-account grant is ever
  wanted. The Sem lab exposes no data, and gating it would 404 it for the
  owner on any machine where `DEV_EMAILS` is empty.

### D2-20 — Owner-facing requests: two approved, two deferred

- **Decision**:
  - **R-W2-R4 approved**: `src/lib/receipts/gemini.ts`'s endpoint gains an
    environment base-URL override, matching `FRANKFURTER_BASE_URL` /
    `FXRATESAPI_BASE_URL`. The dev scan-limit LIFT then becomes e2e-able and
    "no test may reach a live provider" goes back to being the
    environment's job rather than each spec's discipline.
  - **R-W4-6 deferred**: the `lunch ,` dangling comma stays as it is.
  - **chrono-node PRE-APPROVED** (amended 2026-08-20, same session): PLAN.md
    4.7 already rules the adoption ("Adopt chrono-node (MIT) for time
    windows … EDIT path only"), and 4.0 lists it among the external
    components accepted under the deterministic-TS / clean-license / living-
    repository filter. Because a DECISIONS entry outranks PLAN.md, the first
    reading of this ruling would have silently overturned 4.7 and left W4's
    edit-reference axis contradicted rather than merely unstarted. The
    dependency is approved now; landing it still follows red-first — the
    corpus rows come first, then the parser change — and it stays EDIT-path
    only with an injected `ref` timestamp for determinism, per 4.7.
  - **R-W4-4 deferred**: no `ParseContext.locale`. The script rule (no
    Hangul token ⇒ English policy) stands, and every Korean row stays
    byte-identical. Revisit when a mixed-roster row exists to verify against.

### D2-21 — `3 x 25` is an amount form that resolves, with its arithmetic shown

- **Decision**: quantity × unit price resolves (`3 x 25` → 75) and the card
  shows the derivation (`3 × 25 = 75`). Invariant 4.8 gains an explicit
  carve-out for multiplication forms: the derived value is admissible
  because both operands are literally present and the card displays the
  operation.
- **Reasoning**: PLAN.md 4.1 lists it among the FORMS to accept, beside
  `12$` and `1.2k`. Routing it through an R5 interpretation ask would charge
  a tap on an unambiguous expression; declining it drops a form the plan
  committed to. This unblocks one of W4's blocked amount axes.

### D2-22 — Q-W3-5 closed by integration, not by ruling

- **Decision**: no ruling needed. W1's contract-v2 independently adopted
  `scope` as the fourth batch row status, the review table renders it, and
  `parseBatch` emits it. W3's applied assumption became the contract.
- **Reasoning**: recorded so the question is not re-opened. The live
  remnant was the missing revocation channel, ruled in D2-7.

### D3-1 — Free-text entry is abandoned; the flow becomes guided (2026-08-21)

- **Decision**: the chat surface and the natural-language parser are removed
  from the product and sealed in `archive/chat-sealed-2026-08-21.tar.gz`
  (git tag `pre-chat-removal-2026-08-21`). Expense entry will be a guided,
  step-by-step flow. Every earlier decision that only exists to serve
  free-text entry — the parser rulings, the corpus programme, the dialogue
  layer, the dev-mode mining loop — is void as a standing rule and kept only
  as a record.
- **Reasoning**: owner's ruling. A free-text box asks the user to compose;
  most people will not, and the parser needed to forgive them turned into
  the largest and least reliable part of the codebase (~60k lines against a
  5k-line settlement engine). Leading the user through a fixed path removes
  the interpretation problem entirely, and the cost — less freedom — is one
  the target user does not want to pay for anyway. Constraint on the
  replacement: a guided path that violates intuition gets rejected, so
  every capability the chat flow had must still be reachable.
- **Kept**: the settlement engine, the exchange-rate model, receipt
  scanning, the manual entry wizard.
