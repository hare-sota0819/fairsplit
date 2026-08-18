'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ChatItemState } from '@/lib/chat-items-state'
import {
  CHAT_HISTORY_CAP,
  fromPersistable,
  toPersistable,
  type PersistableMessage,
} from '@/lib/chat-history'
import {
  appendChatMessages,
  fetchChatHistory,
  type ChatHistoryCursor,
} from './chat-history-actions'
import {
  createPersistTracker,
  mirrorPersistTracker,
  scopeClientMessageId,
  type PersistStatus,
} from './persist-status'
import {
  markPersistExplainerSeen,
  resolveExplainerStorage,
  shouldShowPersistExplainer,
} from './persist-explainer'
import { TranscriptBubble } from './transcript-render'
import { SemMark } from '@/components/sem/SemMark'
import { useSidebar } from '@/components/sidebar/SidebarProvider'

/**
 * One line of an assistant reply (`AssistantAnswer['lines']`, spec §5.4),
 * widened with an optional tap handler or link. `onSelect` is present ONLY
 * on a GUIDED suggestion-chip line (its `key` is one of
 * `assistant.guided.option.*`) — `ChatComposer` attaches it when building
 * the message. `href` is present ONLY on the GUIDED `escape` line (review
 * I1): "write it in the full form" is a real navigation, not a resubmit, so
 * it renders as a link to `/expenses/new` (current text carried as
 * `draftNote`) instead of plain text. Every other line (ack/hold, and every
 * non-guided composer's plain lines) carries neither, so
 * `transcript-render.tsx` renders it as plain text.
 */
export interface AnswerLine {
  key: string
  values?: Record<string, string | number>
  onSelect?: () => void
  href?: string
}

/**
 * The composer's ONE live outcome card, as DATA — one variant per
 * `Outcome['kind']` in `ChatComposer.tsx`. `transcript-render.tsx` owns the
 * markup; this only carries the values and callbacks that markup needs.
 *
 * A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차") removed the dedicated
 * `crossCurrency` variant: a foreign-currency parse is an ordinary `confirm`
 * card now (carrying its OWN `currency`, not always the chat default), with
 * an inline `funding` section shown whenever that currency differs from the
 * group's settlement currency.
 *
 * `multiAmount` is a NEW variant, same day, review follow-up: a multi-item
 * sentence ("13000원 김치찌개 3개, 7000원 콜라 2개, 400000원 와규 2개") must
 * never resolve to a confident single-amount `confirm` card built from the
 * lone FIRST number found — this is its replacement, a notice + the same
 * wizard escape link every other card carries, never a dead end.
 *
 * `confirmItems` is a Task 3 variant (docs/handoff/B-multi-item-chat.md): a
 * `multiAmount`-triggering sentence `parseItems` can actually parse resolves
 * here instead — the wizard's "who had what" screen (`ChatAssignCard`)
 * inlined as a chat card, plus the same description/payer/funding/
 * participants context the `confirm` card offers (so a payer/funding edit
 * before saving multiple items works exactly the same way it does for a
 * single-amount one). `currency` is the SENTENCE's own resolved currency
 * (`ParsedItemList.currency`), never `defaultCurrency` — see the binding
 * contract on `ChatAssignCard`'s own `currency` prop.
 */
/** One expense as a card row describes it — the target of a confirmed edit, or
 *  one line of a disambiguation list. Money stays integer minor units and the
 *  instant stays a `Date`: this never crosses the server → client boundary
 *  (`ChatComposer` builds it in an event handler), and `transcript-render.tsx`
 *  is what formats both, like every other card payload. */
export interface EditTargetView {
  id: string
  note: string
  amountMinor: bigint
  currency: string
  timestamp: Date
}

/** What a `confirmEdit` card is asking to do — mirrors `EditAsk`
 *  (`chat-composer-logic.ts`), which is where it is built. */
export type EditAskView =
  | { kind: 'add'; name: string }
  | { kind: 'remove'; name: string }
  | { kind: 'amount'; amountMinor: bigint; currency: string }
  | {
      kind: 'currencySwap'
      fromMinor: bigint
      fromCurrency: string
      toMinor: bigint
      toCurrency: string
    }
  | { kind: 'cancel' }

