import { getTranslations } from 'next-intl/server'
import { markRecalcSeen } from './exchange/actions'
import { buildAssistantData } from './assistant-data'
import { ChatComposer } from './ChatComposer'
import { DockFrame } from './DockFrame'
import {
  ChatTranscript,
  ChatTranscriptProvider,
  type TranscriptMessage,
} from './ChatTranscript'
import { fetchChatHistory } from './chat-history-actions'
import { listSessionRows, readSessionMemory } from '@/lib/chat-sessions'
import type { RecentExpenseView } from './chat-edit-actions'
import { fromPersistable } from '@/lib/chat-history'
import { isSettleable } from '@/lib/engine-map'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { destinationFor, flagEmoji } from '@/lib/destinations'
import { defaultExpenseCurrency } from '@/lib/expense-currency'

/**
 * Home. Chat-only (Task 5, app-shell restructure): "정산은 그 자리에서 딱
 * 빠르게 입력하고 끝날 수 있게" — input-focused, zero dashboards. Totals,
 * wallet cards, the invite prompt, per-person balances, the summary note and
 * the recent-expenses feed all moved to their own sidebar destinations
 * (status/history/invite/exchange) in earlier tasks of this restructure;
 * home renders only the group name, the chat transcript, and the composer
 * that feeds it.
 */
