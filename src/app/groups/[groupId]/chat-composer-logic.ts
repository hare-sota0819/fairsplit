import { composeConfirm } from '@/lib/assistant/compose'
import {
  resolveReference,
  type RecentExpenseLite,
} from '@/lib/assistant/context-commands'
import type {
  AssistantAnswer,
  EditAction,
  TimeWindow,
} from '@/lib/assistant/types'
import { parseAmountToMinor } from '@/lib/format'
import type { ChatMember, ParsedExpense } from '@/lib/chat-parse'
import { findMembers } from '@/lib/chat-parse/people'
import { parseItems, type ParsedItemList } from '@/lib/chat-parse/items'

/**
 * What the composer does with a parse, once amount validity is checked. Pure
 * — no React, no I/O — so the two-way branch (ask for the amount / show the
 * confirm card) has one tested source of truth instead of being re-derived
 * inline wherever the component needs it.
 *
 * `askAmount` covers two distinct parser outcomes that the UI must treat
 * identically: a sentence with no money mention at all (`amount === null`),
 * and one with a syntactically-plausible but unusable mention (e.g. an
 * absurd `'1e+21'` that `parseAmountToMinor` rejects). Neither may reach
 * save, and neither should crash — both just ask.
 *
 * A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차"): there used to be a
 * third outcome here, `crossCurrency`, whenever the parsed currency differed
 * from the chat's default — it bounced the whole draft to the wizard with no
 * way back into the chat. That dead end is gone: a foreign-currency parse now
 * resolves to the SAME `confirm` outcome a same-currency one does (carrying
 * its own `currency`, not the caller's default), and `ChatComposer` shows an
 * inline funding-source section on the card whenever that currency differs
 * from the group's settlement currency.
 *
 * A2 REVIEW FOLLOW-UP (same date): removing `crossCurrency` also removed its
 * accidental side effect of protecting multi-amount sentences — a genuinely
 * multi-item sentence ("13000원 김치찌개 3개, 7000원 콜라 2개, 400000원
 * 와규 2개") used to bounce to the wizard for an unrelated reason (a foreign
 * currency was rare in the same breath as multiple items) and never got the
 * chance to confidently save the wrong number. `multiAmount` is the outcome
 * that closes that gap directly: `parsed.amountMentions >= 2` (`parse()`'s
 * own field, chat-parse/index.ts) means `amount` above is only the FIRST of
 * several, and this MUST be checked before the ordinary
 * amount-validity checks below — a valid-looking first amount is exactly the
 * "confidently wrong number" case this guards against.
 *
 * TASK 3 (docs/handoff/B-multi-item-chat.md, "라우팅 교체 지점"): the owner
 * called `multiAmount` too defensive — a structured sentence like the one
 * above IS parseable, and bouncing it to a bare notice card threw that
 * structure away. `multiAmount >= 2` no longer stops at a notice: it first
 * tries `parseItems` (`chat-parse/items.ts`, Task 1) on the SAME raw
 * sentence, and a clean parse (≥2 items, one currency, every unit price
 * valid) now returns `confirmItems` — the "who had what" card
 * (`ChatAssignCard`) instead of a dead end. `multiAmount` itself is NOT
 * retired: `parseItems` returning `null` (mixed currencies, an unusable unit
 * price, or fewer than 2 clean items even though ≥2 amounts were mentioned)
 * still falls back to the exact same notice-card outcome as before — the
 * "never a confidently wrong number" guard this whole branch exists for is
 * unchanged, only its escape hatch got smarter.
 */
export type ChatOutcome =
  | { kind: 'askAmount' }
  | { kind: 'multiAmount' }
  | { kind: 'confirmItems'; items: ParsedItemList }
  // `amount` is the same validated decimal string parsed.amount already was —
  // handed back here so callers never need a non-null assertion to recover
  // it after this function has already proven it is usable.
  | { kind: 'confirm'; amount: string; amountMinor: bigint }

