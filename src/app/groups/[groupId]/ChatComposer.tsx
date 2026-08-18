'use client'

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Paperclip, Send } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Locale } from '@/i18n/locale'
import { classify } from '@/lib/assistant/classify'
import { mergeReceiptIntoChat } from '@/lib/chat-receipt/merge'
import { RECEIPT_PARSE_TIMEOUT_MS } from '@/lib/receipts/config'
import type { TotalCheck } from '@/lib/receipts/invariant'
import { resizeReceiptImage } from '@/lib/receipts/resize'
import { parsedReceiptSchema } from '@/lib/receipts/schema'
import {
  composeConfirm,
  composeGroupTotal,
  composeGuided,
  composeHelp,
  composeHistory,
  composeExplain,
  composeHistoryFiltered,
  composeItemsPriceAsk,
  composeSmallTalk,
  composeWalletCreated,
  composeWhoAmbiguous,
  composeWhoUnknown,
  composeMyBalance,
  composeMySpending,
  composePairwise,
  composeWallet,
} from '@/lib/assistant/compose'
import type { RecentExpenseLite } from '@/lib/assistant/context-commands'
import type {
  AssistantAnswer,
  AssistantAnswerLine,
  AssistantContext,
  Classified,
  EditAction,
  HistoryFilters,
  Intent,
  OpenCard,
} from '@/lib/assistant/types'
import { parse, type ChatMember, type ParsedExpense } from '@/lib/chat-parse'
import {
  emptyMemory,
  observeUserUtterance,
  resolvePersonReference,
} from '@/lib/assistant/dialogue/engine'
import { findMembers } from '@/lib/chat-parse/people'
import type { ParsedItemList } from '@/lib/chat-parse/items'
import { minorToDecimalInput, parseAmountToMinor } from '@/lib/format'
import {
  assignEveryone,
  itemsGrandTotal,
  setUnitAmount,
  toChatItems,
  type ChatItemState,
} from '@/lib/chat-items-state'
import type { AssistantData } from './assistant-data'
import { saveExpense, type ExpenseFormState } from './expenses/actions'
import { saveWallet } from './exchange/actions'
import {
  fetchExpenseList,
  fetchMyShareBreakdown,
  interpretUtterance,
} from './chat-query-actions'
import type { SessionMemory } from '@/lib/chat-history'
import {
  applyAddParticipant,
  applyCancel,
  applyChangeAmount,
  applyCurrencyChange,
  applyRemoveParticipant,
  type EditResult,
  type RecentExpenseView,
} from './chat-edit-actions'
import {
  editAskOf,
  editBlockedKey,
  editDoneKey,
  halfSplitReply,
  isCurrencySwap,
  previewPerPerson,
  resolveChatOutcome,
  resolveEditCard,
  resolveHalfSplitParticipants,
  resolveModifyCurrency,
  savedExpenseNote,
} from './chat-composer-logic'
import {
  useChatTranscript,
  type AnswerLine,
  type CardPayload,
} from './ChatTranscript'
import { draftFormHref } from './transcript-render'
import { useSidebar } from '@/components/sidebar/SidebarProvider'

/**
 * Task 2 (chat-image-c): the JSON shape `/api/receipts/parse` (route.ts)
 * returns, mirrored here rather than imported — the route has no exported
 * response type of its own (`ReceiptScan.tsx` reads the same JSON ad hoc,
 * same precedent). `receipt` stays `unknown` until validated through
 * `parsedReceiptSchema.parse` below, same discipline `ReceiptScan.tsx` uses.
 */
interface ParseSuccess {
  ok: true
  receipt: unknown
  check: TotalCheck
  imagePath: string | null
  remaining: number
}
interface ParseFailure {
  ok: false
  error: string
  imagePath?: string | null
  limit?: number
}

export interface ChatComposerProps {
  groupId: string
  members: ChatMember[]
  /** The acting member — whoever is typing. */
  actorId: string
  /** The group's settlement currency. Chat never sends a foreign one. */
  defaultCurrency: string
  /** Settlement-engine outputs, gathered server-side (`assistant-data.ts`) —
   *  this component has no DB access of its own, chat or not. */
  assistantData: AssistantData
  /** Task 10 (context commands): the newest settleable expenses, which
   *  `resolveReference` matches "아까 그 술값" against. Loaded by `page.tsx`
   *  from data it already had — this component still has no DB access. */
  recentExpenses: RecentExpenseView[]
  /** R2b: the active session's persisted dialogue memory, restored so
   *  걔-references keep resolving after the session is reopened. */
  initialMemory?: SessionMemory | null
}

/**
 * The places a parsed sentence can land, once amount validity is resolved
 * (`resolveChatOutcome`). Each carries what its own card needs to render —
 * the parse itself, plus the validated amount for `confirm` so the card
 * never has to re-derive it (and never needs a non-null assertion to do so).
 *
 * `confirm` also carries a `submissionId`, unique to THIS card (not to a
 * save attempt of it — a duplicate → "save anyway" retry keeps the same id,
 * since it is still the same card). It exists so a stale `result.duplicate`
 * / `result.error` from a card the user already dismissed cannot bleed onto
 * the next one (see the `resultIsCurrent` check below).
 *
 * A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차") removed the third
 * outcome that used to live here, `crossCurrency` — a foreign-currency parse
 * used to dead-end straight to the wizard with no way back into the chat.
 * It is an ordinary `confirm` now: `outcome.parsed.currency` carries the
 * REAL parsed currency (which may differ from `defaultCurrency`), and the
 * card shows an inline funding-source section whenever that currency differs
 * from the group's settlement currency (`assistantData.currency`).
 *
 * `multiAmount` is a NEW outcome, added the same day as a review follow-up:
 * removing `crossCurrency` also removed its accidental side effect of
 * protecting multi-amount sentences ("13000원 김치찌개 3개, 7000원 콜라
 * 2개, 400000원 와규 2개") from resolving to a confidently WRONG number —
 * the lone FIRST amount `parse()` happens to report. Unlike `askAmount`/
 * `confirm`, it is NOT exposed to `classify()` as an `OpenCard` (see
 * `openCard` below): there is no draft to confirm, modify, or save — just a
 * notice with the wizard escape link, closer to a GUIDED reply than a
 * persistent card. A fresh sentence typed while it is showing is classified
 * exactly as if no card were open at all.
 *
 * Task 3 (docs/handoff/B-multi-item-chat.md): `confirmItems` is what a
 * `multiAmount`-triggering sentence resolves to now WHEN `parseItems`
 * (`resolveChatOutcome`) can actually parse it — the "who had what" card
 * (`ChatAssignCard`) instead of a bare notice. `itemsCurrency` is the
 * sentence's OWN resolved currency (`ParsedItemList.currency`), never
 * `defaultCurrency` — see the binding contract on `ChatAssignCard`'s
 * `currency` prop and `toChatItems`'s doc comment; every `ChatItemState` in
 * `chatItems` (component state, not carried on this variant — it mutates
 * per checkbox tap, same reasoning as `description`/`payerId`/
 * `participantIds` living outside `Outcome` for the `confirm` case) was
 * built from, and must stay read against, this exact currency. Like
 * `confirm`, it carries its own `submissionId` for the same result-matching
 * reason. Also like `multiAmount`, it is NOT exposed to `classify()` as an
 * `OpenCard` (see `openCard` below) — CONFIRM_MODIFY has no defined meaning
 * against a per-item assignee list, so a typed edit while this card is open
 * is treated as if no card were there (same as `multiAmount`); the card's
 * own Save button is the only way to confirm it, exactly like tapping the
 * items card was always meant to work.
 */
// Task 2 (chat-image-c) adds `receiptImagePath` to `confirmItems`/`confirm`:
// the successful scan's uploaded photo path, riding on the OUTCOME rather
// than a separate ref — `openConfirm`/`openConfirmItems` build a whole new
// `Outcome` object per card, so a value stashed here is automatically
// cleared exactly when the card is (cancel -> `setOutcome(null)`; a fresh
// sentence or scan supersedes it -> a new `openConfirm`/`openConfirmItems`
// call, defaulting to `null` unless a scan just produced one). `confirm`
// also carries `notice`: the one-line reason (`chat.scan.totalOnlyNotice` /
// `chat.scan.sumMismatchNotice`, already resolved through `t()`) shown when
// this card came from a receipt scan that could not fully reconcile — `null`
// for the ordinary text path.
type Outcome =
  | { kind: 'askAmount'; parsed: ParsedExpense }
  | { kind: 'multiAmount'; parsed: ParsedExpense }
  | {
      kind: 'confirmItems'
      parsed: ParsedExpense
      itemsCurrency: string
      submissionId: number
      receiptImagePath: string | null
    }
  | {
      kind: 'confirm'
      parsed: ParsedExpense
      amount: string
      amountMinor: bigint
      submissionId: number
      receiptImagePath: string | null
      notice: string | null
    }
  /**
   * Task 10 (goat-parser, context commands): an edit aimed at an expense that
   * is already SAVED. Two cards, one per `resolveEditCard` outcome — the
   * single confident match asks to apply it, anything else asks WHICH.
   *
   * `tzOffsetMinutes` is captured when the card opens (the DEVICE's offset,
   * Phase 3C) and rides along so the card's dates and the resolver's day
   * boundaries can never disagree.
   *
   * Neither is an `OpenCard` (see the `openCard` memo below), same ruling as
   * `multiAmount`/`confirmItems`: there is no draft here for CONFIRM_MODIFY to
   * edit, and the card's own buttons are how it is answered.
   */
  | {
      kind: 'disambiguate'
      action: EditAction
      candidates: RecentExpenseLite[]
      found: boolean
      tzOffsetMinutes: number
    }
  | {
      kind: 'confirmEdit'
      action: EditAction
      expense: RecentExpenseLite
      tzOffsetMinutes: number
    }
  /**
   * Chat action (2026-08-14 prime directive): create a wallet without
   * leaving the chat. Slots the sentence stated arrive prefilled; the
   * card collects the rest and `submitWalletCreate` calls the SAME
   * `saveWallet` server action the exchange screen uses.
   */
  | {
      kind: 'walletCreate'
      currency: string | null
      walletType: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID' | null
      label: string
      error: string | null
      saving: boolean
    }

/**
 * `ExpenseFormState` plus which confirm card (`Outcome['submissionId']`) it
 * answers. `saveExpense` itself has no notion of this — it is purely a
 * client-side tag `clientAction` stamps onto whatever `saveExpense` returns,
 * so a leftover duplicate/error banner from a cancelled or superseded card
 * never renders against a card that was never actually submitted.
 */
type ChatFormState = ExpenseFormState & { submissionId?: number }

/** The transcript slot the composer's one live outcome card occupies —
 *  stable across `askAmount` → `confirm` transitions (same card, new
 *  content), replaced wholesale by `chat.savedSummary` on save. */
const OUTCOME_MESSAGE_ID = 'outcome'

/** Task 2 (chat-image-c): the scanning indicator's fixed transcript slot —
 *  upserted when an attach starts, removed on every exit path (success or
 *  any failure), never left orphaned. */
const SCAN_PROGRESS_ID = 'receipt-scan-progress'

/** spec §4.8's option table, inverted: which `Intent` a GUIDED suggestion
 *  chip line answers for. Mirrors `compose.ts`'s own (private)
 *  `GUIDED_OPTION_KEY` table one-for-one — these seven key strings are
 *  locked copy (`compose.test.ts` references them literally), so this is a
 *  low-drift reverse lookup, not a second source of truth for the ranking
 *  or filtering logic itself (that stays inside `composeGuided`). */
const GUIDED_OPTION_INTENT: Partial<Record<string, Intent>> = {
  'assistant.guided.option.myBalance': 'QUERY_MY_BALANCE',
  'assistant.guided.option.pairwise': 'QUERY_PAIRWISE',
  'assistant.guided.option.groupTotal': 'QUERY_GROUP_TOTAL',
  'assistant.guided.option.mySpending': 'QUERY_MY_SPENDING',
  'assistant.guided.option.wallet': 'QUERY_WALLET',
  'assistant.guided.option.expense': 'EXPENSE_ENTRY',
  'assistant.guided.option.help': 'HELP',
}

/**
 * The canonical question a GUIDED suggestion chip injects when tapped —
 * `composeGuided` only ever returns a locked-copy PROMPT ("Want to know
 * what you owe?"), never a sentence `classify()` itself would route, so T6
 * supplies one per intent. The actual sentences live in `chat.chipSeed.*`
 * (review I5 — this text becomes a real user-chat bubble once submitted, so
 * it is user-facing copy, not a TS literal); this table only maps an intent
 * to which key names it. `QUERY_PAIRWISE` needs the bound member's name
 * (its own `chipSeed.pairwise` key takes a `{name}` value) and
 * `EXPENSE_ENTRY` is handled separately — it bypasses this table entirely
 * and resubmits the user's own original sentence THROUGH `parse()`
 * directly, not back through `classify()` (review I1 — see
 * `pushGuidedAnswer` below).
 */