export type CardPayload =
  | {
      kind: 'multiAmount'
      openFormHref: string
      onCancel: () => void
    }
  /**
   * Task 10 (goat-parser, context commands): the two cards an EDIT_EXPENSE
   * sentence can open against an already-SAVED expense.
   *
   * `confirmEdit` is the single-match case — it names the TARGET in full
   * (note, amount, when) above the question, because the whole ask-first
   * design rests on the user being able to see WHICH expense is about to
   * change before they agree to it. `blockedKey` is set when the edit cannot
   * be applied as asked — a currency change (which no screen in this app can
   * do), or any non-cancel edit to an ITEMISED expense (whose shares come from
   * its item assignments, not from the fields chat would change). The card
   * then shows that reason INSTEAD of a confirm button, rather than letting
   * the user tap into a refusal, with `editHref` beside it only when somewhere
   * in the app can actually make that edit.
   *
   * `disambiguate` is both of `resolveReference`'s non-single outcomes:
   * `found` true means these matched the reference ("which one?"), false means
   * nothing did and these are simply the newest few ("couldn't find it — is it
   * one of these?"). Picking a row opens the `confirmEdit` card for it; no row
   * ever applies an edit directly.
   *
   * Neither is exposed to `classify()` as an `OpenCard` — same ruling as
   * `multiAmount`/`confirmItems` (see `ChatComposer`'s `openCard` memo).
   */
  | {
      kind: 'confirmEdit'
      ask: EditAskView
      target: EditTargetView
      /** `Date#getTimezoneOffset()` convention, captured when the card opened
       *  — the DEVICE's offset, never the server's (the Phase 3C bug). */
      tzOffsetMinutes: number
      blockedKey: string | null
      /** Where a blocked edit CAN be made, when such a place exists (the full
       *  form, for an itemised expense) — `null` when it does not, which is
       *  the case for a currency change: no screen in this app can do that,
       *  and offering one would just move the dead end. */
      editHref: string | null
      pending: boolean
      onConfirm: () => void
      onCancel: () => void
    }
  | {
      kind: 'disambiguate'
      found: boolean
      candidates: EditTargetView[]
      tzOffsetMinutes: number
      historyHref: string
      onPick: (id: string) => void
      onCancel: () => void
    }
  | {
      kind: 'askAmount'
      value: string
      invalid: boolean
      onChange: (value: string) => void
      onSubmit: () => void
      onCancel: () => void
    }
  | {
      kind: 'walletCreate'
      currency: string | null
      walletType: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID' | null
      label: string
      currencyOptions: string[]
      error: string | null
      saving: boolean
      onCurrencyChange: (code: string) => void
      onTypeChange: (walletType: 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID') => void
      onLabelChange: (label: string) => void
      onCreate: () => void
      onCancel: () => void
    }
  | {
      kind: 'confirmItems'
      items: ChatItemState[]
      onItemsChange: (items: ChatItemState[]) => void
      /** Lines still missing a price — Save stays disabled until zero. */
      unpricedCount: number
      currency: string
      description: string
      onDescriptionChange: (value: string) => void
      members: { id: string; name: string }[]
      actorId: string
      payerId: string
      onPayerChange: (id: string) => void
      participantIds: string[]
      onParticipantsChange: (ids: string[]) => void
      funding: {
        show: boolean
        choice: string
        onChoiceChange: (choice: string) => void
        wallets: { id: string; label: string }[]
      }
      duplicate: boolean
      error: string | null
      formAction: (formData: FormData) => void
      onSaveAnyway: () => void
      openFormHref: string
      groupId: string
      onCancel: () => void
    }
  | {
      kind: 'confirm'
      amountMinor: bigint
      currency: string
      description: string
      onDescriptionChange: (value: string) => void
      members: { id: string; name: string }[]
      actorId: string
      payerId: string
      onPayerChange: (id: string) => void
      participantIds: string[]
      onParticipantsChange: (ids: string[]) => void
      perPersonAmount: bigint
      /**
       * "Where did this money come from" — asked only when `card.currency`
       * differs from the group's settlement currency (mirrors the wizard's
       * StepPayment, simplified to a single primary source: no split
       * funding, no till top-up, no manual rate override here — those stay
       * the wizard's job, reachable via `openFormHref` below).
       */
      funding: {
        show: boolean
        /** 'PAY_AS_YOU_GO' or a wallet id. */
        choice: string
        onChoiceChange: (choice: string) => void
        /** The payer's wallets in THIS currency — empty is normal (most
         *  payers have none, or the current payer isn't the one whose
         *  wallets this client knows about), not an error state. */
        wallets: { id: string; label: string }[]
      }
      duplicate: boolean
      error: string | null
      formAction: (formData: FormData) => void
      onSaveAnyway: () => void
      openFormHref: string
      groupId: string
      onCancel: () => void
      /**
       * Task 2 (chat-image-c): a one-line reason banner shown when this
       * card came from a receipt scan whose total could not be fully
       * reconciled — `chat.scan.totalOnlyNotice` (no items on the receipt)
       * or `chat.scan.sumMismatchNotice` (items didn't add up to the
       * printed total). `null` for the ordinary text-parsed confirm card
       * (the overwhelmingly common case) and for a clean scan.
       */
      notice?: string
    }

/**
 * One transcript bubble, as DATA — spec §5.5(a). Replaces the old
 * `{ id, role, body: ReactNode }` shape: every card ChatComposer used to
 * build as JSX inside an effect (and every JSX bubble ChatTranscript itself
 * pushed for the recalc banner) is now a plain value here, and
 * `transcript-render.tsx` is the ONLY place that turns one of these into
 * markup. This is what kills the hand-mirrored-effect-deps bug class
 * (docs/SOLVED.md 2026-08-10): a missed dependency can no longer render a
 * stale card, because there is no JSX sitting in state to go stale.
 *
 * Task 2 (chat-image-c) adds two more: `image` is the user's own bubble for
 * an attached receipt photo (`url` = an object URL created immediately from
 * the ORIGINAL file, like `ReceiptScan.tsx`; the composer revokes it when
 * replaced or unmounted), and `scanning` is a fixed-id assistant indicator
 * shown for the duration of one `/api/receipts/parse` call — never left
 * behind on any exit path (success, every failure code, or a thrown
 * client-side resize).
 */
export type TranscriptMessage =
  | { id: string; role: 'user'; kind: 'text'; text: string }
  | {
      id: string
      role: 'user'
      kind: 'image'
      url: string
      text: string | null
      /** The uploaded receipt's storage path, once the scan finishes
       *  successfully — `null` until then (or forever, if the scan never
       *  uploaded). Persisted verbatim (`chat-history.ts`'s `toPersistable`)
       *  so a restored bubble can rebuild its `url` from the SAME path via
       *  `/api/receipts/image?path=...` (`fromPersistable`); a live bubble's
       *  own `url` is a blob URL regardless of this field. */
      imagePath: string | null
    }
  | {
      id: string
      role: 'assistant'
      kind: 'answer'
      lines: AnswerLine[]
      /** Overrides `AnswerBubble`'s default `chat-answer` testid — Task 2
       *  needs the receipt-scan refuse/error bubbles addressable on their
       *  own (`chat-scan-refused` / `chat-scan-error`), since more than one
       *  plain answer bubble can coexist in the transcript. */
      testId?: string
    }
  | { id: string; role: 'assistant'; kind: 'card'; card: CardPayload }
  | { id: string; role: 'assistant'; kind: 'scanning' }
  /** Task 2 (chat-indicator-currency): the ONE-TIME inline explanation of
   *  the pending-persist clock, shown the first time this transcript ever
   *  renders one (`persist-explainer.ts`'s localStorage gate). Never
   *  persisted — same "no persisted representation" treatment as
   *  `card`/`scanning`/`recalc` (`chat-history.ts`'s `toPersistable`). */
  | { id: string; role: 'assistant'; kind: 'persistExplainer' }
  | {
      id: string
      role: 'assistant'
      kind: 'saved'
      title: string | null
      receiptTotal: string | null
      groupId: string
    }
  | {
      id: string
      role: 'assistant'
      kind: 'recalc'
      groupId: string
      message: string
      dismissLabel: string
      action: (formData: FormData) => Promise<void>
    }

interface ChatTranscriptContextValue {
  /**
   * The reference-app-style conversation this transcript belongs to (R2b) — the
   * ChatSession row id. `null` for a NEW chat until its first persisted
   * batch lazily creates the row (the flush adopts the returned id and
   * updates the URL in place). Distinct from the per-mount persist token
   * below, which only scopes clientMessageId dedup.
   */
  chatSessionId: string | null
  /** Stash the dialogue memory to persist with the NEXT history batch —
   *  no dedicated network call (one write path, one failure surface). */
  persistMemory: (memory: unknown) => void
  messages: TranscriptMessage[]
  /** Append a new bubble. */
  pushMessage: (message: TranscriptMessage) => void
  /** Replace the bubble at this id in place, or append if none exists yet —
   *  used for the ONE "live" bubble (the composer's current outcome card)
   *  that keeps re-rendering as its own local state changes. */
  upsertMessage: (message: TranscriptMessage) => void
  /** Drop a bubble entirely (a dismissed banner, a cancelled card, or a
   *  superseded outcome card ahead of a fresh one appending — see
   *  `ChatComposer`'s supersede handling, spec §5.5(b)). */
  removeMessage: (id: string) => void
  /** Whether the page preloaded any restored history at all (Task 2) — a
   *  stable snapshot of the FIRST `initialMessages` this provider ever
   *  mounted with, not reactive to later pushes/removals. Gates the
   *  greeting empty-state: it must never come back once real history
   *  existed, even in the (currently theoretical) case `messages` empties
   *  out later. */
  hasPreloadedHistory: boolean
  /** Cursor for the next OLDER page (`fetchChatHistory`'s own type), or
   *  `null` once there is nothing older left to load. */
  nextCursor: ChatHistoryCursor | null
  /** True once this member's history has been trimmed down to the cap —
   *  drives the top-of-history retention notice once `nextCursor` is also
   *  `null` (nothing more to page through, but older rows did exist and got
   *  tidied up). */
  atCap: boolean
  /** True for the duration of one `fetchChatHistory` page load — disables
   *  the "load earlier" control so a second click can't race the first. */
  loadingEarlier: boolean
  /** Fetches and PREPENDS the next older page, using `nextCursor`. A no-op
   *  while already loading or once `nextCursor` is `null`. */
  loadEarlier: () => Promise<void>
  /** Per-message write-through persist status (Task 1: state only, no UI
   *  yet — Task 2 renders it). Keyed by `TranscriptMessage.id`; absent for
   *  ids never offered to the persist queue (`card`/`scanning`/`recalc`
   *  kinds, chip-only answers, and every restored `db-` id, which is already
   *  saved by definition). See `persist-status.ts`. */
  persistStatuses: ReadonlyMap<string, PersistStatus>
  /** Re-enqueues the failed batch `messageId` belongs to through the SAME
   *  queue path (`persist-status.ts`'s `retry`) — a no-op if that id isn't
   *  currently `'failed'`. */
  retryPersist: (messageId: string) => void
}

const ChatTranscriptContext = createContext<ChatTranscriptContextValue | null>(
  null,
)

/**
 * Owns the transcript's message list. Task 2 (chat-history): a reload no
 * longer starts empty — `page.tsx` preloads the newest page of this
 * member's PERSISTED history (private, per-member, capped at
 * `CHAT_HISTORY_CAP`, see `src/lib/chat-history.ts`) and hands it down as
 * `initialMessages`/`initialCursor`/`atCap`. `ChatComposer` is still the
 * only writer of LIVE bubbles (it "emits transcript events" instead of
 * rendering its cards inline), reached via `useChatTranscript` rather than
 * prop-drilling, since `page.tsx` (server) composes `ChatTranscript` and
 * `ChatComposer` as siblings.
 *
 * Write-through persistence: every `pushMessage`/`upsertMessage` call is
 * ALSO offered to `toPersistable` (returns `null` for the kinds the plan
 * says must never persist — `card`/`scanning`/`recalc`, and any answer whose
 * every line is a live chip) and, when persistable, queued for
 * `appendChatMessages`. Queuing rather than calling per-message keeps a
 * single user-sentence-plus-reply turn to one round trip: `pendingRef` is a
 * `Map` keyed by TranscriptMessage id (so a rapid push-then-upsert of the
 * SAME id, e.g. the image bubble gaining its `imagePath` right after being
 * pushed, collapses to one queued entry — last write wins), flushed on the
 * next microtask. `flushedIdsRef` remembers which ids have already made it
 * into an `appendChatMessages` call: a LATER upsert of an already-flushed id
 * (the imagePath-fill-in case, if the flush already fired before it
 * happens) is deliberately dropped rather than re-sent — perfect server-side
 * dedup is out of scope (see `ChatComposer`'s `handleAttach`), so that rare
 * case just keeps the OLD persisted payload; the live bubble on screen is
 * still correct; this is a plan-documented rare edge case, not a bug. Fire-
 * and-forget throughout (`void`, console-only on failure) — persistence must
 * never block the chat surface.
 *
 * Restored ('db-' prefixed id) messages are never re-queued: they arrive via
 * `initialMessages`/`loadEarlier`, which set state directly rather than
 * going through `pushMessage`/`upsertMessage`, but `queuePersist` also
 * checks the prefix directly as a second guard against ever sending a
 * restored row back to `appendChatMessages`.
 *
 * Persist status (Task 1, `persist-status.ts`): `flushBatch` is the ONE
 * place `appendChatMessages` is called — both the microtask flush above and
 * a later `retryPersist` funnel through it, so there is no second write
 * path. `persistTracker.enqueue`/`resolve`/`reject` mark a whole flushed
 * batch (the SAME ids array) pending/saved/failed together, matching the
 * queue's actual all-or-nothing batch shape (one `appendChatMessages` call
 * either resolves or rejects for every id in it — there is no per-message
 * result). `persistedByIdRef` remembers each flushed id's `PersistableMessage`
 * payload so `retryPersist` can resend the EXACT batch that failed without
 * re-deriving it from (possibly since-changed) live message state, and
 * without re-running the `flushedIdsRef`/'db-' guards meant for the
 * original send. `persistStatuses` mirrors the tracker into React state via
 * `mirrorPersistTracker` for consumers (Task 2's UI).
 *
 * Double-persist fix (docs/SOLVED.md 2026-08-14 "Chat-indicator-currency T1
 * review round 1" — do not reintroduce): a "rejected" `appendChatMessages`
 * call does NOT mean the rows never landed — `createMany` + trim used to
 * run as two separate statements, and `ChatMessage` had no client-supplied
 * id, so a batch that committed server-side and then lost its response on
 * the way back (a dropped connection, a function timeout) was
 * indistinguishable from one that never landed at all. A naive retry
 * resent it and duplicated every row. The fix has TWO parts and both are
 * required together: `chat-history-actions.ts` now runs insert+trim in one
 * `$transaction` (closes the in-process partial-failure case), and every
 * persisted entry carries a `clientMessageId` that
 * `createMany({ skipDuplicates: true })` pairs with a
 * `(memberId, clientMessageId)` unique index (closes the lost-response-
 * after-commit case) — a retried batch that already landed inserts nothing
 * a second time and still resolves 'saved'. `clientMessageId` is the
 * message's own `TranscriptMessage.id` (`chat-history.ts`'s `toPersistable`
 * sets it), scoped by `persist-status.ts`'s `scopeClientMessageId(sessionId,
 * persistable)` before it leaves this file (review round 2: extracted so
 * `persist-flush.test.ts` exercises the REAL scoping, not a copy): the
 * `user-1`/`assistant-2` counters `ChatComposer.tsx` generates ids from
 * restart at 0 on every reload, so the bare id alone would let a brand-new
 * message from a LATER session collide with an unrelated one from an
 * EARLIER session that happened to reuse the same counter value.
 */
export function ChatTranscriptProvider({
  children,
  groupId,
  chatSessionId: initialChatSessionId = null,
  initialMessages = [],
  initialCursor = null,
  atCap: initialAtCap = false,
}: {
  children: ReactNode
  /** Needed to call `appendChatMessages`/`fetchChatHistory`. Omitted only by
   *  call sites that don't want persistence at all (there are none today —
   *  `page.tsx` always has a `groupId` — but every new prop here defaults
   *  safely rather than assuming one exists). */
  groupId?: string
  /** The active ChatSession row id; null = a NEW chat (lazy creation). */
  chatSessionId?: string | null
  initialMessages?: TranscriptMessage[]
  initialCursor?: ChatHistoryCursor | null
  atCap?: boolean
}) {
  const [messages, setMessages] = useState<TranscriptMessage[]>(initialMessages)
  const [chatSessionId, setChatSessionId] = useState<string | null>(
    initialChatSessionId,
  )
  // The flush callback must always see the CURRENT id (adoption happens
  // inside an async then), so it reads a ref the state mirrors.
  const chatSessionIdRef = useRef<string | null>(initialChatSessionId)
  // Tell the shell which session this page shows, so the sidebar's rows
  // (the always-mounted desktop rail especially) highlight the right one;
  // cleared on unmount (leaving the chat page / switching sessions).
  const { setActiveSessionId } = useSidebar()
  useEffect(() => {
    setActiveSessionId(chatSessionId)
    return () => setActiveSessionId(null)
  }, [chatSessionId, setActiveSessionId])
  // Latest dialogue memory (composer-supplied); rides the next append batch.
  const pendingMemoryRef = useRef<unknown>(undefined)
  const [nextCursor, setNextCursor] = useState<ChatHistoryCursor | null>(
    initialCursor,
  )
  const [atCap, setAtCap] = useState(initialAtCap)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  // Stable snapshot of whether this mount started with any restored history
  // at all — `useState`'s lazy initializer runs once, never reacts to later
  // `messages` changes (see the `hasPreloadedHistory` doc comment above).
  const [hasPreloadedHistory] = useState(() => initialMessages.length > 0)
  // Root translator (no namespace) — `fromPersistable`'s `hasKey` needs to
  // check the SAME fully-qualified keys `transcript-render.tsx` renders
  // (`t(line.key, ...)` there also uses a root `useTranslations()`).
  const t = useTranslations()
  const router = useRouter()

  // `toPersistable` never returns null into this map — `queuePersist` below
  // checks that before ever calling `.set`, so the map's value type is the
  // real payload, not `PersistableMessage | null`.
  const pendingRef = useRef<Map<string, PersistableMessage>>(new Map())
  const flushedIdsRef = useRef<Set<string>>(new Set())
  const flushScheduledRef = useRef(false)

  // Every id ever flushed keeps its persisted payload here (never re-derived
  // from live `messages` state, which can drift after the flush — e.g. the
  // imagePath-fill-in upsert `queuePersist` above deliberately drops) so a
  // retry resends EXACTLY what failed. `knownMessageIdsRef` is the set of
  // ids `persistStatuses` (React state) mirrors from the tracker.
  const persistedByIdRef = useRef<Map<string, PersistableMessage>>(new Map())
  const knownMessageIdsRef = useRef<Set<string>>(new Set())

  // Per-mount session token — see the doc comment above ("Double-persist
  // fix") for why `clientMessageId` can't be the bare TranscriptMessage id.
  // Never rendered, so a server/client value mismatch on first paint is
  // harmless (React only diffs rendered output, and this never reaches
  // JSX).
  const [sessionId] = useState(() =>
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )

  const [persistTracker] = useState(() => createPersistTracker())
  const [persistStatuses, setPersistStatuses] = useState<
    ReadonlyMap<string, PersistStatus>
  >(new Map())

  useEffect(
    () =>
      mirrorPersistTracker(
        persistTracker,
        () => knownMessageIdsRef.current,
        setPersistStatuses,
      ),
    [persistTracker],
  )

  // The ONE call site for `appendChatMessages` — both the microtask flush
  // below and `retryPersist` go through this, so there is no second write
  // path (brief requirement). Every early return here settles `ids` to
  // 'failed' rather than leaving them stuck 'pending' forever: `enqueue(ids)`
  // has already run by the time this is called (queuePersist, below), so a
  // silent no-op here would leave a status with no eventual resolve/reject —
  // a permanently-spinning id the UI (Task 2) could never explain or let the
  // user retry out of.
  // R2b: appends are SERIALIZED through this promise chain. Two reasons:
  // (1) the FIRST append of a new chat creates the session row and later
  // appends must reuse its id — two nulls in flight would mint two
  // sessions (e2e-reproduced: 26 rapid turns split across several
  // conversations); (2) ordering keeps createdAt monotone per session.
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve())

  const flushBatch = useCallback(
    (ids: readonly string[]) => {
      if (groupId === undefined) {
        persistTracker.reject(ids)
        return
      }
      const persisted = ids
        .map((id) => persistedByIdRef.current.get(id))
        .filter((p): p is PersistableMessage => p !== undefined)
      if (persisted.length === 0) {
        persistTracker.reject(ids)
        return
      }
      appendQueueRef.current = appendQueueRef.current.then(() =>
        appendChatMessages(
          groupId,
          persisted,
          chatSessionIdRef.current,
          pendingMemoryRef.current,
        )
        .then((result) => {
          if (result === undefined) {
            // Ownership/validation drop — the rows never landed.
            persistTracker.reject(ids)
            return
          }
          if (chatSessionIdRef.current === null) {
            // A NEW chat's first batch just created its session row — adopt
            // it in STATE ONLY. Deliberately no URL rewrite: a direct
            // history.replaceState here wedged the app-router client (the
            // drawer refused to reopen until a reload — e2e-reproduced,
            // 2026-08-15), and router.replace would re-render the page with
            // a changed ?s=, remounting the keyed transcript and destroying
            // the very card the first message just opened. The URL catches
            // up on the next real navigation; the data is already safe.
            chatSessionIdRef.current = result.sessionId
            setChatSessionId(result.sessionId)
            // Refresh so the sidebar's server-rendered conversation list
            // gains the new session. Same-URL refresh: the transcript's
            // key (?s= value) is unchanged, so live state — including an
            // open card — survives per the provider-key contract.
            router.refresh()
          }
          persistTracker.resolve(ids)
        })
        .catch((error: unknown) => {
          // Fire-and-forget by design (plan: "an entry app must never block
          // on history") — console noise + tracker status only, never
          // surfaced to the user as a thrown error.
          console.error('appendChatMessages failed', error)
          persistTracker.reject(ids)
        }),
      )
    },
    [groupId, persistTracker],
  )

  const queuePersist = useCallback(
    (message: TranscriptMessage) => {
      if (groupId === undefined) return
      if (message.id.startsWith('db-')) return
      if (flushedIdsRef.current.has(message.id)) return
      const persistable = toPersistable(message)
      if (persistable === null) return
      pendingRef.current.set(message.id, scopeClientMessageId(sessionId, persistable))
      if (flushScheduledRef.current) return
      flushScheduledRef.current = true
      queueMicrotask(() => {
        flushScheduledRef.current = false
        const entries = Array.from(pendingRef.current.entries())
        pendingRef.current.clear()
        if (entries.length === 0) return
        const ids: string[] = []
        for (const [id, persisted] of entries) {
          flushedIdsRef.current.add(id)
          persistedByIdRef.current.set(id, persisted)
          knownMessageIdsRef.current.add(id)
          ids.push(id)
        }
        persistTracker.enqueue(ids)
        flushBatch(ids)
      })
    },
    [groupId, sessionId, persistTracker, flushBatch],
  )

  const retryPersist = useCallback(
    (messageId: string) => {
      persistTracker.retry(messageId, flushBatch)
    },
    [persistTracker, flushBatch],
  )

  const pushMessage = useCallback(
    (message: TranscriptMessage) => {
      setMessages((previous) => [...previous, message])
      queuePersist(message)
    },
    [queuePersist],
  )

  const upsertMessage = useCallback(
    (message: TranscriptMessage) => {
      setMessages((previous) => {
        const index = previous.findIndex((m) => m.id === message.id)
        if (index === -1) {
          return [...previous, message]
        }
        const next = [...previous]
        next[index] = message
        return next
      })
      queuePersist(message)
    },
    [queuePersist],
  )

  const removeMessage = useCallback((id: string) => {
    setMessages((previous) => previous.filter((m) => m.id !== id))
  }, [])

  const loadEarlier = useCallback(async () => {
    if (groupId === undefined || nextCursor === null || loadingEarlier) {
      return
    }
    setLoadingEarlier(true)
    try {
      const result = await fetchChatHistory(groupId, nextCursor)
      // `fetchChatHistory` returns newest-first within the page; reversed to
      // chronological before prepending so the whole array stays oldest ->
      // newest, same order `initialMessages` (page.tsx) already arrives in.
      const mapped = result.rows
        .map((row) => fromPersistable(row, (key) => t.has(key)))
        .filter((m): m is TranscriptMessage => m !== null)
        .reverse()
      setMessages((previous) => [...mapped, ...previous])
      setNextCursor(result.nextCursor)
      setAtCap(result.atCap)
    } catch (error) {
      console.error('fetchChatHistory failed', error)
    } finally {
      setLoadingEarlier(false)
    }
  }, [groupId, nextCursor, loadingEarlier, t])

  const persistMemory = useCallback((memory: unknown) => {
    pendingMemoryRef.current = memory
  }, [])

  const value = useMemo(
    () => ({
      chatSessionId,
      persistMemory,
      messages,
      pushMessage,
      upsertMessage,
      removeMessage,
      hasPreloadedHistory,
      nextCursor,
      atCap,
      loadingEarlier,
      loadEarlier,
      persistStatuses,
      retryPersist,
    }),
    [
      chatSessionId,
      persistMemory,
      messages,
      pushMessage,
      upsertMessage,
      removeMessage,
      hasPreloadedHistory,
      nextCursor,
      atCap,
      loadingEarlier,
      loadEarlier,
      persistStatuses,
      retryPersist,
    ],
  )

  return (
    <ChatTranscriptContext.Provider value={value}>
      {children}
    </ChatTranscriptContext.Provider>
  )
}