export function resolveChatOutcome(
  parsed: Pick<ParsedExpense, 'amount' | 'currency' | 'amountMentions'>,
  // The RAW sentence, not `parsed.description` — `parseItems` needs the
  // untouched text (amounts, quantity markers and item names all still in
  // place) to find item boundaries; `parse()`'s own `description` has
  // already had every consumed span stripped out from under it.
  rawInput: string,
  // members/actorId feed `parseItems`' assignment reading ("우동은 내가
  // 다먹었고 콜라는 수탉이"); defaultCurrency is its fallback for a line
  // with no explicit currency — deliberately not `parsed.currency`, which is
  // already resolved to the FIRST amount's currency, the wrong fallback for
  // the other lines of a multi-item sentence.
  ctx: { members: ChatMember[]; actorId: string; defaultCurrency: string },
): ChatOutcome {
  // 2026-08-14 live-app fix round: parseItems is tried on EVERY sentence, not
  // only `amountMentions >= 2`. The owner's "2만엔짜리 치킨 덮밥 2개랑 콜라
  // 하나" carries ONE marked amount, so the old gate never let the items
  // parser see it — the single-amount path then booked the unit price as the
  // total (×2 dropped) and the unpriced cola vanished. parseItems itself now
  // decides what enumerates (quantity markers / ≥2 priced lines) and returns
  // null for every plain single-amount sentence, so this is not a widening
  // of what becomes an items card by accident — it is the parser's own
  // acceptance rule replacing a coarser proxy for it.
  const items = parseItems(rawInput, ctx)
  if (items !== null) {
    return { kind: 'confirmItems', items }
  }
  if (parsed.amountMentions >= 2) {
    return { kind: 'multiAmount' }
  }
  if (parsed.amount === null) {
    return { kind: 'askAmount' }
  }
  const amountMinor = parseAmountToMinor(parsed.amount, parsed.currency)
  if (amountMinor === null) {
    return { kind: 'askAmount' }
  }
  return { kind: 'confirm', amount: parsed.amount, amountMinor }
}

/**
 * Task 3 (docs/PROMPT.md [2026-08-14] decision 2) — what a `CONFIRM_MODIFY
 * {field:'amount'}` slot does to the OPEN card's currency.
 *
 * The owner's ruling: an open card is an UNSAVED DRAFT, so a reply that names
 * a currency changes the draft's currency outright, together with its amount
 * ("4000엔으로 바꿔줘" on a ₩4,000 card → ¥4,000). A reply that names none —
 * `slotCurrency === undefined`, a bare number — leaves it alone. (A draft has
 * no rate snapshot yet, which is the whole difference: on a SAVED expense the
 * snapshot is immutable, so the same request is answered by cancelling the
 * expense and re-creating it in the new currency — F-T4's
 * `applyCurrencyChange`, behind one confirm card.)
 *
 * `fundingReset` is why this is a function and not a `??`: the A2 funding
 * section offers only the payer's wallets IN THE CARD'S CURRENCY, so a wallet
 * picked for the old currency cannot fund the new one — the choice has to fall
 * back to the safe on-the-spot default, exactly as `applyPayer` resets it when
 * the payer changes.
 */
export function resolveModifyCurrency(
  cardCurrency: string,
  slotCurrency: string | undefined,
): { currency: string; fundingReset: boolean } {
  const currency = slotCurrency ?? cardCurrency
  return { currency, fundingReset: currency !== cardCurrency }
}

/**
 * Equal-split preview, display-only — the server (`explainShares`) computes
 * the real per-person shares once the expense is saved. Truncates rather
 * than rounds, matching how a remainder is always visible as "the payer
 * covers the odd cent" rather than silently smoothed away.
 */
export function previewPerPerson(
  amountMinor: bigint,
  participantCount: number,
): bigint {
  if (participantCount <= 0) {
    return 0n
  }
  return amountMinor / BigInt(participantCount)
}

/**
 * Who a `CONFIRM_MODIFY {field:'split', split:'half'}` reply (spec §3.4)
 * splits between. `classify()`'s own slot for this carries no member id —
 * the §2 `Classified` union deliberately has none for `split:'half'` — so
 * the UI must resolve one itself. Money-affecting (review C1): the earlier
 * version defaulted to "actor + whoever the card's payer currently is,"
 * which silently collapses to ONE person the moment the payer IS the actor
 * (payer defaults to the actor whenever a sentence names nobody else — the
 * ordinary case for something like '치킨 3만원' typed by the actor
 * themselves), saving 100% of the amount to a single person instead of
 * splitting it. `applyParticipants`'s own empty-guard only protects against
 * an EMPTY list, not a one-person list, so nothing downstream would have
 * caught it.
 *
 * Three branches, in order, and NEVER a result shorter than 2:
 *  1. A member is actually named in THIS sentence (`민수랑 반반` while a
 *     card is open) — `findMembers` re-run on the raw input (not the
 *     draft), since `classify()`'s fragment gate strips the amount/split
 *     keyword but the caller never sees the surviving member span. Split
 *     between the actor and that member.
 *  2. No name in the sentence, but the group has EXACTLY two members —
 *     "half" can only mean the two of them, payer or not.
 *  3. Otherwise genuinely ambiguous (a 3+-person group, bare `반반`, no
 *     name) — return `null` so the caller keeps the card open and asks,
 *     instead of guessing who the other half is.
 */