export default async function GroupHomePage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>
  /** `s` — the active chat session id, or 'new' for a fresh conversation
   *  (R2b, reference-app-style sessions). Absent = the most recent session. */
  searchParams: Promise<{ s?: string }>
}) {
  const { groupId } = await params
  const { s } = await searchParams
  const { member: me } = await requireGroupMember(groupId)
  const data = await loadGroupData(groupId)
  const { group, members, mode } = data
  const t = await getTranslations('home')
  // Assistant-brain queries (QUERY_MY_BALANCE / QUERY_PAIRWISE /
  // QUERY_GROUP_TOTAL / QUERY_MY_SPENDING / QUERY_WALLET) need the
  // settlement engine's outputs, which only exist server-side — gathered
  // once here rather than adding a client-side fetch (spec §5.5).
  const assistantData = buildAssistantData(data, me.id)

  // Chat history preload (Task 2, chat-history): the newest page of THIS
  // member's own persisted history (private, per-member — `fetchChatHistory`
  // resolves the member from the session, never a client-supplied id).
  // `fromPersistable` needs a root (no-namespace) translator so its
  // `hasKey` check tests the SAME fully-qualified keys the transcript
  // renders answer lines with (`transcript-render.tsx`'s own root
  // `useTranslations()`) — an i18n key renamed/removed since a row was
  // written must drop that line instead of crashing.
  const tRoot = await getTranslations()
  // R2b sessions: resolve which conversation this render shows. 'new' is a
  // fresh chat (no session row yet — lazy creation on first message); an
  // unknown id falls back to the newest conversation rather than a 404,
  // since a stale link should never dead-end the chat.
  const sessions = await listSessionRows(groupId, me.id)
  const activeSessionId =
    s === 'new'
      ? null
      : s !== undefined && sessions.some((row) => row.id === s)
        ? s
        : (sessions[0]?.id ?? null)
  const [chatHistory, sessionMemory] = await Promise.all([
    activeSessionId !== null
      ? fetchChatHistory(groupId, undefined, activeSessionId)
      : Promise.resolve({
          rows: [],
          nextCursor: null,
          atCap: false,
        } satisfies Awaited<ReturnType<typeof fetchChatHistory>>),
    activeSessionId !== null
      ? readSessionMemory(groupId, me.id, activeSessionId)
      : Promise.resolve(null),
  ])
  // Rows arrive newest-first (`fetchChatHistory`'s own order); reversed to
  // chronological (oldest -> newest) so `initialMessages` lands in the same
  // order live `pushMessage` calls build up.
  const initialMessages = chatHistory.rows
    .map((row) => fromPersistable(row, (key) => tRoot.has(key)))
    .filter((m): m is TranscriptMessage => m !== null)
    .reverse()

  // Recalc notice: someone else's exchange records landed after my cursor
  // (AVG_COST only — records don't move MARKET-mode numbers). Same
  // condition as the banner this replaces; now injected as a dismissible
  // assistant bubble by `ChatTranscript` on mount instead of a fixture of
  // the page.
  const recalcRecord =
    mode === 'AVG_COST'
      ? await prisma.exchangeRecord.findFirst({
          where: {
            member: { groupId },
            memberId: { not: me.id },
            ...(me.lastSeenRecalcAt
              ? { createdAt: { gt: me.lastSeenRecalcAt } }
              : {}),
          },
          orderBy: { createdAt: 'desc' },
          include: { member: true },
        })
      : null
  const recalcBanner = recalcRecord
    ? {
        groupId,
        action: markRecalcSeen,
        message: t('recalcBanner', { name: recalcRecord.member.name }),
        dismissLabel: t('recalcDismiss'),
      }
    : null

  const destination = destinationFor(group.tripCountry ?? '')

  // Only current members parse and appear as pills — someone who left the
  // group cannot be picked as payer or participant on a new expense.
  const chatMembers = members
    .filter((m) => m.leftAt === null)
    .map((m) => ({ id: m.id, name: m.name }))

  // Match the wizard's default exactly (form-props.ts): the most recent
  // NON-CANCELLED expense's currency, if fresh, else the trip currency, else
  // settlement. Without this the chat and the wizard disagree on what "the"
  // default currency is, and a trip-currency chat entry gets misclassified
  // as cross-currency and bounced to the wizard for no reason.
  // Task 10 (context commands): what "아까 그 술값" is resolved against — the
  // newest settleable expenses (`isSettleable`: not personal, not cancelled),
  // capped at 20, which is exactly how far a bare 그거/that reaches
  // (`resolveReference`'s own RECENT_LIMIT). `data.expenses` is already
  // newest-first. Amounts are decimal strings and the instant is an ISO string
  // — `bigint`/`Date` never cross this boundary in this app (see
  // `assistant-data.ts`); `ChatComposer` converts once, on arrival.
  const recentExpenses: RecentExpenseView[] = data.expenses
    .filter(isSettleable)
    .slice(0, 20)
    .map((expense) => ({
      id: expense.id,
      // What the feed calls it, which is what the user would name in a
      // sentence; `note` only stands in for a row saved without a title.
      note: expense.title || expense.note || '',
      amountMinor: expense.amount.toString(),
      currency: expense.currency,
      timestampIso: expense.timestamp.toISOString(),
      participantIds: expense.participants.map((p) => p.memberId),
      payerId: expense.payerId,
      cancelled: false,
      // Non-zero means this expense is split by its item ASSIGNMENTS, so the
      // chat's field-level edits do not apply to it — the card says so before
      // asking (`editBlockedKey`), and the actions refuse it again.
      itemCount: expense.items.length,
    }))

  const mostRecentExpense = data.expenses.find((e) => e.cancelledAt === null)
  const defaultCurrency = defaultExpenseCurrency({
    recent: mostRecentExpense
      ? { currency: mostRecentExpense.currency, at: mostRecentExpense.timestamp }
      : null,
    now: new Date(),
    tripCurrency: group.tripCurrency,
    settlementCurrency: group.settlementCurrency,
  })

  return (
    <main
      className="relative flex flex-1 flex-col gap-4 px-5 pt-6 pb-24"
      // Task 6 (app-shell restructure): the tab bar is gone, so the dock
      // below now sits at the real bottom (`bottom-0`) instead of offset
      // above a tab bar that no longer exists. This padding only has to
      // clear the dock's own idle height (~70px) plus a margin — 6rem
      // (96px, `pb-24`) — so the last bubble is never hidden behind it. NOT
      // `env(safe-area-inset-bottom)` here too: `body` (root layout) already
      // adds that once, below everything in this flex-1 chain (this `main`
      // → the group layout's wrapper → `body`, all plain flex-1 containers
      // with nothing clipping between them, so the reserved space is
      // identical regardless of which one holds the padding) — a second
      // `env()` here would double-count the device inset rather than adding
      // real clearance. The dock itself still adds its own (it is `fixed`,
      // entirely outside this padding chain).
    >
      {/* reference-app-parity shell (2026-08-16): the group is named the way
          the reference app names the project above a chat — one quiet
          centred line, not a page header block. The destination rides
          along as a muted suffix; the drawer states both again.
          Absolutely positioned (owner's 2026-08-16 note: the empty-state
          hero sat ~30px below the visual centre) so this line does NOT
          eat into the flex region the greeting centres itself in — the
          transcript's own top padding clears it once bubbles exist. */}
      <header className="absolute inset-x-0 top-6 flex justify-center px-5">
        <h1 className="flex max-w-full items-baseline gap-1.5 truncate text-sm font-medium text-muted-foreground">
          <span className="truncate text-foreground">{group.name}</span>
          {destination ? (
            <span className="truncate" data-testid="trip-destination">
              <span aria-hidden="true">· {flagEmoji(destination.code)} </span>
              {group.tripCity
                ? `${group.tripCity}, ${destination.name}`
                : destination.name}
            </span>
          ) : null}
        </h1>
      </header>

      <ChatTranscriptProvider
        // Keyed by the REQUESTED ?s= param — not the resolved id — so the
        // key only changes when the USER navigates between conversations
        // (a deliberate remount/reset). Data drift never remounts: the
        // adoption-time router.refresh() re-resolves activeSessionId
        // (null → the new row) on an unchanged URL, and a resolved-id key
        // would have torn down the very card the first message opened
        // (e2e-reproduced: the save button detached mid-click).
        key={s ?? 'default'}
        groupId={groupId}
        chatSessionId={activeSessionId}
        initialMessages={initialMessages}
        initialCursor={chatHistory.nextCursor}
        atCap={chatHistory.atCap}
      >
        <ChatTranscript
          recalcBanner={recalcBanner}
          memberCount={chatMembers.length}
        />

        {/* Chat-first entry (primary path): a persistent dock, always
            mounted — never behind a conditional or a keyed list — so an open
            confirm card survives the router.refresh() a save triggers (see
            ChatComposer's own doc comment). Task 6 (app-shell restructure):
            sits at the real bottom now that the tab bar is gone, safe-area
            aware via the calc'd bottom padding rather than an offset. */}
        <DockFrame>
          <div className="mx-auto w-full max-w-md lg:max-w-2xl">
            <ChatComposer
              groupId={groupId}
              actorId={me.id}
              defaultCurrency={defaultCurrency}
              members={chatMembers}
              assistantData={assistantData}
              recentExpenses={recentExpenses}
              initialMemory={sessionMemory}
            />
          </div>
        </DockFrame>
      </ChatTranscriptProvider>
    </main>
  )
}