export function useChatTranscript(): ChatTranscriptContextValue {
  const context = useContext(ChatTranscriptContext)
  if (context === null) {
    // Mounting the composer (or the transcript itself) outside the provider
    // would silently drop every bubble — fail loudly instead.
    throw new Error(
      'useChatTranscript must be used inside a ChatTranscriptProvider',
    )
  }
  return context
}

export interface RecalcBubbleProps {
  groupId: string
  message: string
  dismissLabel: string
  action: (formData: FormData) => Promise<void>
}

const RECALC_MESSAGE_ID = 'recalc'
const PERSIST_EXPLAINER_MESSAGE_ID = 'persist-explainer'

/**
 * A key for the scroll effect below that changes whenever the LAST
 * message's on-screen HEIGHT is likely to have changed, not just its id.
 * The composer's one live outcome card keeps the same message id across an
 * askAmount → confirm transition (same card, more content) — keying only on
 * id (as this used to) meant the scroll never re-fired for that transition,
 * so the newly-grown card could end up partly below the fold. Folding in
 * the card's own `kind` (and the outer message `kind`) catches that
 * transition without needing a ResizeObserver.
 */
function scrollKeyOf(message: TranscriptMessage | undefined): string {
  if (message === undefined) {
    return ''
  }
  if (message.kind !== 'card') {
    return `${message.id}:${message.kind}`
  }
  const { card } = message
  // review M2: a `confirm` card can also grow a `chat-duplicate`/
  // `chat-error` banner underneath its Save button AFTER a failed save
  // attempt, with the card's own `kind` staying `confirm` throughout (same
  // as the askAmount → confirm morph above it) — folding their presence in
  // too means that growth still re-triggers the scroll. Task 3: the items
  // card can grow the exact same banners the same way, so it needs the same
  // treatment.
  const banner =
    card.kind === 'confirm' || card.kind === 'confirmItems'
      ? `:${card.duplicate}:${card.error !== null}`
      : ''
  return `${message.id}:${message.kind}:${card.kind}${banner}`
}