export function resolveHalfSplitParticipants(
  input: string,
  members: ChatMember[],
  actorId: string,
): string[] | null {
  const namedId = findMembers(input, members)
    .map((hit) => hit.id)
    .find((id) => id !== actorId)
  if (namedId !== undefined) {
    return [actorId, namedId]
  }
  if (members.length === 2) {
    return members.map((m) => m.id)
  }
  return null
}

/**
 * The §4.7 reply for `resolveHalfSplitParticipants`'s result — review NEW-1.
 * Branch 3's `null` (genuinely ambiguous — 3+ members, no name given) used
 * to fall back to the generic "card still open" GUIDED reply, which was
 * wrong twice over: its `cardOpenAck` copy tells the user something they
 * already know (a card is visibly open right in front of them), and its
 * escape line offers to abandon the card for the full form — the opposite
 * of what an ambiguous EDIT to an already-open card calls for. Narrowing a
 * 3+-person group down to a half-split PAIR is, semantically, a
 * remove-down-to-two operation, and `assistant.confirm.askWhoToRemove`
 * ("누구를 뺄까요?" / "Who should I take out?") is the one §4.7 key whose
 * copy actually fits asking that — it also closes the key's own previously
 * declared gap (no `classify()` path produced it before this).
 */
export function halfSplitReply(
  ids: string[] | null,
  actorId: string,
  nameOf: (id: string) => string,
): AssistantAnswer {
  if (ids === null) {
    return composeConfirm({ kind: 'askWhoToRemove' })
  }
  const otherId = ids.find((id) => id !== actorId) ?? actorId
  return composeConfirm({ kind: 'updatedHalf', name: nameOf(otherId) })
}

// ===========================================================================
// Context commands (Task 10) — the pure half of the in-chat edit flow
// ===========================================================================

/**
 * Which card an `EDIT_EXPENSE` sentence opens, once its reference has been
 * resolved against the expenses the page already loaded.
 *
 * `resolveReference`'s three outcomes collapse to TWO cards, because the two
 * that are not a single confident match are the same question to the user with
 * different framing: `many` asks "which of these?", `none` says "couldn't find
 * it — is it one of these?" (`found` is what tells them apart). Exactly one
 * survivor is the only case the UI may act on directly — the whole reason the
 * resolver is three-valued in the first place.
 */
export type EditCardOutcome =
  | { kind: 'confirmEdit'; expense: RecentExpenseLite }
  | {
      kind: 'disambiguate'
      candidates: RecentExpenseLite[]
      /** true → these matched the reference ('many'); false → nothing matched
       *  and these are just the newest few ('none'). */
      found: boolean
    }

export function resolveEditCard(
  reference: { window: TimeWindow; keyword: string | null },
  expenses: RecentExpenseLite[],
  now: Date,
  tzOffsetMinutes: number,
): EditCardOutcome {
  const resolved = resolveReference(reference, expenses, now, tzOffsetMinutes)
  if (resolved.outcome === 'one') {
    return { kind: 'confirmEdit', expense: resolved.candidates[0] }
  }
  return {
    kind: 'disambiguate',
    candidates: resolved.candidates,
    found: resolved.outcome === 'many',
  }
}

/**
 * What the confirm card ASKS, with every id already resolved to something
 * renderable. Money stays integer minor units here (the render layer formats
 * it, like every other card payload) — `EditAction.amount` is a decimal string
 * from the parser, and this is the one place it becomes minor units.
 */
export type EditAsk =
  | { kind: 'add'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'amount'; amountMinor: bigint; currency: string }
  /**
   * F-T4 (docs/PROMPT.md [2026-08-14] decision 2, saved half): the amount
   * change that also moves the expense to ANOTHER currency. It is a different
   * ask, not a differently-worded one — confirming it cancels the stored
   * expense and re-creates it (`applyCurrencyChange`), so the card names BOTH
   * sides and says the new expense is re-priced.
   */
  | {
      kind: 'currencySwap'
      fromMinor: bigint
      fromCurrency: string
      toMinor: bigint
      toCurrency: string
    }
  | { kind: 'cancel' }

/**
 * Whether this confirmed edit is the currency SWAP rather than an ordinary
 * field update — the one predicate the card copy, the action dispatch and the
 * "done" line all read, so none of the three can describe it differently from
 * the other two.
 */
export function isCurrencySwap(
  action: EditAction,
  expense: { currency: string },
): boolean {
  return action.kind === 'changeAmount' && action.currency !== expense.currency
}

