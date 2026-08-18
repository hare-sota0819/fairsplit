'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { AlertCircle, Clock } from 'lucide-react'
import { NavLink } from '@/components/NavLoader'
import { SubmitButton } from '@/components/SubmitButton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { MONEY_KEYS } from '@/lib/assistant/compose'
import { formatLocalDateTime } from '@/lib/datetime'
import { formatMinor } from '@/lib/format'
import { SemMark } from '@/components/sem/SemMark'
import { RecalcBanner } from './RecalcBanner'
import { ChatAssignCard } from './ChatAssignCard'
import type { PersistStatus } from './persist-status'
import {
  useChatTranscript,
  type AnswerLine,
  type CardPayload,
  type EditAskView,
  type EditTargetView,
  type TranscriptMessage,
} from './ChatTranscript'

/**
 * Every `<div>` a transcript bubble can render lives here — spec §5.5(a).
 * `ChatTranscript`/`ChatComposer` only ever hand this DATA (`TranscriptMessage`);
 * this file is the one place that turns it into markup, so a card can never
 * go stale by way of a missed effect dependency (there is no JSX in state to
 * miss).
 */
export function TranscriptBubble({
  message,
  persistStatus,
  onRetryPersist,
}: {
  message: TranscriptMessage
  /** Task 2 (chat-indicator-currency): this message's write-through persist
   *  status (Task 1, `persist-status.ts`) — only ever meaningful for the two
   *  USER kinds below ('text'/'image', the only ones a person themselves
   *  sends), so every other `case` below ignores it. `undefined` (never
   *  queued — restored history, or persistence never wired for this kind)
   *  and `'saved'` both render nothing; see `PersistIndicator`. */
  persistStatus?: PersistStatus
  onRetryPersist?: () => void
}) {
  switch (message.kind) {
    case 'text':
      return (
        <TextBubble
          text={message.text}
          persistStatus={persistStatus}
          onRetryPersist={onRetryPersist}
        />
      )
    case 'image':
      return (
        <ImageBubble
          id={message.id}
          url={message.url}
          text={message.text}
          imagePath={message.imagePath}
          persistStatus={persistStatus}
          onRetryPersist={onRetryPersist}
        />
      )
    case 'answer':
      return (
        <AnswerBubble
          lines={message.lines}
          messageId={message.id}
          testId={message.testId}
        />
      )
    case 'card':
      return <OutcomeCard card={message.card} />
    case 'scanning':
      return <ScanningBubble />
    case 'persistExplainer':
      return <PersistExplainerBubble />
    case 'saved':
      return (
        <SavedBubble
          title={message.title}
          receiptTotal={message.receiptTotal}
          groupId={message.groupId}
        />
      )
    case 'recalc':
      return (
        <RecalcBubble
          id={message.id}
          groupId={message.groupId}
          message={message.message}
          dismissLabel={message.dismissLabel}
          action={message.action}
        />
      )
  }
}

/**
 * One composer/query reply: a stack of i18n lines. A line whose `key` is one
 * of `assistant.guided.option.*` (T6 attaches `onSelect` to those and ONLY
 * those, see `ChatComposer`) renders as a tappable suggestion chip instead of
 * plain text — tapping it injects the mapped question and resubmits through
 * the same `classify()` pipeline. The GUIDED `escape` line carries an `href`
 * instead (review I1) — a real navigation to the full form, not a resubmit,
 * since "write it in the full form" is a dead end unless GUIDED can actually
 * open one. Money placeholders (`MONEY_KEYS`, spec §5.4) are formatted here,
 * right before the one `t()` call that needs them — passing the raw
 * minor-units string straight to `t()` would print "30000" instead of
 * "₩30,000".
 *
 * Testids are suffixed with `messageId` (review NEW-3): two GUIDED replies
 * can legitimately coexist in the transcript (e.g. two separate
 * unrecognised messages, each offering its own `option.help` chip), and a
 * bare `chat-suggestion-help`/`chat-guided-escape` would match more than
 * one element — a Playwright strict-mode violation. `messageId` (this
 * message's own transcript id, e.g. `assistant-3`) is already unique per
 * bubble, so appending it keeps every chip/link addressable on its own.
 */
/**
 * Task 2 (chat-indicator-currency, docs/PROMPT.md 2026-08-14): the
 * write-through persist status of a user bubble, rendered directly under
 * its content — a KakaoTalk-style pending clock while the history write is
 * in flight, cleared the moment it lands, and an alert badge + real retry
 * button if it failed. `undefined` (never queued — a restored `db-` bubble,
 * or a kind persistence never covers) and `'saved'` (write landed — Task 1's
 * "cleared on confirm") both render nothing, so an ordinary saved message
 * looks exactly as it did before this task. Icon size (`size-3.5`, 14px)
 * matches the app's own "meta" text scale (docs/PITCH_TEARDOWN.md ## Type
 * scale), the same scale timestamps/quiet links already use elsewhere in
 * this transcript. Colour rides `text-primary-foreground` (not the
 * `negative` token) on purpose: this sits ON the user bubble's own
 * `bg-primary` fill, and shape (Clock vs. AlertCircle) plus the icon's own
 * aria-label already distinguish pending from failed — using a semantic
 * negative red here would risk a contrast mismatch against `--primary`
 * (a saturated brand colour, not this app's neutral background) in either
 * theme, for no accessibility gain over the shape + label it already has.
 */