/** Which bubbles wait for Sem's thinking beat — see the effect in
 *  `ChatTranscript`. Only NEW assistant speech; never restored rows. */
function shouldHoldForThinking(message: TranscriptMessage): boolean {
  if (message.role !== 'assistant') return false
  if (message.id.startsWith('db-')) return false
  return (
    message.kind !== 'scanning' &&
    message.kind !== 'recalc' &&
    message.kind !== 'persistExplainer'
  )
}

/**
 * The chat surface. Empty state (owner's reference: the reference app's clean
 * empty chat) is the WHOLE screen until the first bubble — centred greeting
 * plus a one-line example, nothing else competing for attention. Once
 * something is said, it is a plain top-to-bottom bubble list; user bubbles
 * lean right, assistant bubbles (cards, the saved summary, the recalc
 * notice, query/help/guided replies) lean left.
 *
 * `recalcBanner` mirrors what home's L412-419 banner used to do (same
 * condition, computed server-side in page.tsx; same dismiss action) — it is
 * injected as a dismissible assistant bubble on mount here rather than
 * rendered unconditionally, since it is now just one more ephemeral message
 * in this list, not a fixture of the page.
 */
export function ChatTranscript({
  recalcBanner,
  memberCount = 3,
}: {
  recalcBanner: RecalcBubbleProps | null
  /** Active member count — Sem's avatar renders one dot per member plus
   *  its own accent dot (docs/BRAND.md §3, literal-count rule). */
  memberCount?: number
}) {
  const t = useTranslations('chat')
  const {
    messages,
    upsertMessage,
    hasPreloadedHistory,
    nextCursor,
    atCap,
    loadingEarlier,
    loadEarlier,
    persistStatuses,
    retryPersist,
  } = useChatTranscript()

  useEffect(() => {
    if (recalcBanner === null) {
      return
    }
    // `upsertMessage`, not `pushMessage`: this effect's "mount-only" intent
    // only holds in production. In development, StrictMode mounts every
    // component twice to surface exactly this kind of bug — a `pushMessage`
    // here would double the banner every time (review fix, 2026-08-10, the
    // same lesson as the docs/SOLVED.md 2026-08-10 effect entries: a fixed
    // id plus an append-only write is never safe to fire more than once).
    // `upsertMessage` replacing the same id is idempotent no matter how many
    // times this runs.
    upsertMessage({
      id: RECALC_MESSAGE_ID,
      role: 'assistant',
      kind: 'recalc',
      groupId: recalcBanner.groupId,
      message: recalcBanner.message,
      dismissLabel: recalcBanner.dismissLabel,
      action: recalcBanner.action,
    })
    // Mount-only: `recalcBanner` is a one-time server snapshot (whether it
    // is null never flips during this page's lifetime), and upsertMessage/
    // removeMessage are stable (useCallback in the provider above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Task 2 (chat-indicator-currency): the one-time inline explainer for the
  // pending-persist clock. `explainerAttemptedRef` gates this decision to
  // ONCE per mount — `persistStatuses` gets a brand-new Map on every
  // transition (pending -> saved is one too), so without the ref this
  // effect would re-check localStorage on every single settle, not just the
  // first pending one. `shouldShowPersistExplainer` itself is the source of
  // truth for "seen" (device-level, `persist-explainer.ts`); the ref only
  // stops the SAME mount from re-deciding once it already has.
  const explainerAttemptedRef = useRef(false)
  useEffect(() => {
    if (explainerAttemptedRef.current) {
      return
    }
    const hasPending = Array.from(persistStatuses.values()).includes('pending')
    if (!hasPending) {
      return
    }
    explainerAttemptedRef.current = true
    // `resolveExplainerStorage`, not `window.localStorage` directly (review
    // fix round 1): the PROPERTY ACCESS itself — not just `.getItem` —
    // throws a `SecurityError` under some blocked-storage configurations
    // (Safari's "Block All Cookies", a sandboxed iframe), which would take
    // down this whole effect if touched unguarded. `null` here means
    // "couldn't even ask" — fail closed, same as every other storage
    // failure this module handles: skip the explainer, never crash the
    // transcript.
    const storage = resolveExplainerStorage()
    if (storage === null || !shouldShowPersistExplainer(storage)) {
      return
    }
    markPersistExplainerSeen(storage)
    // `upsertMessage`, not `pushMessage` — same StrictMode double-invoke
    // reasoning as the recalc banner effect above: a fixed id makes a
    // repeat call idempotent instead of doubling the bubble.
    upsertMessage({
      id: PERSIST_EXPLAINER_MESSAGE_ID,
      role: 'assistant',
      kind: 'persistExplainer',
    })
  }, [persistStatuses, upsertMessage])

  // A pushed bubble should not require a manual scroll to see — reference-app-style
  // chat scrolls to the newest message on its own. `scrollIntoView` on the
  // LAST BUBBLE itself, not `container.scrollTo`: the transcript's own div
  // never actually overflows (`main`'s `flex-1` collapses to `min-height:
  // auto`, so the PAGE scrolls, not this div — `container.scrollTo` was a
  // no-op, review round 2, 2026-08-10). `scrollIntoView` walks up through
  // whichever ancestor actually scrolls, so it works regardless.
  //
  // Keyed on `scrollKeyOf` (id + kind), not `messages` itself: `upsertMessage`
  // replaces the outcome card in place on every keystroke in its own fields
  // (typing the description, ticking a participant pill), which produces a
  // new `messages` array every time without changing what the last bubble
  // IS. Scrolling on every one of those would jitter and yank a user who
  // had scrolled up to re-read something — but the card's own `kind` IS
  // folded in, so an askAmount → confirm transition (same message id, taller
  // content) still re-scrolls.
  // Poking Sem (owner's 2026-08-14 request): tapping the greeting mark
  // startles the dots (SemMark's own engine reaction) AND swaps the hint
  // line for one of a few playful replies, cycling per tap and reverting
  // to the ordinary hint a few seconds after the last poke.
  const POKE_LINE_COUNT = 4
  const [pokeIndex, setPokeIndex] = useState<number | null>(null)
  const pokeTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (pokeTimerRef.current !== null) {
        window.clearTimeout(pokeTimerRef.current)
      }
    },
    [],
  )
  const handlePoke = () => {
    setPokeIndex((previous) =>
      previous === null ? 0 : (previous + 1) % POKE_LINE_COUNT,
    )
    if (pokeTimerRef.current !== null) {
      window.clearTimeout(pokeTimerRef.current)
    }
    pokeTimerRef.current = window.setTimeout(() => setPokeIndex(null), 4000)
  }

  // Deliberate beat before Sem answers (owner, 2026-08-14 round 3b: an
  // instant reply reads as a careless one — and while it "thinks", the
  // tail mark should visibly think). Every NEW assistant bubble that is
  // conversational (answer / card / saved / walletCreated…) is held back
  // ~0.8–1.3s after it is pushed; during the hold the tail mark plays
  // `thinking`, then the bubble appears (and, for answers, types out).
  // Restored `db-` rows never wait; chrome kinds (scanning indicator,
  // recalc banner, persist explainer) never wait — they are not speech.
  // `seenIdsRef` makes this idempotent across re-renders and StrictMode.
  // `releasedIds` grows monotonically: a message is visible once released
  // (or if it never needed holding). Deriving "held" during render from
  // seen-but-not-released avoids a synchronous setState in the effect —
  // the effect only schedules the release timers.
  const [releasedIds, setReleasedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  // Ids present at mount are already "said" — never held. Plain state
  // (lazy init, never set again) rather than a ref: it is read during
  // render, and the compiler lint forbids ref reads there.
  const [initialIds] = useState<ReadonlySet<string>>(
    () => new Set(messages.map((m) => m.id)),
  )
  const seenIdsRef = useRef<Set<string> | null>(null)
  const isHeld = (m: TranscriptMessage) =>
    shouldHoldForThinking(m) && !initialIds.has(m.id) && !releasedIds.has(m.id)
  useEffect(() => {
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(initialIds)
    }
    const seen = seenIdsRef.current
    for (const message of messages) {
      if (seen.has(message.id)) continue
      seen.add(message.id)
      if (!shouldHoldForThinking(message)) continue
      const delay = 800 + Math.random() * 500
      // Timers deliberately survive re-runs: a hold must always release.
      window.setTimeout(() => {
        setReleasedIds((previous) => new Set(previous).add(message.id))
      }, delay)
    }
  }, [messages, initialIds])
  const visibleMessages = messages.filter((m) => !isHeld(m))
  const heldCount = messages.length - visibleMessages.length
  const thinking = heldCount > 0

  const lastKey = `${scrollKeyOf(messages[messages.length - 1])}:${heldCount}`
  const lastBubbleRef = useRef<HTMLDivElement>(null)
  // Task 2 (chat-history): the FIRST time this effect ever runs is the
  // initial mount — which, with preloaded history, can already have up to
  // `CHAT_HISTORY_PAGE_SIZE` bubbles sitting above the fold. Smooth-
  // scrolling through all of them on load would read as a jarring animated
  // scroll-through rather than the page simply opening at the bottom, so the
  // very first run always jumps (`behavior: 'auto'`) regardless of the
  // reduce-motion query; every LATER run (a genuinely new bubble arriving)
  // keeps the existing reduce-motion-aware smooth/auto choice.
  const isFirstScrollRef = useRef(true)
  useEffect(() => {
    const bubble = lastBubbleRef.current
    if (bubble === null) {
      return
    }
    const isFirstRun = isFirstScrollRef.current
    isFirstScrollRef.current = false
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    bubble.scrollIntoView({
      block: 'end',
      behavior: isFirstRun || reduceMotion ? 'auto' : 'smooth',
    })
  }, [lastKey])

  // "Load earlier" scroll anchoring (spec item 5): prepending older bubbles
  // ABOVE the current viewport would otherwise yank the visible content
  // downward by exactly the height of what just got inserted. `scrollAnchorRef`
  // is set synchronously in `handleLoadEarlier`, BEFORE `loadEarlier`'s async
  // fetch/prepend — capturing the scroll position and document height as
  // they were right before the insert. This `useLayoutEffect` (not
  // `useEffect`: it must run and repaint BEFORE the browser shows the
  // post-prepend layout, or the yank would be visible for a frame) fires on
  // every `messages` change, but the anchor is `null` except immediately
  // after a load-earlier click, so it is a no-op the rest of the time. The
  // PAGE scrolls, not this div (see the auto-scroll effect's own comment
  // above), so this adjusts `document.documentElement`/`window`, matching
  // that same precedent.
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current
    if (anchor === null) {
      return
    }
    scrollAnchorRef.current = null
    const delta = document.documentElement.scrollHeight - anchor.height
    window.scrollTo(0, anchor.top + delta)
  }, [messages])

  const handleLoadEarlier = () => {
    scrollAnchorRef.current = {
      height: document.documentElement.scrollHeight,
      top: window.scrollY,
    }
    void loadEarlier()
  }

  if (messages.length === 0 && !hasPreloadedHistory) {
    // Empty state per the owner's reference-app design: the greeting is the
    // WHOLE screen, nothing else competing for attention (no dashboard
    // creep). Typography from PITCH_TEARDOWN.md ## Type scale's derived
    // rules: `feature-title` (32px/700, viewport-invariant — everything
    // ≤32px doesn't scale down) for the greeting, tracking -0.04em per the
    // "≥32px" rule; the hint is `body` (16px/400, tracking -0.02em, 1.6
    // line-height), muted.
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
        data-testid="chat-empty"
      >
        {/* Sem is present before the first word — the signature greeting
            moment (docs/BRAND.md §5): the live mark breathing in idle.
            Interactive here (and only here): hover leans the dots toward
            the cursor, a tap startles them and earns a playful line. */}
        <SemMark
          state="idle"
          size={160}
          members={memberCount}
          interactive
          onPoke={handlePoke}
        />
        <p className="text-[32px] leading-[1.2] font-bold tracking-[-0.04em]">
          {t('greeting')}
        </p>
        <p
          className="max-w-xs text-base leading-[1.6] tracking-[-0.02em] text-muted-foreground"
          data-testid="chat-greeting-hint"
        >
          {pokeIndex === null ? t('greetingHint') : t(`poke.p${pokeIndex}`)}
        </p>
      </div>
    )
  }

  return (
    <div
      // 16px between speaker turns — PITCH_TEARDOWN.md ## Chat-surface
      // mapping "Transcript rhythm" (the glass card's own measured
      // internal gap; this app doesn't visually group consecutive
      // same-speaker bubbles, so every gap uses the turn-gap step).
      // `pt-9` clears the group-name line page.tsx now overlays at the top
      // of `main` (absolute, so it stays out of the empty-state's centring
      // region): its 20px line plus the 16px turn-gap below it.
      className="flex flex-1 flex-col gap-4 overflow-y-auto pt-9 pb-2"
      data-testid="chat-transcript"
    >
      {/* Top-of-history (Task 2, chat-history): a control to page in older
          restored messages when there are more (`nextCursor`), else — once
          this member's history has actually been trimmed to the cap — a
          quiet notice saying so, matching the plan's "trimming must be
          visible to the user" decision. Neither shows once `nextCursor` is
          `null` AND `atCap` is `false` (a member who has never hit the cap
          and has no more pages — the ordinary case for most groups). */}
      {nextCursor !== null ? (
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="mx-auto w-fit rounded-sm text-sm font-medium"
          onClick={handleLoadEarlier}
          disabled={loadingEarlier}
          data-testid="chat-history-more"
        >
          {t('history.loadEarlier')}
        </Button>
      ) : atCap ? (
        <p
          className="mx-auto max-w-xs text-center text-xs text-muted-foreground"
          data-testid="chat-history-notice"
        >
          {t('history.retentionNotice', { cap: CHAT_HISTORY_CAP })}
        </p>
      ) : null}
      {visibleMessages.map((message) => (
        <div
          key={message.id}
          // The persist explainer is UI chrome, not a conversational turn —
          // it deliberately does NOT carry the generic `chat-message-*`
          // testid every real bubble gets (`PersistExplainerBubble` has its
          // own `chat-persist-explainer` testid instead). Several existing
          // specs assert exact counts / `.last()` against
          // `[data-testid^="chat-message-"]` (e2e/chat-history.spec.ts's
          // pagination test, e2e/chat-entry.spec.ts's scroll-clearance
          // check) — those were written before this task and must not have
          // to account for a one-time, non-conversational bubble appearing
          // on whichever send happens to be the first ever queued.
          data-testid={
            message.kind === 'persistExplainer'
              ? undefined
              : `chat-message-${message.role}`
          }
          // Entrance: rise+fade, --dur-slow + --ease-swift, transform/
          // opacity only (## Chat-surface mapping "Message entrance");
          // freezes to the settled state under prefers-reduced-motion via
          // the existing wildcard override in globals.css. User bubble:
          // `primary` fill per the mapping's "User bubble" row, 16px
          // radius with the tail corner (bottom-right, since it's
          // right-aligned) pulled to 4px. Assistant bubbles carry no fill
          // here — the mapping's "surface card" tint lives on the actual
          // content component in transcript-render.tsx (AnswerBubble /
          // SavedBubble), since this wrapper also hosts the in-bubble card
          // and the recalc banner, which are their OWN distinct surfaces
          // per the mapping, not bubbles.
          className={cn(
            'chat-bubble-enter',
            // The auto-scroll below uses `scrollIntoView({block:'end'})`,
            // which aligns the bubble's bottom edge with the VIEWPORT's
            // bottom — where the fixed composer dock floats on top of it
            // (owner's phone report, 2026-08-13: the newest bubble's tail
            // hid behind the dock whenever the auto-scroll, not a manual
            // fling to max, decided the resting position). `scroll-margin-
            // bottom` is the mechanism scrollIntoView actually consults for
            // clearance: sized to the dock's idle height plus the device
            // inset, mirroring `main`'s own `pb-24` + the root layout's
            // safe-area padding. Harmless on every non-last bubble (scroll
            // margins only matter to programmatic scrolls that target the
            // element), so it rides the shared class string rather than a
            // conditional.
            'scroll-mb-[calc(6rem+env(safe-area-inset-bottom))]',
            message.role === 'user'
              ? 'ml-auto max-w-[85%] rounded-lg rounded-br-[4px] bg-primary px-4 py-3 text-base leading-[1.6] tracking-[-0.02em] text-primary-foreground'
              : 'mr-auto w-full max-w-[92%]',
          )}
        >
          <TranscriptBubble
            message={message}
            persistStatus={
              message.role === 'user'
                ? persistStatuses.get(message.id)
                : undefined
            }
            onRetryPersist={
              message.role === 'user'
                ? () => retryPersist(message.id)
                : undefined
            }
          />
        </div>
      ))}
      {/* Sem stays present at the tail of the conversation (owner,
          2026-08-14 round 2: "reference app처럼 아래에") — the live mark idling
          under the newest bubble, poke-able like the greeting one. This
          wrapper is ALSO the auto-scroll target (`lastBubbleRef` now
          points here, not at the last message div): it always sits below
          the newest bubble, so scrolling it into view preserves the old
          behavior and keeps the mark on screen, with the same dock
          clearance the bubbles carry. */}
      <div
        ref={lastBubbleRef}
        className="mr-auto scroll-mb-[calc(6rem+env(safe-area-inset-bottom))]"
        data-testid="chat-sem-tail"
      >
        <SemMark
          state={thinking ? 'thinking' : 'idle'}
          size={44}
          members={memberCount}
          interactive
        />
      </div>
    </div>
  )
}