const CHIP_SEED_KEY: Partial<Record<Intent, string>> = {
  QUERY_MY_BALANCE: 'myBalance',
  QUERY_GROUP_TOTAL: 'groupTotal',
  QUERY_MY_SPENDING: 'mySpending',
  QUERY_WALLET: 'wallet',
  HELP: 'help',
}

/**
 * Chat-first expense entry (Task 4 of the chat-entry plan; Task 5 of the
 * app-shell restructure moved its cards into the transcript). Task 6 of the
 * assistant-brain plan wires the whole surface through `classify()`: every
 * SEND now routes through the intent ladder (spec §2.3) instead of always
 * assuming "this is a new expense" — `parse()` is still exactly how
 * EXPENSE_ENTRY drafts (unchanged), but a confirm token, a worded edit, a
 * settlement question or an unrecognised message now each get their own
 * reply instead of either mis-parsing into a bogus draft or the old
 * behaviour of blindly opening an askAmount card for anything with no
 * money in it.
 *
 * A free-form sentence goes through the pure parser (`src/lib/chat-parse`),
 * and the result is ALWAYS shown as a confirm card before anything saves —
 * the parser drafts, it never autosaves, and it never dead-ends: a foreign
 * currency used to bounce the whole draft to the wizard with no way back
 * (the `crossCurrency` card kind, round-2 review M11) — A2 removed that.
 * `openFormHref` on the confirm card (carrying `draftAmount`/`draftNote`/
 * `draftCurrency` as query params) stays as an ESCAPE for the cases this
 * component doesn't cover — split funding, a manual rate override — never
 * the only path. Two genuine dead ends remain, and each gets a way out
 * rather than a dropped receipt:
 *
 *  - a missing or unusable amount asks for one inline, WITHOUT making the
 *    user retype the sentence — the amount is injected into the
 *    already-parsed draft (now also reachable by typing an amount fragment
 *    while the askAmount card is open, via `CONFIRM_MODIFY`);
 *  - the server's own duplicate guard: a `duplicate` response re-offers the
 *    same save with `force: true` rather than skipping validation.
 *
 * Saves go through the EXISTING `saveExpense` server action with the exact
 * payload shape the wizard builds — this component has no database access
 * of its own. Unlike the wizard, it sets the opt-in `stay` form field, so a
 * successful save returns `{ success }` instead of redirecting. Because a
 * server action never re-renders the route it fired from (docs/SOLVED.md
 * 2026-08-01, 2026-08-03), success is followed by a plain local reset, and
 * the saved bubble renders straight from the action result (`success.feedRow`
 * → a `chat.savedSummary` assistant bubble): this is the ONE delivery point
 * for that confirmation (docs/SOLVED.md 2026-08-09) — CONFIRM_YES (spec
 * §1) reuses it by calling the SAME `formAction`, never by composing its
 * own "saved" reply, so there is still only one path a save can be
 * confirmed through.
 *
 * TRANSCRIPT-AS-DATA (Task 6, spec §5.5(a)): this component owns all the
 * outcome/query STATE and "emits transcript events" — every bubble it
 * pushes is a plain value (`TranscriptMessage`), never JSX; `transcript-
 * render.tsx` is the only place that turns one into markup. The one live
 * outcome card is kept in sync with an effect whose dependency array lists
 * only the primitive state that actually feeds the card payload — same
 * shape as before Task 6, just building a data object instead of a
 * `ReactNode`.
 */