function PersistIndicator({
  status,
  onRetry,
}: {
  status: PersistStatus | undefined
  onRetry: () => void
}) {
  const t = useTranslations('chat.persist')
  if (status === undefined || status === 'saved') {
    return null
  }
  if (status === 'pending') {
    return (
      <div className="mt-1 flex justify-end">
        <Clock
          aria-label={t('pending')}
          role="img"
          data-testid="chat-persist-pending"
          className="size-3.5 shrink-0 text-primary-foreground/70"
        />
      </div>
    )
  }
  return (
    <div className="mt-1 flex items-center justify-end gap-1.5">
      <AlertCircle
        aria-label={t('failed')}
        role="img"
        data-testid="chat-persist-failed"
        className="size-3.5 shrink-0 text-primary-foreground"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        aria-label={t('retry')}
        data-testid="chat-retry-persist"
        className="h-auto p-0 text-primary-foreground underline underline-offset-2 hover:bg-transparent hover:text-primary-foreground active:bg-transparent active:text-primary-foreground"
      >
        {t('retry')}
      </Button>
    </div>
  )
}

/** Plain user text, plus its persist indicator right below (Task 2). Was a
 *  bare `<>{message.text}</>` fragment before this task; wrapping the text
 *  in a `<p>` is visually identical (no default margin under this app's
 *  Tailwind preflight, and every text style lives on the bubble's own
 *  outer `div` in `ChatTranscript.tsx`, inherited regardless of tag) and
 *  gives the indicator row a sibling to sit under. */
function TextBubble({
  text,
  persistStatus,
  onRetryPersist,
}: {
  text: string
  persistStatus?: PersistStatus
  onRetryPersist?: () => void
}) {
  return (
    <>
      <p>{text}</p>
      <PersistIndicator
        status={persistStatus}
        onRetry={onRetryPersist ?? (() => {})}
      />
    </>
  )
}

/**
 * The user's own bubble for an attached receipt photo (Task 2, chat-image-c)
 * — a thumbnail (the SAME object URL the composer created from the original
 * file, revoked once replaced/unmounted) plus the same-message text the user
 * had typed before attaching, if any. Renders inside the ordinary user-bubble
 * wrapper (`ChatTranscript.tsx`'s `role === 'user'` styling), so no bubble
 * chrome is duplicated here.
 *
 * Task 2 (chat-history): a RESTORED bubble (`id` prefixed `db-` —
 * `fromPersistable`'s own marker) never carries a live blob URL — its `url`
 * is either the signed `/api/receipts/image?path=...` route (`imagePath`
 * non-null) or `''` (`imagePath` null: the scan never uploaded, or the row
 * predates this field). Either way it needs the neutral placeholder chip
 * instead of an `<img>`: straight away when there is no path at all, or via
 * `onError` when the route itself 404s (the path no longer belongs to a
 * SAVED expense — plan §1). A LIVE bubble's `url` is always a real blob URL
 * regardless of whether `imagePath` has arrived yet (see `ChatComposer`'s
 * `handleAttach`), so this distinction is keyed on `id`, not on `imagePath`
 * alone.
 */
function ImageBubble({
  id,
  url,
  text,
  imagePath,
  persistStatus,
  onRetryPersist,
}: {
  id: string
  url: string
  text: string | null
  imagePath: string | null
  persistStatus?: PersistStatus
  onRetryPersist?: () => void
}) {
  const t = useTranslations('chat.scan')
  const tHistory = useTranslations('chat.history')
  // Owner request (2026-08-13, phone review): the sent photo must be
  // tappable to confirm it's the right one — the thumbnail crops to
  // `object-cover`, so a receipt's actual numbers are often not readable
  // in the bubble at all. Same `Dialog` the wizard's own "view photo"
  // uses (`scan-photo-dialog`, ReceiptScan.tsx), not a bespoke lightbox.
  const [open, setOpen] = useState(false)
  const isRestored = id.startsWith('db-')
  const [imageErrored, setImageErrored] = useState(false)
  const showPlaceholder = isRestored && (imagePath === null || imageErrored)

  if (showPlaceholder) {
    return (
      <div className="flex flex-col gap-2">
        <div
          data-testid="chat-image-placeholder"
          className="flex h-24 w-32 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground"
        >
          {tHistory('photoPlaceholder')}
        </div>
        {text !== null ? <p>{text}</p> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('viewPhoto')}
        data-testid="chat-image-bubble"
        // "Opacity dim" press recipe, same as the dialog's own close button.
        className="transition-opacity duration-fast active:opacity-60"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL (live) or the signed receipt route (restored), neither an optimisable asset */}
        <img
          src={url}
          alt={t('imageAlt')}
          className="max-h-40 rounded-lg object-cover"
          onError={() => setImageErrored(true)}
        />
      </button>
      {text !== null ? <p>{text}</p> : null}
      {/* Restored ('db-') image bubbles never reach this branch with a
          defined status (see the file doc comment above) — the placeholder
          branch above skips this entirely for the same reason. */}
      <PersistIndicator
        status={persistStatus}
        onRetry={onRetryPersist ?? (() => {})}
      />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('imageAlt')}
        closeLabel={t('closePhoto')}
        testId="chat-photo-dialog"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- same src, full size */}
        <img src={url} alt={t('imageAlt')} className="w-full rounded-lg" />
      </Dialog>
    </div>
  )
}

/**
 * The scanning indicator (Task 2) — upserted at a FIXED transcript id for
 * the duration of one `/api/receipts/parse` call and removed on every exit
 * path (`ChatComposer`'s attach handler). `aria-live="polite"` announces it
 * without stealing focus; the pulse matches the app's existing loading tone
 * rather than a bespoke spinner.
 */