/**
 * `null` when the sentence's amount is unusable at its own currency's exponent
 * (an absurd figure `parseAmountToMinor` rejects) — there is nothing to
 * confirm, so the caller says so instead of opening a card that cannot be
 * acted on. Every other action is total.
 *
 * `target` is the expense the edit points at, and it is OPTIONAL because one
 * caller genuinely has no expense yet: `openEditCard` calls this before
 * resolving the reference, purely to reject an unusable amount up front. With
 * a target, a `changeAmount` naming a different currency becomes the
 * `currencySwap` ask (which needs the OLD amount and currency to name the
 * "from" side); without one it stays the plain amount ask, which is what that
 * caller is asking about.
 */
export function editAskOf(
  action: EditAction,
  nameOf: (id: string) => string,
  target?: { amountMinor: bigint; currency: string },
): EditAsk | null {
  switch (action.kind) {
    case 'addParticipant':
      return { kind: 'add', name: nameOf(action.memberId) }
    case 'removeParticipant':
      return { kind: 'remove', name: nameOf(action.memberId) }
    case 'cancel':
      return { kind: 'cancel' }
    case 'changeAmount': {
      const amountMinor = parseAmountToMinor(action.amount, action.currency)
      if (amountMinor === null) {
        return null
      }
      if (target !== undefined && isCurrencySwap(action, target)) {
        return {
          kind: 'currencySwap',
          fromMinor: target.amountMinor,
          fromCurrency: target.currency,
          toMinor: amountMinor,
          toCurrency: action.currency,
        }
      }
      return { kind: 'amount', amountMinor, currency: action.currency }
    }
  }
}

/**
 * The reason this edit cannot be applied to this expense as asked, as an i18n
 * key — or `null` when it can. Checked BEFORE the card offers a confirm
 * button, so the user is told up front instead of tapping and being refused.
 *
 * One reason is knowable from what the client holds: any of the three field
 * edits against an ITEMISED expense. Its shares come from the item
 * assignments, not from `participants` or the grand total, so a participant
 * edit here would be silently ineffective one way and actively wrong the other
 * (see `blockedForItems`, chat-edit-actions.ts). Cancelling is deliberately
 * NOT blocked: it removes the whole receipt from settlement, so there is no
 * half-applied state to land in.
 *
 * F-T4 REMOVED the second reason this used to have. A `changeAmount` naming
 * another currency was refused outright (`chat.edit.currencyBlocked`), because
 * a stored expense's currency and rate snapshot are immutable. They still are
 * — the owner's resolution (docs/PROMPT.md [2026-08-14] decision 2) does not
 * mutate them, it CANCELS the expense and re-creates it in the new currency,
 * behind one confirm. So the card must offer that confirm instead of a dead
 * end. The itemised check below now catches an itemised swap target too, which
 * is the reason that genuinely still holds for it (its line totals are the
 * receipt; there is no single grand total to re-create it from).
 *
 * The server checks this again, plus the shapes only it can see (split
 * funding, a bank-corrected portion, a wallet adjustment) — this is the
 * courtesy check, not the guard.
 */
export function editBlockedKey(
  action: EditAction,
  /** Structural on purpose: this needs two facts about the target expense, and
   *  `itemCount` is not part of the pure resolver's `RecentExpenseLite`. */
  expense: { currency: string; itemCount: number },
): string | null {
  if (action.kind === 'cancel') {
    return null
  }
  if (expense.itemCount > 0) {
    return 'chat.edit.tooComplex'
  }
  return null
}

/**
 * The title a chat save actually stored, recomputed on the client so the
 * session's own copy of a just-saved expense matches the row on the server.
 *
 * `saveExpense` derives it as `payload.note?.trim() || itemRows[0]?.name || ''`
 * — for an ITEMS card the note is often empty and the FIRST ITEM's name
 * becomes the title. Mirroring only the note half left an items-card expense
 * with an empty note in the session override map, which permanently masked the
 * real title for that session: unmatchable by keyword ("아까 그 김치찌개…" finds
 * nothing) and blank in the disambiguation list.
 */
export function savedExpenseNote(
  note: string | undefined,
  items: readonly { name: string }[],
): string {
  return note?.trim() || items[0]?.name || ''
}

/** Which "done" line an applied edit reports with — a cancellation is not an
 *  update, and saying "수정했어요" for one would misdescribe what happened.
 *  `swapped` (F-T4) is the third case: nothing was updated at all, one expense
 *  was cancelled and another created in its place. */
export function editDoneKey(action: EditAction, swapped = false): string {
  if (action.kind === 'cancel') {
    return 'chat.edit.doneCancelled'
  }
  return swapped ? 'chat.edit.currencySwap.done' : 'chat.edit.done'
}