export function ChatComposer({
  groupId,
  members,
  actorId,
  defaultCurrency,
  assistantData,
  recentExpenses,
  initialMemory = null,
}: ChatComposerProps) {
  const t = useTranslations('chat')
  // The GUIDED suggestion chips' seed sentences (review I5 — user-facing
  // copy, since a tapped chip's sentence becomes a real chat bubble; not a
  // hardcoded TS literal). Scoped to the sub-namespace so call sites read
  // `tSeed('myBalance')` rather than the full dotted path, and — unlike the
  // old per-locale object this replaces — this already resolves to the
  // ACTIVE locale on its own, no `locale === 'ko' ? … : …` branching needed.
  const tSeed = useTranslations('chat.chipSeed')
  const router = useRouter()
  // Shell phase B (2026-08-16): on desktop, a history / my-spending
  // question ALSO opens the right-hand context panel with the full list —
  // the bubble still answers, the panel is the fuller view. Phones never
  // open it (no room; the bubble + load-more chip is the whole answer).
  const { setPanel } = useSidebar()
  const openDesktopPanel = (panel: Parameters<typeof setPanel>[0]) => {
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    setPanel(panel)
  }
  const locale = useLocale() as Locale
  const { pushMessage, upsertMessage, removeMessage, persistMemory } =
    useChatTranscript()
  // React 19 requires `formAction` (from `useActionState` below) to be
  // wrapped in a transition when called OUTSIDE its own `<form>`'s real
  // submit event (review I3) — CONFIRM_YES calls it directly, from a chat
  // send, not a click on the Save button.
  const [, startTransition] = useTransition()

  const [text, setText] = useState('')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [askAmountText, setAskAmountText] = useState('')
  // The items card's live "who had what" state (Task 3) — outside `outcome`
  // for the same reason `description`/`payerId`/`participantIds` are: it
  // mutates on every checkbox tap, and folding it into `Outcome` would mean
  // every one of those taps rebuilds the whole outcome object instead of
  // just this one field.
  const [chatItems, setChatItems] = useState<ChatItemState[]>([])
  const [description, setDescription] = useState('')
  const [payerId, setPayerId] = useState('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  const [force, setForce] = useState(false)
  // A2: which pot a foreign-currency card's money came from — 'PAY_AS_YOU_GO'
  // (the safe default) or a wallet id. Meaningless on a same-currency card
  // (the funding section isn't shown there), but always reset to the safe
  // default on a fresh card or a payer switch, exactly like the wizard's own
  // `answerQuestionOne` resets the funding source when the payer changes
  // (StepPayment.tsx) — a wallet chosen for one payer cannot fund a
  // different payer's expense.
  const [fundingChoice, setFundingChoice] = useState('PAY_AS_YOU_GO')
  // Minimal feedback for an unusable typed amount: no new copy, just the
  // Input's own built-in `aria-invalid` styling (see components/ui/input.tsx)
  // — cleared as soon as the user changes the field or leaves this card.
  const [askAmountInvalid, setAskAmountInvalid] = useState(false)
  // Task 2 (chat-image-c): true for the duration of one
  // resize -> POST /api/receipts/parse round trip — gates the attach button
  // (a second scan while one is in flight would race two scanning bubbles
  // onto the same fixed message id) the same way `isSaving` already gates
  // it below.
  const [scanning, setScanning] = useState(false)
  // Task 10: true for the duration of one edit action's round trip — gates the
  // confirm button so a double tap cannot dispatch the same edit twice (the
  // same guard `isSaving` gives the save button).
  const [editPending, setEditPending] = useState(false)
  // Task 10: rows an edit has already changed, keyed by id. An applied edit
  // returns the FRESH row, and this is where it lands, so the very next
  // sentence resolves against what is actually stored — a cancelled expense
  // stops being offered as a candidate immediately, an added participant is
  // already there. Deliberately not a re-read of the `recentExpenses` prop:
  // that prop only updates when the `router.refresh()` below actually commits,
  // which this Next version's client intermittently drops (docs/SOLVED.md
  // 2026-08-09) — the same reason the saved bubble renders from the action
  // result rather than the refresh.
  const [editedExpenses, setEditedExpenses] = useState<
    Record<string, RecentExpenseView>
  >({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  // The image bubble's object URL — created immediately from the ORIGINAL
  // file (`ReceiptScan.tsx`'s own precedent), and the only one revoked here:
  // once pushed, the transcript bubble itself is never replaced by this
  // component (unlike the outcome card), so nothing else owns its lifetime.
  const scanImageUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (scanImageUrlRef.current) URL.revokeObjectURL(scanImageUrlRef.current)
    }
  }, [])

  // Final-review I2: mirrors `outcome` for `openExpenseCard` below to read
  // synchronously even when invoked from a STALE closure — an old GUIDED
  // reply's EXPENSE_ENTRY chip (`pushGuidedAnswer` below) closes over
  // whichever render pushed it, `outcome` included, so tapping it after a
  // NEWER card has since opened read the OLD (often null) `outcome` and
  // skipped the `removeMessage` below, upserting the new draft back at the
  // stale card's OLD transcript index and silently clobbering the actually-
  // open one. A ref is the SAME mutable object across renders; the effect
  // keeps it synced to every committed `outcome`, which is all a later
  // EVENT HANDLER (a chip tap always fires after the effects from every
  // prior render have already flushed) needs — unlike reading `outcome`
  // through the handler's own closure, which is frozen at whichever render
  // created that particular handler.
  const outcomeRef = useRef<Outcome | null>(null)
  useEffect(() => {
    outcomeRef.current = outcome
  }, [outcome])

  // Identifies one confirm CARD, not one save attempt of it — see the
  // `Outcome`/`ChatFormState` doc comments above.
  const submissionCounter = useRef(0)
  /** Conversation memory (dialogue layer step 1) — recent person mentions
   *  for 걔/그 사람 resolution. Survives across turns, not across mount. */
  const dialogueMemory = useRef(initialMemory ?? emptyMemory())
  // Identifies one user-sentence BUBBLE, so two sentences never collide on
  // the same transcript message id.
  const userMessageCounter = useRef(0)
  // Identifies one assistant REPLY bubble (a query answer, a guided reply, a
  // CONFIRM_MODIFY/CONFIRM_NO_CANCEL acknowledgement) — always a fresh
  // append, never the outcome card's own slot.
  const answerMessageCounter = useRef(0)

  // Active members only — correct for card-editing (payer/participant picks
  // only ever come from the currently-active roster `parse()`/`classify()`
  // were given) and for the pairwise-chip's own name lookup below.
  const nameOf = (id: string): string =>
    members.find((m) => m.id === id)?.name ?? ''
  // EVERY member the group has ever had, departed included (review I2) — a
  // settle-up transfer or the group total's per-person line can name
  // someone who has since left; `members` above is filtered to active ones
  // (`page.tsx`'s `chatMembers`) and would print their raw id otherwise.
  // Built server-side (`assistant-data.ts`) since it needs the unfiltered
  // roster this component was never given as a prop.
  const fullNameMap = useMemo(
    () => new Map(Object.entries(assistantData.names)),
    [assistantData.names],
  )

  /**
   * Task 10: what a context command resolves against — the page's own newest
   * expenses, with any row this session has already edited replaced by the
   * action's fresh copy. Converted to the pure layer's `RecentExpenseLite`
   * (bigint amount, real `Date`) here, at the one boundary where the wire
   * shape stops being the wire shape.
   */
  const mergedExpenses = useMemo<RecentExpenseView[]>(() => {
    // Keyed by id so an entry from `editedExpenses` REPLACES the prop's copy
    // of the same row, and an entry the prop does not have yet (an expense
    // saved in this very session — see `clientAction`) is simply added.
    // `resolveReference` sorts and windows the result itself.
    const merged = new Map<string, RecentExpenseView>()
    for (const row of recentExpenses) merged.set(row.id, row)
    for (const row of Object.values(editedExpenses)) merged.set(row.id, row)
    return [...merged.values()]
  }, [recentExpenses, editedExpenses])

  /** The same rows in the PURE resolver's shape. `itemCount` is deliberately
   *  not part of it — `resolveReference` has no use for it; the card looks it
   *  up by id (`itemCountOf`) when it needs to decide what may be edited. */
  const liveExpenses = useMemo<RecentExpenseLite[]>(
    () =>
      mergedExpenses.map((row) => ({
        id: row.id,
        note: row.note,
        amountMinor: BigInt(row.amountMinor),
        currency: row.currency,
        timestamp: new Date(row.timestampIso),
        participantIds: row.participantIds,
        payerId: row.payerId,
        cancelled: row.cancelled,
      })),
    [mergedExpenses],
  )
  const itemCounts = useMemo(
    () => new Map(mergedExpenses.map((row) => [row.id, row.itemCount])),
    [mergedExpenses],
  )
  // Unknown ids cannot occur (every candidate came from this same list), and
  // 0 is the safe reading anyway: the SERVER refuses an itemised edit
  // regardless of what the card believed.
  const itemCountOf = (id: string): number => itemCounts.get(id) ?? 0

  const openConfirm = (
    parsed: ParsedExpense,
    amount: string,
    amountMinor: bigint,
    // Task 2: both default to the ordinary text-parsed card's values —
    // every EXISTING call site (askAmount -> confirm, CONFIRM_MODIFY's
    // amount edit, an ordinary EXPENSE_ENTRY sentence) stays exactly as it
    // was, no scan involved.
    receiptImagePath: string | null = null,
    notice: string | null = null,
  ) => {
    submissionCounter.current += 1
    setOutcome({
      kind: 'confirm',
      parsed,
      amount,
      amountMinor,
      submissionId: submissionCounter.current,
      receiptImagePath,
      notice,
    })
    setDescription(parsed.description)
    setPayerId(parsed.payerId)
    setParticipantIds(parsed.participantIds)
    setForce(false)
    setFundingChoice('PAY_AS_YOU_GO')
  }

  /**
   * Opens the items card (Task 3) — the `confirmItems` counterpart of
   * `openConfirm` above. `items.currency` (the SENTENCE's own resolved
   * currency, never `defaultCurrency` — see the `Outcome` doc comment) rides
   * as `itemsCurrency`; `toChatItems` builds the per-line state fresh, with
   * nobody assigned yet, same starting point `StepAssign` gives a brand-new
   * wizard draft.
   *
   * The title field defaults to a short auto-generated summary (spec item 5,
   * "내용" → "제목" — B1: "짧은 구분 이름", never the raw sentence) built from
   * the FIRST item's name, since `parsed.description` here is the same
   * "sentence minus the amount/keywords" text the ordinary confirm card
   * shows — for a multi-item sentence that is routinely the whole rest of
   * the sentence, exactly what B1 complained about. The user can still
   * retype it (this is a real restaurant name like "야키토리" the parser has
   * no way to know), but the default is a title, not a paragraph.
   */
  const openConfirmItems = (
    parsed: ParsedExpense,
    items: ParsedItemList,
    // Task 2: `null` for the ordinary text-parsed items card (every
    // pre-existing call site) — set only by the scan handler below.
    receiptImagePath: string | null = null,
  ) => {
    submissionCounter.current += 1
    setOutcome({
      kind: 'confirmItems',
      parsed,
      itemsCurrency: items.currency,
      submissionId: submissionCounter.current,
      receiptImagePath,
    })
    // Participants feed the shareAll expansion ("우유롤은 하나씩 나눠먹음"
    // divides among exactly the people the sentence put at the table).
    setChatItems(toChatItems(items, parsed.participantIds))
    setDescription(
      items.items.length > 1
        ? t('items.autoTitle', {
            name: items.items[0].name,
            count: items.items.length - 1,
          })
        : items.items[0].name,
    )
    setPayerId(parsed.payerId)
    setParticipantIds(parsed.participantIds)
    setForce(false)
    setFundingChoice('PAY_AS_YOU_GO')
  }

  /** Opens the wallet-create card with whatever slots the sentence stated. */
  const openWalletCard = (slots: {
    currency: string | null
    walletType: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID' | null
  }) => {
    if (outcomeRef.current !== null) {
      removeMessage(OUTCOME_MESSAGE_ID)
    }
    setOutcome({
      kind: 'walletCreate',
      currency: slots.currency,
      walletType: slots.walletType,
      label: '',
      error: null,
      saving: false,
    })
  }

  /** Creates the wallet via the SAME server action the exchange screen
   *  uses. Never fires without a currency; type defaults to CASH; an empty
   *  label falls back to "{currency} {type}" so the wallet always has the
   *  name the schema requires. */
  const submitWalletCreate = () => {
    const current = outcomeRef.current
    if (current?.kind !== 'walletCreate' || current.saving) return
    if (current.currency === null) {
      setOutcome({ ...current, error: t('wallet.needCurrency') })
      return
    }
    const currency = current.currency
    const walletType = current.walletType ?? 'CASH'
    const label =
      current.label.trim() ||
      t('wallet.autoLabel', {
        currency,
        type: t(`wallet.type${walletType === 'CASH' ? 'Cash' : walletType === 'TRAVEL_CARD' ? 'Card' : 'Prepaid'}`),
      })
    setOutcome({ ...current, saving: true, error: null })
    startTransition(async () => {
      const fd = new FormData()
      fd.set('groupId', groupId)
      fd.set('label', label)
      fd.set('type', walletType)
      fd.set('currency', currency)
      const result = await saveWallet({}, fd)
      if (result.error) {
        setOutcome((prev) =>
          prev?.kind === 'walletCreate'
            ? { ...prev, saving: false, error: result.error ?? null }
            : prev,
        )
        return
      }
      setOutcome(null)
      pushAnswer(composeWalletCreated(label))
    })
  }

  /** Filtered history answer (R2a): fetches one page from the full ledger
   *  and renders it, with a load-more chip that fetches the next. */
  /** The classifier's history filters as the server action's shape — one
   *  mapping shared by the chat's own paged answer and the desktop
   *  context panel, so both always ask the ledger the same question. */
  const toListFilters = (filters: HistoryFilters) => ({
    ...(filters.companionId !== undefined
      ? { companionId: filters.companionId }
      : {}),
    ...(filters.payerId !== undefined ? { payerId: filters.payerId } : {}),
    ...(filters.keyword !== undefined ? { keyword: filters.keyword } : {}),
    ...(filters.window !== undefined
      ? { window: filters.window === 'recent' ? undefined : filters.window }
      : {}),
    tzOffsetMinutes: new Date().getTimezoneOffset(),
  })

  const runFilteredHistory = async (
    filters: HistoryFilters,
    offset: number,
  ): Promise<void> => {
    const result = await fetchExpenseList(
      groupId,
      toListFilters(filters),
      offset,
    )
    if ('error' in result) {
      pushGuidedAnswer([], false, '')
      return
    }
    const remaining = result.nextOffset === null ? 0 : result.totalCount - result.nextOffset
    pushAnswer(
      composeHistoryFiltered({
        rows: result.rows.map((r) => ({
          title: r.title,
          amount: BigInt(r.amountMinor),
          currency: r.currency,
          payerName: nameOf(r.payerId),
        })),
        totalCount: result.totalCount,
        totals: result.totalsByCurrency.map((t) => ({
          amount: BigInt(t.sumMinor),
          currency: t.currency,
        })),
        remaining,
      }),
      (line) =>
        line.key === 'assistant.history.loadMore' && result.nextOffset !== null
          ? { onSelect: () => void runFilteredHistory(filters, result.nextOffset!) }
          : {},
    )
  }

  const cancel = () => {
    setOutcome(null)
    setChatItems([])
    setText('')
    setAskAmountText('')
    setForce(false)
    setAskAmountInvalid(false)
    setFundingChoice('PAY_AS_YOU_GO')
    setEditPending(false)
  }

  /** Task 2: one assistant answer bubble for a failed scan, keyed per
   *  `ErrorCode` from `/api/receipts/parse` (route.ts) plus the client-side
   *  `OFFLINE` case (a thrown `fetch`, same convention `ReceiptScan.tsx`
   *  uses). `NOT_CONFIGURED`/`DAILY_LIMIT_REACHED`/`IMAGE_TOO_LARGE` each get
   *  their own copy; `TIMEOUT`/`RATE_LIMITED`/`PARSE_FAILED` (and a thrown
   *  client-side resize) share the generic `chat.scan.failed`. When the
   *  server kept the photo despite the failure (`imagePath` non-null), an
   *  extra `chat.scan.photoKept` line says so. */
  const pushScanFailure = (
    code: string,
    limit: number | undefined,
    imagePath: string | null,
  ) => {
    const key =
      code === 'NOT_CONFIGURED'
        ? 'chat.scan.notConfigured'
        : code === 'DAILY_LIMIT_REACHED'
          ? 'chat.scan.dailyLimit'
          : code === 'IMAGE_TOO_LARGE'
            ? 'chat.scan.tooLarge'
            : code === 'OFFLINE'
              ? 'chat.scan.offline'
              : 'chat.scan.failed'
    const lines: AnswerLine[] = [
      { key, values: limit !== undefined ? { limit } : undefined },
    ]
    if (imagePath !== null) {
      lines.push({ key: 'chat.scan.photoKept' })
    }
    answerMessageCounter.current += 1
    pushMessage({
      id: `assistant-${answerMessageCounter.current}`,
      role: 'assistant',
      kind: 'answer',
      lines,
      testId: 'chat-scan-error',
    })
  }

  /**
   * Task 2 (chat-image-c): attach a receipt photo from the composer.
   * Mirrors `ReceiptScan.tsx:172-206`'s own resize -> POST
   * /api/receipts/parse round trip (same client machinery, same 30s
   * AbortController timeout), but routes the result into the transcript
   * instead of a dedicated screen — see the plan's "Composer flow" section.
   *
   * The scanning indicator (`SCAN_PROGRESS_ID`) is removed on every exit
   * path — success, every failure code, and a thrown client-side resize —
   * and `scanning` (gating the attach button) is cleared by the `finally`
   * below no matter which path was taken.
   */
  const handleAttach = async (file: File) => {
    // The same-message intent: whatever was typed before attaching, same
    // role a fresh sentence plays for `parse()` elsewhere — captured and
    // cleared up front so the composer's own input empties immediately,
    // matching the ordinary submit flow.
    const intentText = text.trim()
    setText('')

    // Shown from the ORIGINAL file immediately (ReceiptScan.tsx's own
    // precedent) — the resize below takes real time, and the user should
    // see their own photo the instant they pick it, not a blank gap.
    const objectUrl = URL.createObjectURL(file)
    if (scanImageUrlRef.current) URL.revokeObjectURL(scanImageUrlRef.current)
    scanImageUrlRef.current = objectUrl
    userMessageCounter.current += 1
    // The bubble is pushed BEFORE the upload exists — `imagePath` is
    // unknown yet, so it starts `null` and is filled in with an
    // `upsertMessage` on the same id (below) once the scan actually
    // succeeds and reports one. Captured here so that later upsert can
    // target the exact same bubble.
    const imageMessageId = `user-${userMessageCounter.current}`
    pushMessage({
      id: imageMessageId,
      role: 'user',
      kind: 'image',
      url: objectUrl,
      text: intentText || null,
      imagePath: null,
    })
    upsertMessage({ id: SCAN_PROGRESS_ID, role: 'assistant', kind: 'scanning' })
    setScanning(true)
    try {
      let resized: Awaited<ReturnType<typeof resizeReceiptImage>>
      try {
        resized = await resizeReceiptImage(file)
      } catch {
        // Browser couldn't decode the file — nothing was ever uploaded.
        removeMessage(SCAN_PROGRESS_ID)
        pushScanFailure('PARSE_FAILED', undefined, null)
        return
      }

      const form = new FormData()
      form.set('groupId', groupId)
      form.set('image', resized.blob, 'receipt.jpg')

      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(),
        RECEIPT_PARSE_TIMEOUT_MS,
      )
      let json: ParseSuccess | ParseFailure
      try {
        const response = await fetch('/api/receipts/parse', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
        json = (await response.json()) as ParseSuccess | ParseFailure
        if (!response.ok || !json.ok) {
          removeMessage(SCAN_PROGRESS_ID)
          pushScanFailure(
            json.ok ? 'PARSE_FAILED' : json.error,
            json.ok ? undefined : json.limit,
            (json.ok ? null : json.imagePath) ?? null,
          )
          return
        }
      } catch (error) {
        // Same distinction `ReceiptScan.tsx` draws: the 30s
        // AbortController firing is a TIMEOUT (folds into the generic
        // `chat.scan.failed` copy below), anything else genuinely offline.
        removeMessage(SCAN_PROGRESS_ID)
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        pushScanFailure(aborted ? 'TIMEOUT' : 'OFFLINE', undefined, null)
        return
      } finally {
        clearTimeout(timer)
      }

      removeMessage(SCAN_PROGRESS_ID)
      const receipt = parsedReceiptSchema.parse(json.receipt)
      // Named `scanOutcome`, not `outcome` — this function closes over the
      // component's own `outcome` STATE (the live card, read via
      // `outcomeRef` just below), and shadowing it here would be a trap for
      // the next reader even though it happens to type-check.
      const scanOutcome = mergeReceiptIntoChat(receipt, json.check, defaultCurrency)
      const imagePath = json.imagePath ?? null
      if (imagePath !== null) {
        // Fills in the already-pushed image bubble in place — `upsertMessage`
        // replaces at the same index, so this never reorders the bubble that
        // is already on screen. Also flows through the persist queue
        // (`ChatTranscriptProvider`), which dedupes a push-then-upsert of the
        // same id into one queued write when the flush hasn't fired yet.
        upsertMessage({
          id: imageMessageId,
          role: 'user',
          kind: 'image',
          url: objectUrl,
          text: intentText || null,
          imagePath,
        })
      }
      // Same message's own text carries the payer/participants/description
      // intent — merge() never reads it, that's this component's job (plan
      // "Merge rules" §title). `parse('')` is safe (no amount, actor payer,
      // every member participating), so an image with no accompanying text
      // needs no special case.
      const parsedFromText = parse(intentText, {
        members,
        actorId,
        defaultCurrency,
      })

      // Same ordering fix `openExpenseCard` applies for a fresh sentence
      // (spec §5.5(b)): a card already open when the scan finishes has to
      // be REMOVED before the new one is set, or the outcome-sync effect's
      // `upsertMessage` would overwrite it in place — above the image/
      // scanning bubbles this attach just pushed, not below them. Reads the
      // ref (not the closure `outcome`), same reasoning as
      // `openExpenseCard` — this is itself an async function that could in
      // principle resume after other state has moved on.
      if (outcomeRef.current !== null && scanOutcome.kind !== 'refuse') {
        removeMessage(OUTCOME_MESSAGE_ID)
      }

      if (scanOutcome.kind === 'items') {
        openConfirmItems(parsedFromText, scanOutcome.list, imagePath)
        // Merchant name wins over the items card's own first-item auto
        // title (plan: "title = merchantName ?? null... Composer applies
        // it") — set AFTER `openConfirmItems` so this is the value that
        // sticks, not a race with its own `setDescription` call.
        if (scanOutcome.title !== null) {
          setDescription(scanOutcome.title)
        }
        return
      }
      if (scanOutcome.kind === 'totalOnly') {
        const amountMinor = parseAmountToMinor(
          scanOutcome.amount,
          scanOutcome.currency,
        )
        // `mergeReceiptIntoChat` always derives `amount` from an already-
        // validated minor-units integer (`minorToDecimalInput`), so this
        // can never actually be null — guarded anyway so this stays a total
        // function rather than a thrown assertion.
        if (amountMinor === null) {
          pushScanFailure('PARSE_FAILED', undefined, imagePath)
          return
        }
        openConfirm(
          {
            ...parsedFromText,
            amount: scanOutcome.amount,
            // The RECEIPT's currency/amount win on conflict (plan: "On
            // amount conflict... the RECEIPT wins — the card re-confirms
            // anyway").
            currency: scanOutcome.currency,
            description: scanOutcome.title ?? parsedFromText.description,
          },
          scanOutcome.amount,
          amountMinor,
          imagePath,
          t(
            scanOutcome.reason === 'NO_ITEMS'
              ? 'scan.totalOnlyNotice'
              : 'scan.sumMismatchNotice',
          ),
        )
        return
      }
      // scanOutcome.kind === 'refuse': no items, no total — never guess,
      // ask again rather than save nothing meaningful.
      answerMessageCounter.current += 1
      pushMessage({
        id: `assistant-${answerMessageCounter.current}`,
        role: 'assistant',
        kind: 'answer',
        lines: [
          { key: 'chat.scan.notAReceipt' },
          { key: 'chat.scan.retryHint' },
        ],
        testId: 'chat-scan-refused',
      })
    } finally {
      setScanning(false)
    }
  }

  /** The context `classify()` needs — the live card, reconstructed from
   *  this component's own state (spec §2.1's `OpenCard` mirrors `Outcome`
   *  one-for-one for exactly this). `classify()` never reads `draft`/
   *  `amountMinor` itself (only `kind`), so exact fidelity here is a nicety,
   *  not a correctness requirement. */
  const openCard: OpenCard | null = useMemo(() => {
    if (outcome === null) return null
    if (outcome.kind === 'askAmount') {
      return { kind: 'askAmount', draft: outcome.parsed }
    }
    // `multiAmount` and `confirmItems` are deliberately NOT an OpenCard —
    // see the `Outcome` type doc comment above: there is nothing for
    // CONFIRM_MODIFY to act on (an items card has no defined meaning for a
    // worded payer/split/participants edit), so classify() must see either
    // exactly as if no card were open. The items card's own Save button is
    // still reachable — it never goes through `classify()`/CONFIRM_YES at
    // all.
    // Task 10's two edit cards get the SAME treatment, for the same reason:
    // they hold no DRAFT at all (the expense they point at is already saved),
    // so CONFIRM_MODIFY has nothing to act on and CONFIRM_YES has no card
    // `formAction` to fire. A fresh sentence typed while one is showing is
    // classified exactly as if no card were open — including another context
    // command, which simply supersedes this one.
    // 2026-08-14 live-app fix round: `confirmItems` IS an OpenCard now — the
    // 'items' variant, exposing its lines so classify() can bind a typed
    // price ("콜라는 500엔") to one instead of the old behavior, where the
    // whole card was invisible and any follow-up destroyed it by
    // classifying as a fresh EXPENSE_ENTRY. It still carries no draft, so
    // the payer/split/participants modify family remains unavailable.
    if (outcome.kind === 'confirmItems') {
      return {
        kind: 'items',
        lines: chatItems.map((item) => ({
          key: item.key,
          name: item.name,
          unpriced: item.unitAmount === null,
        })),
      }
    }
    if (
      outcome.kind === 'multiAmount' ||
      outcome.kind === 'disambiguate' ||
      outcome.kind === 'confirmEdit' ||
      outcome.kind === 'walletCreate'
    ) {
      return null
    }
    return {
      kind: 'confirm',
      draft: { ...outcome.parsed, description, payerId, participantIds },
      amountMinor: outcome.amountMinor,
    }
  }, [outcome, chatItems, description, payerId, participantIds])

  // Injects an amount into whatever card is waiting for one: an `askAmount`
  // card transitions to `confirm` via `openConfirm` (review NEW-5 — this
  // DOES bump `submissionCounter`/assign a new `submissionId`, same as any
  // other `openConfirm` call; the id is an internal save-result-matching
  // tag, not a transcript position). What stays IN PLACE is the TRANSCRIPT
  // MESSAGE (`OUTCOME_MESSAGE_ID` is never removed+re-appended for this
  // transition) — spec §5.5(b)'s ordering fix only reshuffles the
  // transcript for a card SUPERSEDED by a fresh sentence (`openExpenseCard`
  // above); the askAmount → confirm morph is the one documented exception
  // to that rule, since it is the SAME card gaining its amount, not a new
  // one replacing it (see task-6-report.md's M1 note). A `confirm` card
  // already open instead gets its amount updated IN PLACE at the STATE
  // level too — no new `submissionId`, no `openConfirm` call at all — since
  // that really is the same save attempt continuing. Shared by the
  // dedicated askAmount input AND by `CONFIRM_MODIFY {field:'amount'}`
  // typed into the main composer while either card kind is open.
  //
  // Task 3 (docs/PROMPT.md [2026-08-14] decision 2): `slotCurrency` is the
  // currency the REPLY named, if any. An open card is an unsaved draft, so it
  // takes that currency along with the amount — `resolveModifyCurrency` owns
  // that rule (and the funding reset it forces); `undefined` keeps the card's
  // own currency, which is what a bare number means.
  const applyAmountModify = (
    amount: string,
    slotCurrency?: string,
  ): bigint | null => {
    if (outcome?.kind !== 'askAmount' && outcome?.kind !== 'confirm') {
      return null
    }
    const { currency, fundingReset } = resolveModifyCurrency(
      outcome.parsed.currency,
      slotCurrency,
    )
    // A2: the draft's OWN currency, never `defaultCurrency` — an askAmount
    // card can now be open on a genuinely foreign currency (a foreign parse
    // no longer intercepts before the amount check), and re-typing the
    // amount must not silently reset it back to the chat default.
    // `amountMentions: 1` — this is a single deliberate typed reply (the
    // askAmount card's own input, or a CONFIRM_MODIFY amount edit), never a
    // fresh multi-item sentence to scan; the A2 review guard (and the
    // `parseItems` call it now gates) has nothing to do here, so the
    // rawInput/defaultCurrency args below are never actually read.
    const resolved = resolveChatOutcome(
      {
        amount,
        currency,
        amountMentions: 1,
      },
      amount,
      { members, actorId, defaultCurrency },
    )
    if (resolved.kind !== 'confirm') {
      return null
    }
    if (outcome.kind === 'askAmount') {
      // `openConfirm` already resets the funding choice for the fresh card, so
      // `fundingReset` needs no separate handling on this branch.
      openConfirm(
        { ...outcome.parsed, amount: resolved.amount, currency },
        resolved.amount,
        resolved.amountMinor,
      )
      return resolved.amountMinor
    }
    setOutcome({
      ...outcome,
      // The card's own currency, so everything keyed off it follows in one
      // step: the rendered amount, the A2 funding section's show/hide and
      // wallet filter, the wizard escape link's prefill, and the save payload.
      parsed: { ...outcome.parsed, currency },
      amount: resolved.amount,
      amountMinor: resolved.amountMinor,
    })
    if (fundingReset) {
      setFundingChoice('PAY_AS_YOU_GO')
    }
    return resolved.amountMinor
  }

  const submitAskAmount = () => {
    if (applyAmountModify(askAmountText) !== null) {
      setAskAmountInvalid(false)
    } else {
      // Still unusable (empty, garbled, absurd): stay put rather than crash
      // or guess, but say so — silently doing nothing read as a dead button.
      setAskAmountInvalid(true)
    }
  }

  // CONFIRM_MODIFY's payer/split/participants slots mutate whichever draft
  // is live: a `confirm` card's own editable state (`payerId`/
  // `participantIds`), or — for an `askAmount` card, which has no such UI
  // of its own yet — the parsed draft directly, so the edit still carries
  // forward once the amount eventually arrives.
  const applyParticipants = (ids: string[]): string[] => {
    // Stable order: as the group lists members, so pills never reshuffle.
    const ordered = members.filter((m) => ids.includes(m.id)).map((m) => m.id)
    if (outcome?.kind === 'confirm') {
      setParticipantIds(ordered)
    } else if (outcome?.kind === 'askAmount') {
      setOutcome({
        ...outcome,
        parsed: { ...outcome.parsed, participantIds: ordered },
      })
    }
    return ordered
  }

  const applyPayer = (memberId: string) => {
    if (outcome?.kind === 'confirm') {
      setPayerId(memberId)
      // A2: a wallet chosen for the old payer cannot fund the new one's
      // expense (mirrors StepPayment.tsx's own payer-switch reset).
      setFundingChoice('PAY_AS_YOU_GO')
    } else if (outcome?.kind === 'askAmount') {
      setOutcome({
        ...outcome,
        parsed: { ...outcome.parsed, payerId: memberId },
      })
    }
  }

  /** Task 3: the currency the card on screen is showing right now — read for
   *  the modify REPLY, which must name the same currency the card does. */
  const currentCardCurrency = (): string =>
    outcome?.kind === 'confirm' || outcome?.kind === 'askAmount'
      ? outcome.parsed.currency
      : defaultCurrency

  const currentParticipantIds = (): string[] =>
    outcome?.kind === 'confirm'
      ? participantIds
      : outcome?.kind === 'askAmount'
        ? outcome.parsed.participantIds
        : []

  /** spec §3.4 / §4.7 — applies one CONFIRM_MODIFY slot to the open card's
   *  draft state and returns the reply to show for it. */
  const applyModify = (
    classified: Extract<Classified, { intent: 'CONFIRM_MODIFY' }>,
    trimmed: string,
  ): AssistantAnswer => {
    if (classified.field === null) {
      return composeConfirm({ kind: 'askWhatToChange' })
    }
    if (classified.field === 'itemPrice') {
      // Only reachable with the items card open (classify gates on
      // openCard.kind === 'items'), but guard anyway — a stale classified
      // result must never write into a different card's state.
      if (outcome?.kind !== 'confirmItems') {
        return composeConfirm({ kind: 'askWhatToChange' })
      }
      const item = chatItems.find((i) => i.key === classified.key)
      if (!item) {
        return composeConfirm({ kind: 'askWhatToChange' })
      }
      const cardCurrency = outcome.itemsCurrency
      const minor = parseAmountToMinor(classified.amount, cardCurrency)
      // A price the card can't book: unparsable at this currency, or the
      // reply named a DIFFERENT currency (mixed-currency item lists are
      // refused at parse time, and a follow-up can't smuggle one in).
      if (
        minor === null ||
        (classified.currency !== undefined && classified.currency !== cardCurrency)
      ) {
        return composeConfirm({ kind: 'askItemPrice', name: item.name })
      }
      const nextItems = setUnitAmount(chatItems, classified.key, classified.amount)
      setChatItems(nextItems)
      const nextUnpriced = nextItems.find((i) => i.unitAmount === null)
      return composeConfirm({
        kind: 'itemPriced',
        name: item.name,
        // The UNIT price, exactly what the reply stated — the card's own
        // line total is already visible right above this bubble.
        amount: minor,
        currency: cardCurrency,
        nextName: nextUnpriced ? nextUnpriced.name : null,
      })
    }
    if (classified.field === 'amount') {
      const amountMinor =
        classified.amount === null
          ? null
          : applyAmountModify(classified.amount, classified.currency)
      return amountMinor === null
        ? composeConfirm({ kind: 'askWhichAmount' })
        : composeConfirm({
            kind: 'updatedAmount',
            amount: amountMinor,
            // Task 3: the currency the card now carries — the reply's own when
            // it named one, otherwise the card's. `defaultCurrency` used to be
            // hardcoded here, which read back "₩4,000" for a ¥4,000 card.
            currency: resolveModifyCurrency(
              currentCardCurrency(),
              classified.currency,
            ).currency,
          })
    }
    if (classified.field === 'itemAssign') {
      if (outcome?.kind !== 'confirmItems') {
        return composeConfirm({ kind: 'askWhatToChange' })
      }
      const item = chatItems.find((i) => i.key === classified.key)
      if (!item) {
        return composeConfirm({ kind: 'askWhatToChange' })
      }
      if (classified.shareAll) {
        setChatItems(
          assignEveryone(
            chatItems,
            classified.key,
            participantIds,
            payerId,
            outcome.itemsCurrency,
          ),
        )
        return composeConfirm({ kind: 'itemShared', name: item.name })
      }
      // Named assignees replace the line's current set — a typed statement
      // of who had it is a correction, not an addition. Whole units each
      // when they go round, 1 each otherwise (same rule as toChatItems).
      const each =
        classified.memberIds.length > 0 &&
        item.quantity % classified.memberIds.length === 0
          ? item.quantity / classified.memberIds.length
          : 1
      setChatItems(
        chatItems.map((i) =>
          i.key === classified.key
            ? {
                ...i,
                splitMode: 'BY_QUANTITY' as const,
                assignees: classified.memberIds.map((memberId) => ({
                  memberId,
                  quantity: each,
                })),
              }
            : i,
        ),
      )
      return composeConfirm({
        kind: 'itemAssigned',
        name: item.name,
        names: classified.memberIds.map((id) => nameOf(id)),
      })
    }
    if (classified.field === 'payer') {
      applyPayer(classified.memberId)
      return composeConfirm({
        kind: 'updatedPayer',
        name: nameOf(classified.memberId),
      })
    }
    if (classified.field === 'split') {
      if (classified.split === 'everyone') {
        applyParticipants(members.map((m) => m.id))
        return composeConfirm({ kind: 'updatedEveryone' })
      }
      // Review C1 (Critical, money-affecting): `classify()`'s own
      // `split:'half'` slot carries no member id, so who the "other half"
      // is has to be resolved here — see `resolveHalfSplitParticipants`'s
      // doc comment for why the old "actor + current payer" fallback was a
      // real money bug (it could produce a ONE-person split, i.e. 100% of
      // the amount landing on a single person). `null` means genuinely
      // ambiguous (3+ members, no name in the sentence) — the card's
      // participants are left untouched, and `halfSplitReply` (review
      // NEW-1) answers with `assistant.confirm.askWhoToRemove` instead of
      // the generic "card still open" GUIDED fallback this used to reuse,
      // which told the user something they already knew (a card was open)
      // and offered an escape link that would have abandoned the very card
      // being edited.
      const ids = resolveHalfSplitParticipants(trimmed, members, actorId)
      if (ids !== null) {
        applyParticipants(ids)
      }
      return halfSplitReply(ids, actorId, nameOf)
    }
    // classified.field === 'participants'
    if (classified.op === 'only') {
      const ids = applyParticipants(classified.memberIds)
      return composeConfirm({
        kind: 'updatedParticipants',
        names: members.filter((m) => ids.includes(m.id)).map((m) => m.name),
      })
    }
    // Final-review I4: a §2.3-named marker (빼줘/제외/포함/minus/without/
    // everyone but) fired with no bound name in the sentence
    // (`classified.memberId === null`) — ask who, without touching the
    // draft, same precedent as `split:'half'` with no name (`halfSplitReply`
    // above) instead of the generic UNKNOWN/cardOpenAck+card-abandoning-
    // escape-link fallback this used to route through. `classified.op` is
    // still carried on the null-memberId slot (classify.ts), so a bare
    // 포함/add marker asks "who should I ADD?" rather than reusing the
    // remove-direction copy — T7 intake fix, the two used to collapse onto
    // one askWhoToRemove reply regardless of which marker fired.
    if (classified.memberId === null) {
      return composeConfirm(
        classified.op === 'add'
          ? { kind: 'askWhoToAdd' }
          : { kind: 'askWhoToRemove' },
      )
    }
    const current = currentParticipantIds()
    if (classified.op === 'remove') {
      const filtered = current.filter((id) => id !== classified.memberId)
      // Minor batch: removing the group's LAST remaining participant is a
      // no-op (mirrors `toggleParticipants`'s own "never empty" guard) — it
      // must not claim a false "updated" ack for a draft that didn't
      // actually change.
      if (filtered.length === 0) {
        return composeConfirm({ kind: 'askWhoToRemove' })
      }
      const ids = applyParticipants(filtered)
      return composeConfirm({
        kind: 'updatedParticipants',
        names: members.filter((m) => ids.includes(m.id)).map((m) => m.name),
      })
    }
    // classified.op === 'add'
    const ids = applyParticipants([
      ...new Set([...current, classified.memberId]),
    ])
    return composeConfirm({
      kind: 'updatedParticipants',
      names: members.filter((m) => ids.includes(m.id)).map((m) => m.name),
    })
  }

  /**
   * spec §1's non-guided, non-entry, non-confirm intents — EXCEPT
   * `QUERY_PAIRWISE`, which has its own top-level case in `submitSentence`
   * (review I4): a `memberId === null` pairwise question has no settlement
   * read to do at all, it needs the SAME chip-wired GUIDED fallback the
   * `UNKNOWN` branch uses, and a pure function returning an `AssistantAnswer`
   * cannot also wire up `onSelect` callbacks — so it never belonged in a
   * function whose whole point is "no side effects, just a reply."
   */
  const composeAnswer = (
    classified: Exclude<
      Classified,
      {
        intent:
          | 'EXPENSE_ENTRY'
          | 'CONFIRM_YES'
          | 'CONFIRM_NO_CANCEL'
          | 'CONFIRM_MODIFY'
          | 'QUERY_PAIRWISE'
          | 'UNKNOWN'
          | 'EDIT_EXPENSE'
          | 'SMALL_TALK'
          | 'ACTION_CREATE_WALLET'
          | 'QUERY_EXPLAIN'
      }
    >,
  ): AssistantAnswer => {
    switch (classified.intent) {
      case 'QUERY_MY_BALANCE': {
        const transfers = assistantData.transfers.map((tr) => ({
          from: tr.from,
          to: tr.to,
          amount: BigInt(tr.amount),
        }))
        return composeMyBalance({
          transfers,
          actorId,
          names: fullNameMap,
          currency: assistantData.currency,
          view: classified.view,
          hasExpenses: assistantData.expenseCount > 0,
        })
      }
      case 'QUERY_GROUP_TOTAL': {
        const total = BigInt(assistantData.groupTotal)
        if (classified.view === 'transfers') {
          const transfers = assistantData.transfers.map((tr) => ({
            from: tr.from,
            to: tr.to,
            amount: BigInt(tr.amount),
          }))
          return composeGroupTotal({
            total,
            count: assistantData.expenseCount,
            memberCount: assistantData.groupParticipantCount,
            transfers,
            names: fullNameMap,
            currency: assistantData.currency,
          })
        }
        return composeGroupTotal({
          total,
          count: assistantData.expenseCount,
          memberCount: assistantData.groupParticipantCount,
          names: fullNameMap,
          currency: assistantData.currency,
        })
      }
      case 'QUERY_MY_SPENDING':
        return composeMySpending({
          paid: BigInt(assistantData.myPaid),
          consumed: BigInt(assistantData.myConsumed),
          net: BigInt(assistantData.myNet),
          currency: assistantData.currency,
          view: classified.view,
          hasExpenses: assistantData.hasAnyExpenses,
        })
      case 'QUERY_WALLET': {
        // Minor batch: `classified.currency` (a walletCurrencyName hit,
        // e.g. '달러 얼마 남았어' -> USD) narrows which wallets answer the
        // question — the old code always listed every wallet regardless of
        // what was asked. `composeWallet`'s own `wallets.length === 0`
        // branch already reuses the existing `wallet.empty` copy when the
        // filter matches nothing, so no new key is needed.
        const filtered =
          classified.currency === null
            ? assistantData.wallets
            : assistantData.wallets.filter(
                (w) => w.currency === classified.currency,
              )
        return composeWallet({
          wallets: filtered.map((w) => ({
            label: w.label,
            currency: w.currency,
            remaining: BigInt(w.remaining),
            overdrawn: w.overdrawn,
          })),
        })
      }
      case 'QUERY_HISTORY': {
        // The recent-expense list, in chat (2026-08-14 prime directive: a
        // bounce to the history screen is a failure). `recentExpenses` is
        // the same feed slice the context commands resolve against —
        // newest first, cancelled rows excluded here.
        const matching = recentExpenses.filter(
          (e) =>
            !e.cancelled &&
            (classified.scope === 'mine' ? e.payerId === actorId : true),
        )
        return composeHistory({
          scope: classified.scope,
          rows: matching.slice(0, 5).map((e) => ({
            title: e.note,
            amount: BigInt(e.amountMinor),
            currency: e.currency,
            payerName: nameOf(e.payerId),
          })),
          total: matching.length,
        })
      }
      case 'HELP':
        return composeHelp()
    }
  }

  /** Pushes one composer/query reply. `augment`, when given, decides EACH
   *  line's interactivity — a GUIDED option line becomes a tappable chip
   *  (`onSelect`) and the GUIDED `escape` line becomes a real link
   *  (`href`, review I1); every other line stays plain text. Kept generic
   *  (not GUIDED-specific) so the same function pushes both plain composer
   *  replies (no `augment`) and GUIDED ones. */
  const pushAnswer = (
    answer: AssistantAnswer,
    augment?: (
      line: AssistantAnswerLine,
    ) => Partial<Pick<AnswerLine, 'onSelect' | 'href'>>,
  ) => {
    answerMessageCounter.current += 1
    const lines: AnswerLine[] = answer.lines.map((line) => ({
      key: line.key,
      values: line.values,
      ...(augment ? augment(line) : {}),
    }))
    pushMessage({
      id: `assistant-${answerMessageCounter.current}`,
      role: 'assistant',
      kind: 'answer',
      lines,
    })
  }

  // Opens (or replaces) the composer's one live outcome card from a parsed
  // draft — the EXPENSE_ENTRY path `classify()` routes to, AND the direct
  // bypass the GUIDED `option.expense` chip uses (review I1, see
  // `pushGuidedAnswer` below): a card already open, superseded by a fresh
  // one, is REMOVED ahead of the new one — spec §5.5(b): without this,
  // `upsertMessage` writes the new card back at the OLD card's index, above
  // the sentence (or chip) that produced it. The `setOutcome` calls below
  // still run in the SAME event, so the removal and the new card's eventual
  // append (from the outcome-sync effect) land in the right order.
  const openExpenseCard = (parsed: ParsedExpense, rawInput: string) => {
    const resolved = resolveChatOutcome(parsed, rawInput, {
      members,
      actorId,
      defaultCurrency,
    })
    // Final-review I2: reads the ref, not the closed-over `outcome` — see
    // `outcomeRef`'s own doc comment above for why a stale-chip call needs
    // this to still see the CURRENT card.
    if (outcomeRef.current !== null) {
      removeMessage(OUTCOME_MESSAGE_ID)
    }
    if (resolved.kind === 'multiAmount') {
      // A2 review guard: `parsed.amountMentions >= 2` — never build a
      // confident single-amount card from the lone FIRST number a
      // multi-item sentence happens to report. This isn't a persistent
      // "open card" (nothing to CONFIRM_YES/CONFIRM_MODIFY against — see
      // the `multiAmount` doc comment on `Outcome` below), so it is never
      // exposed to `classify()` via `openCard` either.
      setOutcome({ kind: 'multiAmount', parsed })
    } else if (resolved.kind === 'confirmItems') {
      // Task 3: `parseItems` found a clean item list on the SAME sentence —
      // the "who had what" card replaces the bare notice.
      openConfirmItems(parsed, resolved.items)
    } else if (resolved.kind === 'askAmount') {
      setOutcome({ kind: 'askAmount', parsed })
      setAskAmountText('')
      setAskAmountInvalid(false)
    } else {
      openConfirm(parsed, resolved.amount, resolved.amountMinor)
    }
  }

  /**
   * Task 10 (context commands) — an EDIT_EXPENSE sentence, resolved against
   * the expenses this page already loaded.
   *
   * Nothing is applied here. `resolveEditCard` either found exactly one
   * expense (→ the confirm card, which still asks) or it did not (→ the
   * disambiguation card, which asks WHICH). That is the whole design: the
   * assistant may narrow, it may never decide.
   *
   * A card already open is REMOVED before the new one is set — spec §5.5(b)'s
   * ordering fix, same as `openExpenseCard`: without it the outcome-sync
   * effect's `upsertMessage` would write this card back at the OLD card's
   * index, above the sentence that produced it. Reads `outcomeRef`, not the
   * closed-over `outcome`, for the same stale-closure reason documented there.
   */
  const openEditCard = (
    reference: Extract<Classified, { intent: 'EDIT_EXPENSE' }>['reference'],
    action: EditAction,
  ) => {
    // The DEVICE's offset and the DEVICE's clock, exactly as
    // `resolveReference` requires (the Phase 3C rule: "today" means the day
    // the person typing is standing in). Captured once and carried on the
    // outcome so the card's dates and the resolver agree.
    const now = new Date()
    const tzOffsetMinutes = now.getTimezoneOffset()
    // An amount this app cannot represent at its own currency's exponent has
    // nothing to confirm — say so instead of opening a card whose only button
    // would be refused (`editAskOf` is the single place that decides this, for
    // both the card and this guard).
    if (editAskOf(action, nameOf) === null) {
      pushAnswer({ lines: [{ key: 'chat.edit.badAmount' }] })
      return
    }
    const resolved = resolveEditCard(
      reference,
      liveExpenses,
      now,
      tzOffsetMinutes,
    )
    if (outcomeRef.current !== null) {
      removeMessage(OUTCOME_MESSAGE_ID)
    }
    setEditPending(false)
    setOutcome(
      resolved.kind === 'confirmEdit'
        ? {
            kind: 'confirmEdit',
            action,
            expense: resolved.expense,
            tzOffsetMinutes,
          }
        : {
            kind: 'disambiguate',
            action,
            candidates: resolved.candidates,
            found: resolved.found,
            tzOffsetMinutes,
          },
    )
  }

  /** Tapping a disambiguation row narrows to the confirm card for THAT
   *  expense — the same transcript slot, more content (the documented
   *  askAmount → confirm precedent), never an applied edit. */
  const pickEditCandidate = (expenseId: string) => {
    if (outcome?.kind !== 'disambiguate') {
      return
    }
    const picked = outcome.candidates.find(
      (candidate) => candidate.id === expenseId,
    )
    if (picked === undefined) {
      return
    }
    setOutcome({
      kind: 'confirmEdit',
      action: outcome.action,
      expense: picked,
      tzOffsetMinutes: outcome.tzOffsetMinutes,
    })
  }

  const dispatchEdit = (
    action: EditAction,
    expense: RecentExpenseLite,
  ): Promise<EditResult> => {
    const expenseId = expense.id
    switch (action.kind) {
      case 'addParticipant':
        return applyAddParticipant(groupId, expenseId, action.memberId)
      case 'removeParticipant':
        return applyRemoveParticipant(groupId, expenseId, action.memberId)
      case 'changeAmount':
        // The SENTENCE's currency, never the group's — an applier told only
        // the number would book "30달러" as ₩30 (T9's ruling). And when that
        // currency is not the one the expense is stored in, this is not an
        // in-place edit at all: `applyCurrencyChange` cancels the expense and
        // re-creates it, which is what the card the user just confirmed said
        // it would do (F-T4).
        return isCurrencySwap(action, expense)
          ? applyCurrencyChange(
              groupId,
              expenseId,
              action.amount,
              action.currency,
            )
          : applyChangeAmount(
              groupId,
              expenseId,
              action.amount,
              action.currency,
            )
      case 'cancel':
        return applyCancel(groupId, expenseId)
    }
  }

  /**
   * Applies the confirmed edit and reports it in the transcript.
   *
   * The reply is built from the ACTION RESULT, not from a refresh — the one
   * delivery point rule the saved bubble already follows (docs/SOLVED.md
   * 2026-08-09). The refresh still runs afterwards for everything else this
   * route's server data backs (balances, the feed, the recent-expense list),
   * but nothing the user is watching for depends on it landing.
   */
  const runEdit = async (action: EditAction, expense: RecentExpenseLite) => {
    setEditPending(true)
    let result: EditResult
    try {
      result = await dispatchEdit(action, expense)
    } catch (error) {
      // A dropped connection mid-action. Say so rather than leaving a spinner
      // on a card that will never resolve.
      console.error('chat edit failed', error)
      result = { ok: false, errorKey: 'chat.edit.failed' }
    }
    // Closes the card either way: a refusal is a reason, not a retry loop —
    // the user can say it again (or differently) with the reason on screen.
    cancel()
    if (!result.ok) {
      pushAnswer({ lines: [{ key: result.errorKey }] })
      return
    }
    const fresh = result.expense
    // A currency swap returns TWO rows — the new expense and the one it
    // cancelled — and both belong in the override map: without the cancelled
    // one the next sentence would still be offered the row that no longer
    // counts (F-T4).
    const replaced = result.replaced
    setEditedExpenses((previous) => ({
      ...previous,
      ...(replaced === undefined ? {} : { [replaced.id]: replaced }),
      [fresh.id]: fresh,
    }))
    pushAnswer({
      lines: [
        {
          // Keyed off what the SERVER did, not off what the client asked for:
          // `replaced` is present exactly when a row was cancelled and
          // re-created, so a swap that the action declined to treat as one
          // (a same-currency delegation) can never be reported as one.
          key: editDoneKey(action, replaced !== undefined),
          values: { note: fresh.note },
        },
      ],
    })
    // Called inline, unlike the SAVE path's refresh, which had to move into an
    // effect (docs/SOLVED.md 2026-08-09: dispatching it inside a still-pending
    // `useActionState` transition intermittently lost the re-render). There is
    // no transition here — this is a plain async event handler — and nothing
    // the user is watching for depends on the refresh anyway: the bubble above
    // is already pushed and `editedExpenses` already holds the fresh row.
    router.refresh()
  }

  /**
   * The shared GUIDED reply builder — used by both `UNKNOWN` and a
   * `QUERY_PAIRWISE` with no bound member (review I4: the latter used to go
   * through the plain `composeAnswer`/`pushAnswer(answer)` path with no
   * `augment`, so its options rendered as inert text, not tappable chips).
   * `name`, when given, is who a `QUERY_PAIRWISE` suggestion (if offered)
   * points at.
   *
   * Each option chip's tap resubmits a canonical seed sentence for that
   * intent through the FULL pipeline — EXCEPT `EXPENSE_ENTRY` (review I1):
   * that chip is the user's OWN sentence, already proven not to satisfy
   * `classify()`'s EXPENSE_ENTRY gate (that is why it is on a GUIDED reply
   * in the first place) — resubmitting it through `submitSentence` would
   * classify it right back to `UNKNOWN` every time, an unbreakable loop.
   * It bypasses `classify()` entirely and opens a card straight from
   * `parse()`, exactly like the pre-Task-6 composer always did — the chip
   * IS the user's explicit "yes, treat it as one anyway."
   */
  const pushGuidedAnswer = (
    suggest: readonly Intent[],
    hold: boolean,
    trimmed: string,
    name?: string,
    topic?: 'settle',
  ) => {
    const answer = composeGuided({
      suggest,
      hold,
      input: trimmed,
      name,
      cardOpen: outcome !== null,
      topic,
    })
    pushAnswer(answer, (line) => {
      if (line.key === 'assistant.guided.escape') {
        // A real navigation, not a resubmit (review I1) — the current
        // sentence carries over as the wizard's draft note so nothing
        // typed is lost.
        return { href: draftFormHref(groupId, '', trimmed, defaultCurrency) }
      }
      const intent = GUIDED_OPTION_INTENT[line.key]
      if (intent === undefined) {
        return {}
      }
      return {
        onSelect: () => {
          if (intent === 'EXPENSE_ENTRY') {
            openExpenseCard(
              parse(trimmed, { members, actorId, defaultCurrency }),
              trimmed,
            )
            return
          }
          if (intent === 'QUERY_PAIRWISE') {
            if (name === undefined) return
            submitSentence(tSeed('pairwise', { name }))
            return
          }
          const seedKey = CHIP_SEED_KEY[intent]
          if (seedKey !== undefined) submitSentence(tSeed(seedKey))
        },
      }
    })
  }

  const submitSentence = (input: string) => {
    const trimmed = input.trim()
    if (!trimmed) {
      return
    }
    setText('')
    userMessageCounter.current += 1
    pushMessage({
      id: `user-${userMessageCounter.current}`,
      role: 'user',
      kind: 'text',
      text: trimmed,
    })

    // Dialogue memory, step 1 (docs/handoff/C-conversation-layer.md): a
    // person reference ("걔가 냈어") resolves against the conversation's
    // recent mentions and the pronoun span is REWRITTEN to the member's
    // name, so classify() and every parser below it see an ordinary named
    // sentence. Ambiguity or no referent asks (guard G4) — never guesses.
    const reference = resolvePersonReference(
      dialogueMemory.current,
      trimmed,
      members,
      actorId,
    )
    dialogueMemory.current = observeUserUtterance(
      dialogueMemory.current,
      reference.kind === 'resolved' ? reference.text : trimmed,
      members,
    )
    // R2b: the conversation memory survives reopening the session days
    // later — stashed on the provider and persisted WITH the next history
    // batch (one write path; a new chat's memory lands with the same batch
    // that lazily creates its session).
    persistMemory(dialogueMemory.current)
    if (reference.kind === 'ambiguous') {
      pushAnswer(composeWhoAmbiguous(reference.names))
      return
    }
    if (reference.kind === 'unknown') {
      pushAnswer(composeWhoUnknown())
      return
    }
    const effective = reference.kind === 'resolved' ? reference.text : trimmed

    const ctx: AssistantContext = {
      members,
      actorId,
      defaultCurrency,
      openCard,
      locale,
    }
    const classified = classify(effective, ctx)

    switch (classified.intent) {
      case 'EXPENSE_ENTRY': {
        // `effective`, not `trimmed`: the parsed spans (and any later
        // parseItems re-scan) must align with the text that was actually
        // classified — the reference-resolved rewrite.
        openExpenseCard(classified.parsed, effective)
        break
      }
      case 'CONFIRM_YES': {
        // Nothing to save (askAmount is still waiting on an amount) OR a
        // save for THIS card is already in flight — the double-YES guard
        // (review I3): a
        // second CONFIRM_YES fired before the first resolves must not
        // dispatch a second `saveExpense` call. Either way, say so instead
        // of silently doing nothing (or silently doing it twice).
        //
        // Both share `cardOpenAck` ("still open — finish that one first, or
        // cancel it"). Review NEW-2 asked whether a more accurate key fits
        // the `isSaving` case specifically ("a save is in progress, hold
        // on") — it does not: §4.7 has no "saving…" acknowledgement key
        // (`saved`/`cancelled`/`updatedX`/`askWhatToChange`/
        // `askWhichAmount`/`askWhoToRemove` are all post-decision or
        // pre-decision, none mid-flight), and §4.8's `guided.hold` means
        // the OPPOSITE direction (the ASSISTANT waiting on the USER, not
        // the reverse). Judgment call: `cardOpenAck` is imprecise here (the
        // card isn't idle, it's saving) but not WRONG (the card genuinely
        // is still open, nothing has been lost), and this is a narrow race
        // window rather than a state a user lingers in — not worth a new
        // locked key for.
        // 2026-08-14: a fully-priced items card saves on 응/네 exactly like
        // the ordinary confirm card; one with unpriced lines answers with
        // what is missing instead of the generic still-open ack.
        const itemsUnpriced =
          outcome?.kind === 'confirmItems'
            ? chatItems.filter((item) => item.unitAmount === null)
            : []
        const saveable =
          outcome?.kind === 'confirm' ||
          (outcome?.kind === 'confirmItems' && itemsUnpriced.length === 0)
        if (!saveable || isSaving) {
          if (itemsUnpriced.length > 0 && !isSaving) {
            pushAnswer(composeItemsPriceAsk(itemsUnpriced.map((i) => i.name)))
          } else {
            pushGuidedAnswer([], false, trimmed)
          }
        } else {
          // Acts exactly like tapping Save — the SAME `formAction`, so the
          // saved bubble still renders from the one delivery point
          // (docs/SOLVED.md 2026-08-09) regardless of how the save was
          // triggered. React 19 requires wrapping a dispatch called outside
          // its own `<form>`'s submit event in a transition (review I3).
          startTransition(() => formAction(new FormData()))
        }
        break
      }
      case 'CONFIRM_NO_CANCEL': {
        cancel()
        pushAnswer(composeConfirm({ kind: 'cancelled' }))
        break
      }
      case 'CONFIRM_MODIFY': {
        pushAnswer(applyModify(classified, trimmed))
        break
      }
      case 'QUERY_PAIRWISE': {
        if (classified.memberId === null) {
          // Nothing to answer with (spec §2.6 — a no-name pairwise question
          // is unanswerable), so this is functionally a GUIDED reply too —
          // reuses the SAME chip-wired builder `UNKNOWN` does (review I4)
          // rather than the plain, non-interactive `composeAnswer` path.
          pushGuidedAnswer(['HELP'], false, trimmed)
          break
        }
        const net = BigInt(
          assistantData.pairwiseNet[classified.memberId] ?? '0',
        )
        pushAnswer(
          composePairwise({
            net,
            name: nameOf(classified.memberId),
            currency: assistantData.currency,
          }),
        )
        break
      }
      case 'EDIT_EXPENSE': {
        // A context command against an already-SAVED expense ("아까 그 술값에
        // 민수도 껴줘"). Task 9 read the sentence; this resolves WHICH expense
        // it points at and opens the confirm or disambiguation card. It never
        // applies anything on its own — see `openEditCard`.
        //
        // (Task 9 left a placeholder here that routed the sentence to the
        // GUIDED/HELP reply, described in its report as changing nothing the
        // user sees. That claim was withdrawn in the same report's fix round —
        // it DID change the reply for these sentences — and both the
        // placeholder and its comment are now gone.)
        openEditCard(classified.reference, classified.action)
        break
      }
      case 'UNKNOWN': {
        // 2026-08-14 (owner screenshot 3): while the items card still has
        // unpriced lines, a message the classifier couldn't bind answers
        // with WHAT is missing and a copyable example — never the generic
        // "카드가 아직 열려 있어요" that told the user nothing.
        if (outcome?.kind === 'confirmItems') {
          const unpriced = chatItems.filter((item) => item.unitAmount === null)
          if (unpriced.length > 0) {
            pushAnswer(composeItemsPriceAsk(unpriced.map((i) => i.name)))
            break
          }
        }
        // R6 — the fallback interpreter behind the seam, consulted ONLY
        // when the rules came up empty (this branch) and no card is open.
        // Its result never saves anything: a grounded expense reading
        // PREFILLS the ordinary confirm card (G3), everything else falls
        // through to the guided reply exactly as before. The interpreter
        // itself is config-gated server-side (no GEMINI_API_KEY → Null →
        // 'unavailable' → guided), so this call is safe to make always.
        const suggest = classified.suggest
        const hold = classified.hold
        const topic = classified.topic
        void (async () => {
          const guided = () => {
            const hit = findMembers(trimmed, members)[0]
            pushGuidedAnswer(
              suggest,
              hold,
              trimmed,
              hit ? nameOf(hit.id) : undefined,
              topic,
            )
          }
          if (hold || outcome !== null) {
            guided()
            return
          }
          try {
            const res = await interpretUtterance(groupId, effective, {
              salientNames: dialogueMemory.current.salience.entities
                .filter((e) => e.kind === 'person')
                .map((e) => e.label)
                .slice(0, 5),
              locale,
              defaultCurrency,
            })
            if (!res.ok || res.draft.amount === null) {
              guided()
              return
            }
            const draft = res.draft
            const everyone = members.map((m) => m.id)
            const named = [...new Set([actorId, ...draft.participantIds])]
            const parsed: ParsedExpense = {
              amount: draft.amount,
              currency: draft.currency,
              payerId: draft.payerId ?? actorId,
              participantIds:
                draft.participantIds.length > 0
                  ? everyone.filter((id) => named.includes(id))
                  : everyone,
              description: draft.description ?? '',
              funding: 'PAY_AS_YOU_GO',
              missing: [],
              amountMentions: 1,
            }
            openExpenseCard(parsed, effective)
          } catch {
            guided()
          }
        })()
        break
      }
      case 'SMALL_TALK': {
        pushAnswer(composeSmallTalk(classified.act))
        break
      }
      case 'QUERY_EXPLAIN': {
        void (async () => {
          const result = await fetchMyShareBreakdown(groupId)
          if ('error' in result) {
            pushGuidedAnswer([], false, trimmed)
            return
          }
          pushAnswer(
            composeExplain({
              rows: result.rows.map((r) => ({
                title: r.title,
                share: BigInt(r.shareMinor),
                currency: r.currency,
                evenAmong: r.evenAmong,
                items: r.items,
              })),
            }),
          )
        })()
        break
      }
      case 'QUERY_HISTORY': {
        // Filterless stays the synchronous recent-slice answer; a filtered
        // question ("수탉이랑 먹은 거 다") queries the FULL ledger
        // server-side, paged via the load-more chip.
        if (Object.keys(classified.filters).length === 0) {
          pushAnswer(composeAnswer(classified))
        } else {
          void runFilteredHistory(classified.filters, 0)
        }
        openDesktopPanel({
          kind: 'history',
          scope: classified.scope === 'mine' ? 'mine' : 'all',
          filters: {
            ...toListFilters(classified.filters),
            // "내 사용내역": the ledger's own payer filter, so the panel and
            // the bubble agree on what "mine" means.
            ...(classified.scope === 'mine' ? { payerId: actorId } : {}),
          },
        })
        break
      }
      case 'QUERY_MY_SPENDING': {
        pushAnswer(composeAnswer(classified))
        openDesktopPanel({ kind: 'mySpending' })
        break
      }
      case 'ACTION_CREATE_WALLET': {
        openWalletCard({
          currency: classified.currency,
          walletType: classified.walletType,
        })
        break
      }
      default:
        pushAnswer(composeAnswer(classified))
    }
  }

  const toggleParticipants = (next: string[]) => {
    // The group must always be split between at least one person, so an
    // empty result from untoggling the last pill is refused, not applied.
    if (next.length > 0) {
      setParticipantIds(next)
    }
  }

  const clientAction = async (
    previous: ChatFormState,
    formData: FormData,
  ): Promise<ChatFormState> => {
    if (outcome?.kind !== 'confirm' && outcome?.kind !== 'confirmItems') {
      return previous
    }
    const submissionId = outcome.submissionId
    const isItems = outcome.kind === 'confirmItems'
    // A2 (not the parser's `funding` field, which stays as Task 1-3
    // specced it — only this payload changed): the REAL parsed currency,
    // which may differ from `defaultCurrency` (a foreign mention) or from
    // the group's settlement currency (a trip-currency expense, A1). It is
    // never hardcoded to `defaultCurrency` any more — that silently priced
    // a USD "$50" mention as if it were the group's own currency. For the
    // items card this is `itemsCurrency` — the SAME `ParsedItemList.currency`
    // `chatItems` was built from (binding contract, `toChatItems`'s doc
    // comment) — never `defaultCurrency` either.
    const currency = isItems ? outcome.itemsCurrency : outcome.parsed.currency
    // An unpriced line cannot be summed or saved — the Save button is
    // disabled while one exists (`unpricedCount` on the card payload), so
    // this is the belt-and-braces server-action guard, not the primary UX.
    if (
      isItems &&
      chatItems.some(
        (item) =>
          item.unitAmount === null ||
          parseAmountToMinor(item.unitAmount, currency) === null,
      )
    ) {
      return { error: t('items.priceMissingError'), submissionId }
    }
    // Task 3: the items card has no single parsed `amount` — the payload's
    // `amount` is the grand total of the current line state, Σ `lineTotal`
    // (`itemsGrandTotal`, `@/lib/chat-items-state`), the SAME formula
    // `ChatAssignCard`'s own on-screen total uses, converted back to a
    // decimal string at this currency's exponent (`minorToDecimalInput`) —
    // never re-typed or re-derived a second way, so the receipt total the
    // user saw on the card is exactly what gets saved.
    const amount = isItems
      ? minorToDecimalInput(itemsGrandTotal(chatItems, currency), currency)
      : outcome.amount
    // Task 3: replaces the old hardcoded `items: []` — one `ExpenseItemSchema`
    // row per `ChatItemState` line. `splitMode` is omitted (server defaults
    // to BY_QUANTITY) UNLESS the card actually switched a line to BY_AMOUNT
    // (an "Everyone" tap that didn't divide evenly, `assignEveryone`) — never
    // set it to BY_QUANTITY explicitly, matching the wizard's own payload
    // shape. `assignees` carries memberId+quantity only (no amount — the
    // schema doesn't accept one); an EMPTY assignees array is legal (the
    // engine's proportional rule handles it), so a line nobody ticked is
    // sent as-is, not dropped or defaulted to "everyone."
    const items = isItems
      ? chatItems.map((item) => ({
          name: item.name,
          // Non-null past the guard above; '' can never occur, it just keeps
          // the map total without a non-null assertion.
          unitAmount: item.unitAmount ?? '',
          quantity: item.quantity,
          ...(item.splitMode === 'BY_AMOUNT'
            ? { splitMode: 'BY_AMOUNT' as const }
            : {}),
          assignees: item.assignees.map((a) => ({
            memberId: a.memberId,
            quantity: a.quantity,
          })),
        }))
      : []
    const payload = {
      amount,
      currency,
      payerId,
      // A2: whichever pot the funding-source section on the card has
      // selected — 'PAY_AS_YOU_GO' (the safe default, and the ONLY option
      // when the section isn't shown at all, i.e. a same-currency expense)
      // or one of the payer's own wallets in this currency. Never
      // NEW_CASH_WALLET (which would silently create a settlement-currency
      // cash wallet, which every other screen deliberately refuses to
      // offer) and never split funding / a manual rate override — those
      // stay the wizard's job (`openFormHref` below is always available as
      // an escape for them). `saveExpense` resolves the rate either way: a
      // wallet portion prices at that wallet's own average cost, and
      // PAY_AS_YOU_GO resolves a market rate via `getSnapshotRate` for the
      // expense's timestamp. Same for the items card — its funding section
      // is the SAME UI, driven by the SAME `fundingChoice` state.
      fundingSource:
        fundingChoice === 'PAY_AS_YOU_GO'
          ? { kind: 'PAY_AS_YOU_GO' as const }
          : { kind: 'WALLET' as const, walletId: fundingChoice },
      extraFunding: [],
      timestampIso: new Date().toISOString(),
      note: description.trim() || undefined,
      isPersonal: false,
      participantIds,
      items,
      // Task 2: the successful scan's uploaded photo, riding on `outcome`
      // itself (see the `Outcome` doc comment) — `null` for the ordinary
      // text flow, exactly like before this card could ever come from a
      // scan. `saveExpense` already treats `null` and "key absent" the same
      // way (`payload.receiptImagePath ?? null`, expenses/actions.ts), so
      // sending it explicitly here never regresses the text-only path.
      receiptImagePath: outcome.receiptImagePath,
      force,
    }
    formData.set('groupId', groupId)
    formData.set('payload', JSON.stringify(payload))
    // Opt into the stay-on-page success path (docs/SOLVED.md 2026-08-01,
    // 2026-08-03): the wizard's own submits never set this and keep
    // redirecting exactly as before.
    formData.set('stay', '1')
    const next = await saveExpense(previous, formData)
    if (next.success) {
      // Task 10: the expense just saved becomes referenceable IMMEDIATELY —
      // "아까 그 술값에 유나도 껴줘" is typically said seconds after entering it,
      // and the `recentExpenses` prop only carries it once the
      // `router.refresh()` below actually commits, which this Next version's
      // client intermittently drops (docs/SOLVED.md 2026-08-09). Built from
      // the payload this action just sent plus the id the server returned —
      // the same values that were written, not a second guess at them.
      const savedId = next.success.id
      const savedMinor = parseAmountToMinor(amount, currency)
      setEditedExpenses((current) => ({
        ...current,
        [savedId]: {
          id: savedId,
          // The SAME fallback the server derives `title` from — an items card
          // usually carries no note, and the first item's name becomes the
          // title (`savedExpenseNote`). Mirroring only the note left an items
          // expense blank here for the whole session: unmatchable by keyword
          // and empty in the disambiguation list.
          note: savedExpenseNote(payload.note, payload.items),
          amountMinor: (savedMinor ?? 0n).toString(),
          currency,
          timestampIso: payload.timestampIso,
          participantIds,
          payerId,
          cancelled: false,
          itemCount: payload.items.length,
        },
      }))
      // The refresh itself moved to the `useEffect` below — dispatching it
      // here, inside the still-pending useActionState transition, is what
      // intermittently lost the re-render (docs/SOLVED.md 2026-08-09).
      // The local "clear the card" reset is scoped to whichever card THIS
      // save attempt belongs to, though. `submissionCounter.current` only
      // advances when a NEW card opens (`openConfirm`), so this stays true
      // in the ordinary case — submit, wait, land — and is false only once
      // the user has genuinely opened another card since.
      if (submissionId === submissionCounter.current) {
        cancel()
      }
    }
    // Stamped with the card this attempt belongs to, so a stale duplicate/
    // error from a card the user has since cancelled or replaced can never
    // render against a different one (see `resultIsCurrent` below).
    return { ...next, submissionId }
  }

  const [result, formAction, isSaving] = useActionState<
    ChatFormState,
    FormData
  >(clientAction, {})
  // Post-save follow-up, AFTER the action's own state has committed:
  //
  //  1. Push the returned feed row as a `saved` transcript message —
  //     rendered IMMEDIATELY and unconditionally from the action's own
  //     result, never from the refresh below (docs/SOLVED.md 2026-08-09).
  //     THIS is the "saved" confirmation the user is watching for, whether
  //     it was triggered by tapping Save or by a chat CONFIRM_YES.
  //  2. Then refresh anyway, for everything else this route's server data
  //     backs.
  useEffect(() => {
    if (result.success) {
      const feedRow = result.success.feedRow
      pushMessage({
        id: `saved-${result.success.id}`,
        role: 'assistant',
        kind: 'saved',
        title: feedRow ? feedRow.title : null,
        receiptTotal: feedRow ? feedRow.receiptTotal : null,
        groupId,
      })
      router.refresh()
    }
    // `groupId` is a stable prop, listed for completeness. `pushMessage` is
    // stable (useCallback in the provider). Deliberately NOT keyed on
    // anything from `t`/translations: their identity changes every render
    // (next-intl) but the strings they return do not, and this bubble reads
    // its copy inside `transcript-render.tsx`, not here.
  }, [result, router, pushMessage, groupId])
  // Guards `result.duplicate` / `result.error`: true only while the
  // currently-open confirm/confirmItems card is the same one that produced
  // `result`.
  const resultIsCurrent =
    (outcome?.kind === 'confirm' || outcome?.kind === 'confirmItems') &&
    result.submissionId === outcome.submissionId

  // The composer's ONE live outcome bubble — multiAmount, askAmount,
  // confirmItems or confirm, whichever `outcome` currently holds, packaged
  // as DATA (spec §5.5(a)) for `transcript-render.tsx` to draw.
  let card: CardPayload | null = null
  if (outcome?.kind === 'multiAmount') {
    card = {
      kind: 'multiAmount',
      // Deliberately no `amount` prefill (empty string, which
      // `resolvePrefill`/`parseAmountToMinor` drops rather than treating as
      // an amount) — the whole point of this card is that no single number
      // here is trustworthy. `description`/`currency` still carry over,
      // same as any other handoff.
      openFormHref: draftFormHref(
        groupId,
        '',
        outcome.parsed.description,
        outcome.parsed.currency,
      ),
      onCancel: cancel,
    }
  } else if (outcome?.kind === 'disambiguate') {
    card = {
      kind: 'disambiguate',
      found: outcome.found,
      candidates: outcome.candidates.map((candidate) => ({
        id: candidate.id,
        note: candidate.note,
        amountMinor: candidate.amountMinor,
        currency: candidate.currency,
        timestamp: candidate.timestamp,
      })),
      tzOffsetMinutes: outcome.tzOffsetMinutes,
      // "None of these" has to lead somewhere — the full history is where the
      // expense the user meant actually is, and it is one tap from editing it.
      historyHref: `/groups/${groupId}/history`,
      onPick: pickEditCandidate,
      onCancel: cancel,
    }
  } else if (outcome?.kind === 'confirmEdit') {
    // The TARGET is passed here (and only here): with it, an amount change
    // naming another currency becomes the swap ask that names both sides
    // (F-T4). `openEditCard`'s own call has no target yet and asks only
    // whether the amount is representable at all.
    const ask = editAskOf(outcome.action, nameOf, {
      amountMinor: outcome.expense.amountMinor,
      currency: outcome.expense.currency,
    })
    // `null` only for an amount this app cannot represent, which `openEditCard`
    // already refuses before ever setting this outcome — guarded rather than
    // asserted, so this stays total.
    if (ask !== null) {
      const blockedKey = editBlockedKey(outcome.action, {
        currency: outcome.expense.currency,
        itemCount: itemCountOf(outcome.expense.id),
      })
      card = {
        kind: 'confirmEdit',
        ask,
        target: {
          id: outcome.expense.id,
          note: outcome.expense.note,
          amountMinor: outcome.expense.amountMinor,
          currency: outcome.expense.currency,
          timestamp: outcome.expense.timestamp,
        },
        tzOffsetMinutes: outcome.tzOffsetMinutes,
        blockedKey,
        // An escape ONLY where one genuinely exists. The full form really can
        // edit an itemised expense (items, assignments and participants as one
        // thing) — it CANNOT change an expense's currency, so offering it
        // there would just move the dead end one tap further away. The
        // currency copy tells the user what to do instead.
        editHref:
          blockedKey === 'chat.edit.tooComplex'
            ? `/groups/${groupId}/expenses/${outcome.expense.id}/edit`
            : null,
        pending: editPending,
        onConfirm: () => {
          void runEdit(outcome.action, outcome.expense)
        },
        onCancel: cancel,
      }
    }
  } else if (outcome?.kind === 'walletCreate') {
    const walletOutcome = outcome
    card = {
      kind: 'walletCreate',
      currency: walletOutcome.currency,
      walletType: walletOutcome.walletType,
      label: walletOutcome.label,
      // The chat's own currency first (a trip group is most likely creating
      // the trip-currency wallet), then the settlement currency, then the
      // majors — deduped, capped, and always including an already-chosen
      // currency so the selected chip can never vanish.
      currencyOptions: [
        ...new Set(
          [
            walletOutcome.currency,
            defaultCurrency,
            assistantData.currency,
            'JPY',
            'USD',
            'EUR',
            'KRW',
          ].filter((c): c is string => c !== null),
        ),
      ].slice(0, 6),
      error: walletOutcome.error,
      saving: walletOutcome.saving,
      onCurrencyChange: (code) =>
        setOutcome(
          walletOutcome.saving ? walletOutcome : { ...walletOutcome, currency: code, error: null },
        ),
      onTypeChange: (walletType) =>
        setOutcome(walletOutcome.saving ? walletOutcome : { ...walletOutcome, walletType }),
      onLabelChange: (label) =>
        setOutcome(walletOutcome.saving ? walletOutcome : { ...walletOutcome, label }),
      onCreate: submitWalletCreate,
      onCancel: cancel,
    }
  } else if (outcome?.kind === 'askAmount') {
    card = {
      kind: 'askAmount',
      value: askAmountText,
      invalid: askAmountInvalid,
      onChange: (value) => {
        setAskAmountText(value)
        if (askAmountInvalid) setAskAmountInvalid(false)
      },
      onSubmit: submitAskAmount,
      onCancel: cancel,
    }
  } else if (outcome?.kind === 'confirm') {
    // A2: this card's OWN currency, not `defaultCurrency` — the two only
    // coincide for a same-currency (or trip-currency) expense. Showing the
    // amount, the escape link's prefill, and the funding section all key off
    // this, never the chat's default.
    const cardCurrency = outcome.parsed.currency
    // The funding section is worth asking about whenever there is a real
    // conversion to settle — i.e. whenever this currency differs from the
    // group's settlement currency, not just when it differs from the chat's
    // default (a trip-currency expense gets the same question now: it was
    // always converting, A1 just stopped it from dead-ending first).
    const showFunding = cardCurrency !== assistantData.currency
    // Wallet options only exist when the CURRENT client knows the payer's
    // wallets, which `assistantData` scopes to the actor alone (spec §1,
    // QUERY_WALLET's own scope) — a payer switched away from the actor
    // simply offers no wallet chips, falling back to the safe
    // PAY_AS_YOU_GO default, not an error.
    const fundingWallets =
      payerId === actorId
        ? assistantData.wallets
            .filter((wallet) => wallet.currency === cardCurrency)
            .map((wallet) => ({ id: wallet.walletId, label: wallet.label }))
        : []
    card = {
      kind: 'confirm',
      amountMinor: outcome.amountMinor,
      currency: cardCurrency,
      description,
      onDescriptionChange: setDescription,
      members,
      actorId,
      payerId,
      onPayerChange: (id) => {
        setPayerId(id)
        setFundingChoice('PAY_AS_YOU_GO')
      },
      participantIds,
      onParticipantsChange: toggleParticipants,
      perPersonAmount: previewPerPerson(
        outcome.amountMinor,
        participantIds.length,
      ),
      funding: {
        show: showFunding,
        choice: fundingChoice,
        onChoiceChange: setFundingChoice,
        wallets: fundingWallets,
      },
      duplicate: resultIsCurrent && Boolean(result.duplicate),
      error: resultIsCurrent && result.error ? result.error : null,
      formAction,
      onSaveAnyway: () => setForce(true),
      openFormHref: draftFormHref(
        groupId,
        minorToDecimalInput(outcome.amountMinor, cardCurrency),
        description,
        cardCurrency,
      ),
      groupId,
      onCancel: cancel,
      // Task 2: a receipt scan that landed here via `totalOnly` (no items,
      // or items that didn't reconcile) carries its one-line reason —
      // `undefined` for the ordinary text-parsed card, so `OutcomeCard`'s
      // `card.notice !== undefined` check skips the banner entirely rather
      // than rendering an empty one.
      ...(outcome.notice !== null ? { notice: outcome.notice } : {}),
    }
  } else if (outcome?.kind === 'confirmItems') {
    // Same reasoning as the `confirm` branch above, keyed off the items
    // card's OWN currency (`itemsCurrency`, never `defaultCurrency`).
    const cardCurrency = outcome.itemsCurrency
    const showFunding = cardCurrency !== assistantData.currency
    const fundingWallets =
      payerId === actorId
        ? assistantData.wallets
            .filter((wallet) => wallet.currency === cardCurrency)
            .map((wallet) => ({ id: wallet.walletId, label: wallet.label }))
        : []
    const grandTotalMinor = itemsGrandTotal(chatItems, cardCurrency)
    card = {
      kind: 'confirmItems',
      items: chatItems,
      onItemsChange: setChatItems,
      unpricedCount: chatItems.filter((item) => item.unitAmount === null).length,
      currency: cardCurrency,
      description,
      onDescriptionChange: setDescription,
      members,
      actorId,
      payerId,
      onPayerChange: (id) => {
        setPayerId(id)
        setFundingChoice('PAY_AS_YOU_GO')
      },
      participantIds,
      onParticipantsChange: toggleParticipants,
      funding: {
        show: showFunding,
        choice: fundingChoice,
        onChoiceChange: setFundingChoice,
        wallets: fundingWallets,
      },
      duplicate: resultIsCurrent && Boolean(result.duplicate),
      error: resultIsCurrent && result.error ? result.error : null,
      formAction,
      onSaveAnyway: () => setForce(true),
      // Grand total, not a single parsed amount — the items card's escape
      // hatch to the full form still needs SOME amount prefill, and the
      // current running total (recomputed from `chatItems`, same as the
      // save payload) is the honest one, not the sentence's first number.
      openFormHref: draftFormHref(
        groupId,
        minorToDecimalInput(grandTotalMinor, cardCurrency),
        description,
        cardCurrency,
      ),
      groupId,
      onCancel: cancel,
    }
  }

  // Keeps the transcript's one live outcome bubble in sync with the card
  // just computed above. A real dependency array is NOT optional here (this
  // was tried first and reverted, docs/SOLVED.md): an effect with no array
  // would call `upsertMessage` on every render, which changes
  // `ChatTranscriptProvider`'s state, which re-renders this sibling
  // component, which runs the effect again — an infinite loop. Listing the
  // primitive state that actually feeds `card` means the effect only
  // re-fires when one of THOSE changes.
  useEffect(() => {
    if (card === null) {
      removeMessage(OUTCOME_MESSAGE_ID)
    } else {
      upsertMessage({
        id: OUTCOME_MESSAGE_ID,
        role: 'assistant',
        kind: 'card',
        card,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    outcome,
    chatItems,
    description,
    payerId,
    participantIds,
    askAmountText,
    askAmountInvalid,
    force,
    fundingChoice,
    // Task 10: the edit cards' only mutable field — without it the confirm
    // button would never re-render into its disabled state while the action
    // is in flight.
    editPending,
    result,
    upsertMessage,
    removeMessage,
  ])

  return (
    // The composer is the screen's anchor (owner's law): a 24px "panel"
    // frame with the measured `raised` elevation, standing in for the
    // teardown's 3-layer glass stack without the glow/blur layers (those
    // are Task 6's Backdrop scope, not this file's). PITCH_TEARDOWN.md
    // ## Chat-surface mapping › "Composer field": focus treatment is the
    // frame's own border swapping to `--ring` at `--dur-fast`, the
    // measured pairing for "press feedback, colour swaps, focus rings".
    <form
      className="flex items-center gap-2 rounded-2xl border border-border bg-card p-2 shadow-[0_20px_60px_-20px_rgb(from_var(--primary)_r_g_b_/_0.18)] transition-colors duration-fast focus-within:border-ring dark:shadow-none"
      data-testid="chat-composer"
      onSubmit={(event) => {
        event.preventDefault()
        submitSentence(text)
      }}
    >
      {/* Task 2 (chat-image-c): attach a receipt photo. Deliberately NO
          `capture` attribute (owner decision 2026-08-13): with it, phones
          jump straight into the rear camera; without it, the OS offers the
          camera/gallery chooser — and a receipt often already sits in the
          gallery as a photo taken earlier. (The wizard's ReceiptScan input
          keeps `capture` — its button is explicitly "scan", not "attach".)
          Cleared after every pick (not just a successful one) so choosing
          the same photo twice in a row still fires a change event. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        data-testid="chat-attach-input"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handleAttach(file)
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="size-11 shrink-0 rounded-full"
        data-testid="chat-attach"
        aria-label={t('attach')}
        disabled={scanning || isSaving}
        onClick={() => fileInputRef.current?.click()}
      >
        <Paperclip className="size-5" aria-hidden="true" />
      </Button>
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('placeholder')}
        className="h-11 flex-1 rounded-sm border-transparent bg-transparent px-3 shadow-none"
        data-testid="chat-input"
      />
      {/* The owner explicitly hated "추가"/"Add" here — it read as "tap to
          add nothing". A send affordance (paper-plane icon, matching the
          reference-app design) replaces it; `chat.send` still supplies the
          accessible name via i18n, now "Send"/"보내기" instead of "Add"/
          "추가". The former "4px rectilinear exception" (## Radii & borders
          row 9) is retired per the owner's phone review: this button is now
          fully round, matching the curvature of the composer frame it sits
          inside — not a separate visual language. */}
      <Button
        type="submit"
        size="icon"
        className="size-11 shrink-0 rounded-full"
        data-testid="chat-send"
        aria-label={t('send')}
      >
        <Send className="size-5" aria-hidden="true" />
      </Button>
    </form>
  )
}
