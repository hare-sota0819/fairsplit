/**
 * Shared types for the assistant brain — spec §2.1 (context), §5.2 (entry
 * point / `Classified`).
 */

import type { EditAction } from '../chat-parse/parsers/edit'
import type { TimeWindow } from '../chat-parse/parsers/reference'
import type { ParseContext, ParsedExpense } from '../chat-parse/types'
import type { ModifyField } from './lexicons/modify'

/** The closed intent set — spec §1, plus `EDIT_EXPENSE` (the goat branch's
 *  context commands: an edit aimed at an expense that is already SAVED, as
 *  opposed to `CONFIRM_MODIFY`, which edits the draft on an open card). */
export type Intent =
  | 'EXPENSE_ENTRY'
  | 'CONFIRM_YES'
  | 'CONFIRM_NO_CANCEL'
  | 'CONFIRM_MODIFY'
  | 'EDIT_EXPENSE'
  | 'QUERY_MY_BALANCE'
  | 'QUERY_PAIRWISE'
  | 'QUERY_GROUP_TOTAL'
  | 'QUERY_MY_SPENDING'
  | 'QUERY_WALLET'
  | 'HELP'
  /** Social acts (안녕/고마워/잘가) answered in kind — 2026-08-14, the
   *  "안녕 got the confused menu" owner screenshot. */
  | 'SMALL_TALK'
  | 'UNKNOWN'

/**
 * spec §2.1 — mirrors `Outcome` in ChatComposer.tsx one-for-one.
 *
 * `crossCurrency` (round-2 review M11's dedicated dead-end kind) is gone as
 * of A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차"): a foreign-currency
 * parse now opens an ordinary `confirm` card (carrying its own currency) with
 * an inline funding-source section, instead of bouncing to the wizard with
 * no way back into the chat.
 */
export type OpenCard =
  | { kind: 'askAmount'; draft: ParsedExpense }
  | { kind: 'confirm'; draft: ParsedExpense; amountMinor: bigint }
  /**
   * The items ("who had what") card — 2026-08-14 live-app fix round. It was
   * deliberately invisible to classify() before, which made every follow-up
   * ("콜라는 500엔") DESTROY the card by classifying as a fresh
   * EXPENSE_ENTRY. It exposes its lines so a typed price can be bound to
   * one by name; it still carries no ParsedExpense draft, so the ordinary
   * CONFIRM_MODIFY field family (payer/split/participants) stays
   * unavailable against it.
   */
  | {
      kind: 'items'
      lines: ReadonlyArray<{ key: number; name: string; unpriced: boolean }>
    }

export interface AssistantContext extends ParseContext {
  /** null when no confirm/ask card is on screen. */
  openCard: OpenCard | null
  locale: 'ko' | 'en'
}

/** spec §3.4's `CONFIRM_MODIFY` slot shapes — one variant per `field`.
 *  `participants` remove/add carries `memberId: string | null` (final-review
 *  I4): `null` means a §2.3-named marker (빼줘/제외/포함/minus/without/
 *  everyone but) fired with no bound name in the sentence — a concrete, if
 *  incomplete, slot instead of routing through the generic UNKNOWN/
 *  cardOpenAck fallback (same precedent as `split:'half'` carrying no
 *  member id when ambiguous — see `chat-composer-logic.ts`'s
 *  `halfSplitReply`). The caller resolves the "ask who" reply itself. */