function ScanningBubble() {
  const t = useTranslations('chat.scan')
  return (
    <div
      aria-live="polite"
      data-testid="chat-scan-reading"
      className="flex items-center gap-2 rounded-lg rounded-bl-[4px] bg-primary-soft px-4 py-3 text-base leading-[1.6] tracking-[-0.02em] text-foreground dark:bg-card"
    >
      {/* Sem thinking, in the flesh — the mark's network churn IS the
          progress indicator (docs/BRAND.md §4), so the text no longer
          pulses on its own. */}
      <SemMark state="thinking" size={26} />
      <p>{t('reading')}</p>
    </div>
  )
}

/**
 * The one-time explainer for the pending-persist clock (Task 2,
 * chat-indicator-currency) — an ordinary assistant "surface card" bubble,
 * same fill/radius as `AnswerBubble`/`SavedBubble`, shown exactly once per
 * device (`persist-explainer.ts`'s localStorage gate, `ChatTranscript.tsx`'s
 * effect decides WHEN to push it). Never persisted (`chat-history.ts`'s
 * `toPersistable` returns `null` for this kind unconditionally).
 */
function PersistExplainerBubble() {
  const t = useTranslations('chat.persist')
  return (
    <div
      className="flex flex-col gap-2 rounded-lg rounded-bl-[4px] bg-primary-soft px-4 py-3 text-base leading-[1.6] tracking-[-0.02em] text-foreground dark:bg-card"
      data-testid="chat-persist-explainer"
    >
      <p>{t('explainer')}</p>
    </div>
  )
}

/**
 * reference-app-style streaming reveal (owner's 2026-08-14 request): assistant
 * text types itself out like an AI answering, instead of appearing whole.
 * Returns how many characters of the bubble's text are visible so far.
 * Instant (`MAX_SAFE_INTEGER`) for restored history bubbles (`db-` ids —
 * those were already "said" in a past session) and under
 * prefers-reduced-motion.
 */
function useTypewriter(
  total: number,
  messageId: string,
): [shown: number, animated: boolean] {
  // Decided once per mounted bubble — re-renders (and StrictMode's double
  // invoke) never restart a reveal already under way.
  const [enabled] = useState(
    () =>
      !messageId.startsWith('db-') &&
      typeof window !== 'undefined' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [shown, setShown] = useState(enabled ? 0 : Number.MAX_SAFE_INTEGER)
  useEffect(() => {
    if (!enabled || total === 0) {
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      // ~70 chars/s after a short beat: quick enough to never feel like
      // waiting, slow enough to read as typing.
      const next = Math.floor(((now - start - 120) / 1000) * 70)
      setShown(Math.max(next, 0))
      if (next < total) {
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled, total])
  return [shown, enabled]
}

function AnswerBubble({
  lines,
  messageId,
  testId,
}: {
  lines: AnswerLine[]
  messageId: string
  testId?: string
}) {
  const t = useTranslations()
  // Every line's text is resolved up front so the reveal budget (total
  // character count) is known before any markup is built. A plain text
  // line costs its own length; a chip/link line costs 1 — it pops in as a
  // unit once the stream reaches it, since typing out a BUTTON label
  // char-by-char would read as broken, not as typing.
  const resolved = lines.map((line) => {
    const values = line.values ? { ...line.values } : undefined
    if (values && MONEY_KEYS.has(line.key)) {
      values.amount = formatMinor(
        BigInt(values.amount as string),
        values.currency as string,
      )
    }
    return { line, text: t(line.key, values) }
  })
  const costs = resolved.map(({ line, text }) =>
    line.href === undefined && line.onSelect === undefined ? text.length : 1,
  )
  const total = costs.reduce((sum, cost) => sum + cost, 0)
  const [shown, animated] = useTypewriter(total, messageId)

  // The bubble GROWS while it types, past where `ChatTranscript`'s own
  // auto-scroll (which fired when the bubble was still empty) left the
  // viewport — so when a genuinely animated reveal finishes, nudge the
  // now-full bubble back into view once. Restored/reduced-motion bubbles
  // (`animated` false) start complete and must never scroll on mount.
  const bubbleRef = useRef<HTMLDivElement>(null)
  const revealDone = animated && total > 0 && shown >= total
  useEffect(() => {
    if (!revealDone) {
      return
    }
    bubbleRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [revealDone])

  // Consecutive suggestion-chip lines are grouped into one flex-wrap row
  // (## Chat-surface mapping "Suggestion chip": "wrap gracefully") instead
  // of each stacking as its own full-width line — plain text and the
  // GUIDED escape link still render one per line. Every testid stays where
  // it was; only the grouping wrapper is new.
  const rendered: ReactNode[] = []
  let chipBuffer: ReactNode[] = []
  const flushChips = (key: string) => {
    if (chipBuffer.length === 0) {
      return
    }
    rendered.push(
      <div key={`chips-${key}`} className="flex flex-wrap gap-2">
        {chipBuffer}
      </div>,
    )
    chipBuffer = []
  }
  let offset = 0
  resolved.forEach(({ line, text: fullText }, index) => {
    const lineStart = offset
    offset += costs[index]
    // The stream hasn't reached this line yet — neither has any later
    // line (offsets are monotonic), so they all skip the same way.
    if (shown <= lineStart) {
      return
    }
    // Reveal only what's been "typed" of a plain text line so far.
    const text =
      line.href === undefined && line.onSelect === undefined
        ? fullText.slice(0, shown - lineStart)
        : fullText
    if (line.href !== undefined) {
      flushChips(String(index))
      rendered.push(
        <NavLink
          key={index}
          href={line.href}
          caption={text}
          testId={`chat-guided-escape-${messageId}`}
          className="w-fit text-sm font-medium text-primary underline"
        >
          {text}
        </NavLink>,
      )
      return
    }
    if (line.onSelect === undefined) {
      flushChips(String(index))
      rendered.push(<p key={index}>{text}</p>)
      return
    }
    const suffix = line.key.split('.').pop()
    // Suggestion chip: PITCH_TEARDOWN.md ## Chat-surface mapping — 8px
    // radius (`rounded-sm` = `--radius-sm`, the derived chip step), 600
    // weight (the one place the measured reference uses it), 44px tap
    // target (`size="touch"`, this app's own floor — the reference's own
    // chip is far shorter, but it's decorative marketing chrome, not a
    // touch target). Press/hover recipe reused verbatim from the `outline`
    // variant Task 4 already swept, for the same token vocabulary as every
    // other control in the app rather than a one-off.
    chipBuffer.push(
      <Button
        key={index}
        type="button"
        variant="outline"
        size="touch"
        className="h-11 w-fit rounded-sm px-4 font-semibold"
        onClick={line.onSelect}
        data-testid={`chat-suggestion-${suffix}-${messageId}`}
      >
        {text}
      </Button>,
    )
  })
  flushChips('end')
  return (
    <div
      ref={bubbleRef}
      // Assistant "surface card" fill per the mapping's "Assistant bubble"
      // row: `surface-tint` (light) / a lighter-than-background fill
      // (dark, this app's own --card — already derived as "canvas-deep
      // lightened one step", the same relationship the teardown's
      // `glass-tint`-over-canvas-deep recipe describes). 16px radius, tail
      // corner (bottom-left — assistant is left-aligned) pulled to 4px.
      // scroll-mb mirrors the transcript wrapper's own dock clearance —
      // the reveal-done scrollIntoView above targets THIS div, and scroll
      // margins are only read off the element being scrolled to.
      className="flex flex-col gap-2 rounded-lg rounded-bl-[4px] bg-primary-soft px-4 py-3 text-base leading-[1.6] tracking-[-0.02em] text-foreground scroll-mb-[calc(6rem+env(safe-area-inset-bottom))] dark:bg-card"
      data-testid={testId ?? 'chat-answer'}
    >
      {rendered}
    </div>
  )
}

function SavedBubble({
  title,
  receiptTotal,
  groupId,
}: {
  title: string | null
  receiptTotal: string | null
  groupId: string
}) {
  const t = useTranslations('chat')
  const tHistory = useTranslations('history')
  const tLoading = useTranslations('loading')
  return (
    <div
      // Same assistant "surface card" fill/radius as AnswerBubble — see the
      // comment there.
      className="flex flex-col gap-2 rounded-lg rounded-bl-[4px] bg-primary-soft px-4 py-3 text-base leading-[1.6] tracking-[-0.02em] text-foreground dark:bg-card"
      data-testid="chat-saved-summary"
    >
      {title !== null && receiptTotal !== null ? (
        <p className="flex flex-wrap items-baseline gap-x-1.5 text-base">
          {/* The RECEIPT TOTAL — what the user typed and saved — not their
              own share of it; those differ the moment a chat expense splits
              between more than one person. Split into its own span so the
              amount can be prominent and tabular (## Chat-surface mapping
              "Saved bubble": "amounts prominent, tabular") without also
              bolding the title. */}
          <span className="font-medium">{title}</span>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span className="font-mono text-lg font-semibold">
            {receiptTotal}
          </span>
        </p>
      ) : null}
      <p className="text-muted-foreground">{t('savedSummary')}</p>
      {/* Quiet link, not a button (## Chat-surface mapping): plain
          underlined text at the `meta`/link scale (14px), no fill, no
          border. */}
      <NavLink
        href={`/groups/${groupId}/history`}
        caption={tLoading('general')}
        testId="chat-saved-history-link"
        className="w-fit text-sm font-medium text-primary underline"
      >
        {tHistory('title')}
      </NavLink>
    </div>
  )
}

function RecalcBubble({
  id,
  groupId,
  message,
  dismissLabel,
  action,
}: {
  id: string
  groupId: string
  message: string
  dismissLabel: string
  action: (formData: FormData) => Promise<void>
}) {
  const { removeMessage } = useChatTranscript()
  return (
    <RecalcBanner
      action={action}
      groupId={groupId}
      message={message}
      dismissLabel={dismissLabel}
      onDismissed={() => removeMessage(id)}
    />
  )
}

function draftFormHref(
  groupId: string,
  amount: string,
  note: string,
  currency: string,
): string {
  const params = new URLSearchParams({
    draftAmount: amount,
    draftNote: note,
    draftCurrency: currency,
  })
  return `/groups/${groupId}/expenses/new?${params.toString()}`
}

/**
 * One expense, said back to the user: what it was called, what it cost, and
 * when it was. Task 10 (context commands) — the confirm card's TARGET line and
 * every row of the disambiguation list use the same one, because "which
 * expense is this about" has to read identically whether the assistant picked
 * it or the user is picking it.
 *
 * The instant is rendered in the DEVICE's offset (captured when the card
 * opened), never the server's — the Phase 3C rule, same as `src/lib/datetime.ts`.
 */
function EditTargetLine({
  target,
  tzOffsetMinutes,
}: {
  target: EditTargetView
  tzOffsetMinutes: number
}) {
  const locale = useLocale()
  return (
    <>
      <span className="min-w-0 truncate font-medium">{target.note}</span>
      <span className="ml-auto shrink-0 font-mono tabular-nums">
        {formatMinor(target.amountMinor, target.currency)}
      </span>
      <span className="w-full text-xs text-muted-foreground">
        {formatLocalDateTime(target.timestamp, tzOffsetMinutes, locale)}
      </span>
    </>
  )
}

/** The `confirmEdit` card's question, one key per action (spec: the copy names
 *  both WHO/WHAT changes and WHICH expense it changes).
 *
 *  F-T4: the currency SWAP asks for two things at once — cancelling this
 *  expense and creating its replacement — so it is the one ask that carries a
 *  second line. The question names both sides (₩4,000 → ¥4,000) and the line
 *  below states what is kept and that the new expense is priced afresh, because
 *  agreeing to a re-calculation the card never mentioned is exactly the
 *  confidently-wrong edit this whole flow refuses to make. */
function EditQuestion({ ask, note }: { ask: EditAskView; note: string }) {
  const t = useTranslations('chat.edit')
  if (ask.kind === 'currencySwap') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-base" data-testid="chat-edit-question">
          {t('currencySwap.question', {
            note,
            from: formatMinor(ask.fromMinor, ask.fromCurrency),
            to: formatMinor(ask.toMinor, ask.toCurrency),
          })}
        </p>
        <p
          className="text-sm text-muted-foreground"
          data-testid="chat-edit-swap-detail"
        >
          {t('currencySwap.detail')}
        </p>
      </div>
    )
  }
  const text =
    ask.kind === 'add'
      ? t('confirmAdd', { name: ask.name, note })
      : ask.kind === 'remove'
        ? t('confirmRemove', { name: ask.name, note })
        : ask.kind === 'amount'
          ? t('confirmAmount', {
              note,
              amount: formatMinor(ask.amountMinor, ask.currency),
            })
          : t('confirmCancel', { note })
  return (
    <p className="text-base" data-testid="chat-edit-question">
      {text}
    </p>
  )
}

/**
 * The composer's one live outcome card — multiAmount, askAmount, confirm,
 * confirmItems, or (Task 10) one of the two context-command cards.
 * Same markup and testids as before Task 6 (spec §5.5(a) moved WHERE this
 * renders, not what it renders); `card` supplies every value and callback,
 * `ChatComposer` owns none of this JSX any more.
 */
function OutcomeCard({ card }: { card: CardPayload }) {
  const t = useTranslations('chat')
  const tForm = useTranslations('expenses.form')
  // Unconditional (Rules of Hooks) even though only the `confirmItems`
  // branch below reads it.
  const tItems = useTranslations('chat.items')
  // Task 10. `tRoot` is the no-namespace translator the `blockedKey` needs:
  // that key arrives fully qualified (`chat.edit.currencyBlocked`), the same
  // way `AnswerBubble` receives every answer-line key — server-decided reasons
  // travel as keys, never as resolved text, so they persist and re-render in
  // whichever locale is reading them.
  const tEdit = useTranslations('chat.edit')
  const tRoot = useTranslations()
  const tHistory = useTranslations('history')
  const tLoading = useTranslations('loading')
  // The expense detail screen's own "edit this expense" label — a blocked
  // card links to exactly that screen, so it says what that screen says.
  const tDetail = useTranslations('expenses.detail')

  if (card.kind === 'multiAmount') {
    return (
      // A2 review guard: never a confident single-amount card for a
      // multi-item sentence — same shape as the old crossCurrency card
      // (message + wizard escape + Cancel), for the same reason: a notice,
      // never a dead end.
      <Card data-testid="chat-multi-amount-card" className="chat-card-enter">
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>{t('multiAmountNotice')}</p>
          <div className="flex flex-wrap gap-2">
            <NavLink
              href={card.openFormHref}
              caption={t('openForm')}
              testId="chat-open-form"
              className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground active:scale-[0.97]"
            >
              {t('openForm')}
            </NavLink>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={card.onCancel}
              data-testid="chat-cancel"
            >
              {t('cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (card.kind === 'walletCreate') {
    return (
      <Card data-testid="chat-wallet-card" className="chat-card-enter">
        <CardContent className="flex flex-col gap-4 text-sm">
          <h2 className="text-2xl leading-[1.2] font-bold tracking-[-0.02em]">
            {t('wallet.title')}
          </h2>

          <div className="flex flex-col gap-1.5">
            <Label id="chat-wallet-currency-label">{t('wallet.currencyLabel')}</Label>
            <ToggleGroup
              type="single"
              value={card.currency ?? ''}
              onValueChange={(value) => {
                if (value) card.onCurrencyChange(value)
              }}
              variant="outline"
              className="flex-wrap"
              aria-labelledby="chat-wallet-currency-label"
              data-testid="chat-wallet-currency"
            >
              {card.currencyOptions.map((code) => (
                <ToggleGroupItem
                  key={code}
                  value={code}
                  data-testid={`chat-wallet-currency-${code}`}
                >
                  {code}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label id="chat-wallet-type-label">{t('wallet.typeLabel')}</Label>
            <ToggleGroup
              type="single"
              value={card.walletType ?? 'CASH'}
              onValueChange={(value) => {
                if (value)
                  card.onTypeChange(value as 'CASH' | 'TRAVEL_CARD' | 'OTHER_PREPAID')
              }}
              variant="outline"
              className="flex-wrap"
              aria-labelledby="chat-wallet-type-label"
              data-testid="chat-wallet-type"
            >
              <ToggleGroupItem value="CASH" data-testid="chat-wallet-type-cash">
                {t('wallet.typeCash')}
              </ToggleGroupItem>
              <ToggleGroupItem value="TRAVEL_CARD" data-testid="chat-wallet-type-card">
                {t('wallet.typeCard')}
              </ToggleGroupItem>
              <ToggleGroupItem value="OTHER_PREPAID" data-testid="chat-wallet-type-prepaid">
                {t('wallet.typePrepaid')}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-wallet-label">{t('wallet.labelLabel')}</Label>
            <Input
              id="chat-wallet-label"
              value={card.label}
              placeholder={t('wallet.labelPlaceholder')}
              onChange={(event) => card.onLabelChange(event.target.value)}
              className="h-11"
              data-testid="chat-wallet-label"
            />
          </div>

          {card.error !== null ? (
            <p
              role="alert"
              className="rounded-xl bg-negative-soft p-4 text-sm text-negative"
              data-testid="chat-wallet-error"
            >
              {card.error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="touch"
              disabled={card.saving}
              onClick={card.onCreate}
              data-testid="chat-wallet-create"
            >
              {t('wallet.create')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={card.onCancel}
              data-testid="chat-wallet-cancel"
            >
              {t('cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (card.kind === 'askAmount') {
    return (
      <Card data-testid="chat-ask-amount-card" className="chat-card-enter">
        <CardContent className="flex flex-col gap-3 text-sm">
          <Label htmlFor="chat-ask-amount-input">{t('askAmount')}</Label>
          <div className="flex items-center gap-2">
            <Input
              id="chat-ask-amount-input"
              inputMode="decimal"
              value={card.value}
              onChange={(event) => card.onChange(event.target.value)}
              aria-invalid={card.invalid}
              className="h-11"
              data-testid="chat-ask-amount-input"
            />
            <Button
              type="button"
              size="touch"
              onClick={card.onSubmit}
              data-testid="chat-ask-amount"
            >
              {t('askAmountSubmit')}
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            className="w-fit"
            onClick={card.onCancel}
            data-testid="chat-cancel"
          >
            {t('cancel')}
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (card.kind === 'disambiguate') {
    // Never acts: every row opens the CONFIRM card for that expense. The
    // history link is the escape for "none of these" — the same quiet
    // underlined link the saved bubble uses, not a competing button.
    return (
      <Card data-testid="chat-disambiguate-card" className="chat-card-enter">
        <CardContent className="flex flex-col gap-3 text-sm">
          <p data-testid="chat-edit-prompt">
            {card.found ? tEdit('whichOne') : tEdit('noneFound')}
          </p>
          <div className="flex flex-col gap-2">
            {card.candidates.map((candidate) => (
              <Button
                key={candidate.id}
                type="button"
                variant="outline"
                size="touch"
                className="h-auto flex-wrap justify-start gap-x-2 gap-y-0.5 px-4 py-3 text-left"
                onClick={() => card.onPick(candidate.id)}
                data-testid="chat-edit-candidate"
              >
                <EditTargetLine
                  target={candidate}
                  tzOffsetMinutes={card.tzOffsetMinutes}
                />
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <NavLink
              href={card.historyHref}
              caption={tLoading('general')}
              testId="chat-edit-history"
              className="w-fit text-sm font-medium text-primary underline"
            >
              {tHistory('title')}
            </NavLink>
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={card.onCancel}
              data-testid="chat-cancel"
            >
              {t('cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (card.kind === 'confirmEdit') {
    return (
      <Card data-testid="chat-confirm-edit-card" className="chat-card-enter">
        <CardContent className="flex flex-col gap-3 text-sm">
          <EditQuestion ask={card.ask} note={card.target.note} />
          {/* The TARGET, in full. An edit the user cannot see the subject of
              is exactly the confidently-wrong edit this whole flow exists to
              refuse — so the note, the amount and the day are all stated
              before anything is agreed to. */}
          <div
            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl bg-muted px-4 py-3"
            data-testid="chat-edit-target"
          >
            <EditTargetLine
              target={card.target}
              tzOffsetMinutes={card.tzOffsetMinutes}
            />
          </div>
          {card.blockedKey !== null ? (
            <p
              role="alert"
              className="rounded-xl bg-notice-soft p-4 text-sm text-notice"
              data-testid="chat-edit-blocked"
            >
              {tRoot(card.blockedKey)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {card.blockedKey === null ? (
              <Button
                type="button"
                size="touch"
                onClick={card.onConfirm}
                disabled={card.pending}
                data-testid="chat-edit-confirm"
              >
                {tEdit('apply')}
              </Button>
            ) : null}
            {/* Only ever offered where the edit can genuinely be made — see
                `editHref` on the payload. A blocked card with no `editHref`
                (a currency change) carries its instructions in the notice
                above instead of a link that would dead-end again. */}
            {card.editHref !== null ? (
              <NavLink
                href={card.editHref}
                caption={tDetail('edit')}
                testId="chat-edit-open-form"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium active:scale-[0.97]"
              >
                {tDetail('edit')}
              </NavLink>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="touch"
              onClick={card.onCancel}
              data-testid="chat-cancel"
            >
              {t('cancel')}
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (card.kind === 'confirmItems') {
    const nameOfItems = (id: string): string =>
      card.members.find((m) => m.id === id)?.name ?? ''

    return (
      <div className="flex flex-col gap-3" data-testid="chat-confirm-items-card">
        <Card className="chat-card-enter">
          <CardContent className="flex flex-col gap-4 text-sm">
            {/* Task 3, spec item 5 ("내용" → "제목"): same title-style
                heading treatment as the ordinary confirm card, just above a
                `ChatAssignCard` instead of a single amount. */}
            <h2 className="text-2xl leading-[1.2] font-bold tracking-[-0.02em]">
              {t('confirmTitle')}
            </h2>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-description">{t('descriptionLabel')}</Label>
              <Input
                id="chat-description"
                value={card.description}
                onChange={(event) =>
                  card.onDescriptionChange(event.target.value)
                }
                className="h-11"
                data-testid="chat-description"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat-payer" className="sr-only">
                {tForm('payer')}
              </Label>
              <Select value={card.payerId} onValueChange={card.onPayerChange}>
                <SelectTrigger
                  id="chat-payer"
                  className="h-11 w-fit"
                  data-testid="chat-payer"
                >
                  <SelectValue>
                    {t('paidBy', { name: nameOfItems(card.payerId) })}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {card.members.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.id === card.actorId
                        ? tForm('payerMe', { name: m.name })
                        : m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* A2 parity: the same "where did this money come from" section
                the ordinary confirm card shows, asked only when this
                sentence's currency differs from the group's settlement
                currency. */}
            {card.funding.show ? (
              <div className="flex flex-col gap-1.5">
                <Label id="chat-funding-label">{t('funding.label')}</Label>
                <ToggleGroup
                  type="single"
                  value={card.funding.choice}
                  onValueChange={(value) => {
                    if (value) card.funding.onChoiceChange(value)
                  }}
                  variant="outline"
                  className="flex-wrap"
                  aria-labelledby="chat-funding-label"
                  data-testid="chat-funding-section"
                >
                  <ToggleGroupItem
                    value="PAY_AS_YOU_GO"
                    data-testid="chat-funding-onspot"
                  >
                    {t('funding.onTheSpot')}
                  </ToggleGroupItem>
                  {card.funding.wallets.map((wallet) => (
                    <ToggleGroupItem
                      key={wallet.id}
                      value={wallet.id}
                      data-testid={`chat-funding-wallet-${wallet.id}`}
                    >
                      {t('funding.wallet', { label: wallet.label })}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label id="chat-participants-label">
                {tForm('participants')}
              </Label>
              <ToggleGroup
                type="multiple"
                value={card.participantIds}
                onValueChange={card.onParticipantsChange}
                className="flex flex-wrap"
                aria-labelledby="chat-participants-label"
              >
                {card.members.map((m) => (
                  <ToggleGroupItem
                    key={m.id}
                    value={m.id}
                    variant="outline"
                    data-testid={`chat-participant-${m.id}`}
                  >
                    {m.name}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </CardContent>
        </Card>

        {/* The wizard's StepAssign screen, inlined (Task 2/3) — item rows,
            per-line and grand totals (`tItems('summary')`), assignment. */}
        <ChatAssignCard
          items={card.items}
          onItemsChange={card.onItemsChange}
          members={card.members}
          participantIds={card.participantIds}
          payerId={card.payerId}
          currency={card.currency}
        />

        <Card className="chat-card-enter">
          <CardContent className="flex flex-col gap-3 text-sm">
            {card.duplicate ? (
              <p
                role="alert"
                className="rounded-xl bg-notice-soft p-4 text-sm text-notice"
                data-testid="chat-duplicate"
              >
                {t('duplicateAsk')}
              </p>
            ) : null}
            {card.error !== null ? (
              <p
                role="alert"
                className="rounded-xl bg-negative-soft p-4 text-sm text-negative"
                data-testid="chat-error"
              >
                {card.error}
              </p>
            ) : null}
            {card.unpricedCount > 0 ? (
              <p
                className="rounded-xl bg-notice-soft p-4 text-sm text-notice"
                data-testid="chat-items-price-missing"
              >
                {tItems('priceMissing', { count: card.unpricedCount })}
              </p>
            ) : null}
            <form action={card.formAction} className="flex flex-wrap gap-2">
              <SubmitButton
                size="touch"
                testId="chat-confirm-save"
                overlay={false}
                disabled={card.unpricedCount > 0}
              >
                {tItems('confirm')}
              </SubmitButton>
              {card.duplicate ? (
                <SubmitButton
                  size="touch"
                  variant="outline"
                  onClick={card.onSaveAnyway}
                  testId="chat-confirm-save-anyway"
                >
                  {tForm('saveAnyway')}
                </SubmitButton>
              ) : null}
              <NavLink
                href={card.openFormHref}
                caption={t('openForm')}
                testId="chat-open-form"
                className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium active:scale-[0.97]"
              >
                {t('openForm')}
              </NavLink>
              <Button
                type="button"
                variant="ghost"
                size="touch"
                onClick={card.onCancel}
                data-testid="chat-cancel"
              >
                {t('cancel')}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // card.kind === 'confirm'
  const nameOf = (id: string): string =>
    card.members.find((m) => m.id === id)?.name ?? ''

  return (
    <Card data-testid="chat-confirm-card" className="chat-card-enter">
      <CardContent className="flex flex-col gap-4 text-sm">
        {/* card-title scale (## Type scale): 24px/700, tracking -0.02em. */}
        <h2 className="text-2xl leading-[1.2] font-bold tracking-[-0.02em]">
          {t('confirmTitle')}
        </h2>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="chat-description">{t('descriptionLabel')}</Label>
          <Input
            id="chat-description"
            value={card.description}
            onChange={(event) => card.onDescriptionChange(event.target.value)}
            className="h-11"
            data-testid="chat-description"
          />
        </div>

        {/* Amounts prominent (## Chat-surface mapping "In-bubble card":
            "numbers in --font-geist-mono"). tabular-nums is already global
            (globals.css body rule) but stated here too for clarity. */}
        <p
          className="font-mono text-xl font-semibold tabular-nums"
          data-testid="chat-amount"
        >
          {formatMinor(card.amountMinor, card.currency)}
        </p>

        {/* Task 2: a receipt scan that couldn't fully reconcile (no items,
            or items that didn't sum to the printed total) still opens this
            card — the printed total wins — but says so, once, right under
            the amount it explains. */}
        {card.notice !== undefined ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="chat-scan-notice"
          >
            {card.notice}
          </p>
        ) : null}

        <div className="flex flex-col gap-1.5">
          {/* Visually hidden: the trigger itself reads as "{name} paid",
              which already says what this control is for — a second,
              static "Who paid" caption above it would just repeat that. */}
          <Label htmlFor="chat-payer" className="sr-only">
            {tForm('payer')}
          </Label>
          <Select value={card.payerId} onValueChange={card.onPayerChange}>
            <SelectTrigger
              id="chat-payer"
              className="h-11 w-fit"
              data-testid="chat-payer"
            >
              <SelectValue>
                {t('paidBy', { name: nameOf(card.payerId) })}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {card.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.id === card.actorId
                    ? tForm('payerMe', { name: m.name })
                    : m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* A2: "where did this money come from" — asked only when this
            card's currency differs from the group's settlement currency. A
            same-currency expense has nothing to convert, so it is asked
            nothing new (unchanged from before A2). */}
        {card.funding.show ? (
          <div className="flex flex-col gap-1.5">
            <Label id="chat-funding-label">{t('funding.label')}</Label>
            <ToggleGroup
              type="single"
              value={card.funding.choice}
              onValueChange={(value) => {
                // Radix's single-select toggle group can report '' when the
                // active item is clicked again — never let that clear the
                // choice down to nothing (mirrors `toggleParticipants`'s own
                // "never empty" guard for the same reason).
                if (value) card.funding.onChoiceChange(value)
              }}
              variant="outline"
              className="flex-wrap"
              aria-labelledby="chat-funding-label"
              data-testid="chat-funding-section"
            >
              <ToggleGroupItem
                value="PAY_AS_YOU_GO"
                data-testid="chat-funding-onspot"
              >
                {t('funding.onTheSpot')}
              </ToggleGroupItem>
              {card.funding.wallets.map((wallet) => (
                <ToggleGroupItem
                  key={wallet.id}
                  value={wallet.id}
                  data-testid={`chat-funding-wallet-${wallet.id}`}
                >
                  {t('funding.wallet', { label: wallet.label })}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label id="chat-participants-label">{tForm('participants')}</Label>
          <ToggleGroup
            type="multiple"
            value={card.participantIds}
            onValueChange={card.onParticipantsChange}
            className="flex flex-wrap"
            aria-labelledby="chat-participants-label"
          >
            {card.members.map((m) => (
              <ToggleGroupItem
                key={m.id}
                value={m.id}
                variant="outline"
                data-testid={`chat-participant-${m.id}`}
              >
                {m.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p
            className="text-xs text-muted-foreground"
            data-testid="chat-per-person"
          >
            {card.participantIds.length === card.members.length
              ? `${t('everyone')} · `
              : ''}
            {t('perPerson', {
              amount: formatMinor(card.perPersonAmount, card.currency),
            })}
          </p>
        </div>

        {card.duplicate ? (
          // Notice-token banner, matching the app's own established
          // pattern for this exact box (see e.g.
          // expenses/[expenseId]/page.tsx) rather than a chat-specific
          // one-off.
          <p
            role="alert"
            className="rounded-xl bg-notice-soft p-4 text-sm text-notice"
            data-testid="chat-duplicate"
          >
            {t('duplicateAsk')}
          </p>
        ) : null}
        {card.error !== null ? (
          // Negative-token banner — same upgrade as the notice banner
          // above, replacing the old bare `--destructive` text (a token
          // this redesign no longer uses for banners) with the app's own
          // negative/negative-soft pair.
          <p
            role="alert"
            className="rounded-xl bg-negative-soft p-4 text-sm text-negative"
            data-testid="chat-error"
          >
            {card.error}
          </p>
        ) : null}

        <form action={card.formAction} className="flex flex-wrap gap-2">
          <SubmitButton size="touch" testId="chat-confirm-save" overlay={false}>
            {t('save')}
          </SubmitButton>
          {card.duplicate ? (
            <SubmitButton
              size="touch"
              variant="outline"
              onClick={card.onSaveAnyway}
              testId="chat-confirm-save-anyway"
            >
              {tForm('saveAnyway')}
            </SubmitButton>
          ) : null}
          <NavLink
            href={card.openFormHref}
            caption={t('openForm')}
            testId="chat-open-form"
            className="inline-flex h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium active:scale-[0.97]"
          >
            {t('openForm')}
          </NavLink>
          <Button
            type="button"
            variant="ghost"
            size="touch"
            onClick={card.onCancel}
            data-testid="chat-cancel"
          >
            {t('cancel')}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export { draftFormHref }