export type ConfirmModifySlots =
  /**
   * Task 3 (docs/PROMPT.md [2026-08-14] decision 2): `currency` is the ISO 4217
   * code the REPLY named, taken from the same amount candidate `amount` was
   * read from — the identical binding `EditAction.changeAmount` has carried
   * since T9. An open card is an unsaved draft, so naming a currency changes
   * the draft's currency along with its amount ("4000엔으로 바꿔줘" → ¥4,000).
   * ABSENT (never `defaultCurrency`) when the reply was a bare number: that
   * says nothing about currency, so the card keeps its own.
   */
  | { field: 'amount'; amount: string | null; currency?: string }
  /**
   * A price bound to ONE line of the open ITEMS card ("콜라는 500엔", or a
   * bare number when exactly one line is unpriced). `key` is the
   * ChatItemState key the reply named; `currency` follows the same
   * named-only rule as `field:'amount'` above.
   */
  | { field: 'itemPrice'; key: number; amount: string; currency?: string }
  /**
   * R4: a typed assignment for ONE line of the open ITEMS card ("우동은
   * 내가 먹었어", "우유롤은 하나씩"). memberIds = who the sentence named
   * (actor included via self-mentions); shareAll mirrors the parser's
   * share-out reading and never coexists with a non-empty memberIds.
   */
  | { field: 'itemAssign'; key: number; memberIds: string[]; shareAll: boolean }
  | { field: 'payer'; memberId: string }
  | { field: 'split'; split: 'half' | 'everyone' }
  | { field: 'participants'; op: 'remove' | 'add'; memberId: string | null }
  | { field: 'participants'; op: 'only'; memberIds: string[] }
  | { field: null }

/**
 * QUERY_HISTORY's filter slots (R2a, 2026-08-15): '수탉과 먹은 지출 다
 * 보여줘' and its human variants. All optional and combinable; empty
 * object = the plain recent list.
 */
export interface HistoryFilters {
  /** Expenses SHARED WITH this member (participant). */
  companionId?: string
  /** Expenses this member PAID. */
  payerId?: string
  /** Title keyword ("커피 산 거"). */
  keyword?: string
  window?: TimeWindow
}

/** spec §5.2 — the discriminated result union, exactly the slots §3 asserts. */
export type Classified =
  | { intent: 'EXPENSE_ENTRY'; parsed: ParsedExpense }
  | { intent: 'CONFIRM_YES' }
  | { intent: 'CONFIRM_NO_CANCEL' }
  | ({ intent: 'CONFIRM_MODIFY' } & ConfirmModifySlots)
  /**
   * A context command against an expense that already exists ("아까 그 술값에
   * 민수도 껴줘"). Carries only what the SENTENCE said: which expense it
   * points at is `resolveReference`'s job (context-commands.ts), and applying
   * the edit is the server's — this stays a pure reading of the text.
   */
  | { intent: 'EDIT_EXPENSE'; reference: { window: TimeWindow; keyword: string | null }; action: EditAction }
  | { intent: 'QUERY_MY_BALANCE'; view: 'amount' | 'who' }
  | { intent: 'QUERY_PAIRWISE'; memberId: string | null }
  | { intent: 'QUERY_GROUP_TOTAL'; view: 'total' | 'transfers' }
  | { intent: 'QUERY_MY_SPENDING'; view: 'paid' | 'consumed' | 'ahead' }
  | { intent: 'QUERY_WALLET'; currency: string | null }
  | { intent: 'QUERY_HISTORY'; scope: 'mine' | 'group'; filters: HistoryFilters }
  | { intent: 'QUERY_EXPLAIN' }
  /** Slots the sentence itself stated; null = the card asks. */
  | {
      intent: 'ACTION_CREATE_WALLET'
      currency: string | null
      walletType: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID' | null
    }
  | { intent: 'HELP' }
  | { intent: 'SMALL_TALK'; act: 'greeting' | 'thanks' | 'farewell' }
  /**
   * `topic` (2026-08-14): set when the sentence names the DOMAIN without
   * a specific request ("정산할래"). The guided reply must open engaged
   * with that topic, not with the generic confused ack.
   */
  | {
      intent: 'UNKNOWN'
      hold: boolean
      suggest: readonly Intent[]
      topic?: 'settle'
    }

export type { ModifyField }
export type { EditAction, TimeWindow }
export type { ParseContext, ParsedExpense } from '../chat-parse/types'

/**
 * spec §5.4 — one composer answer: an ordered list of i18n lines. `key` is
 * an `assistant.*` message key (§4); `values` are the RAW slot values the
 * key's placeholders need (money stays integer minor units as a decimal
 * string, paired with its own `currency` key — `formatMinor` runs at render
 * time in T6, never here). No composer ever puts a formatted string here.
 */
export interface AssistantAnswerLine {
  key: string
  values?: Record<string, string | number>
}

export interface AssistantAnswer {
  lines: AssistantAnswerLine[]
}
