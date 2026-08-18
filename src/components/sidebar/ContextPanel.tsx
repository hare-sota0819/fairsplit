'use client'

import { useEffect, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { X } from 'lucide-react'
import { NavLink } from '@/components/NavLoader'
import { Button } from '@/components/ui/button'
import { formatMinor } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  fetchExpenseList,
  fetchMyShareBreakdown,
  type ExpenseListRow,
  type MyShareRow,
} from '@/app/groups/[groupId]/chat-query-actions'
import { useSidebar, type ContextPanelState } from './SidebarProvider'

const PANEL_PAGE = 20

/**
 * The desktop context panel — shell phase B (owner, 2026-08-16): "on PC,
 * asking for the history or for what I spent should open a third pane on
 * the right, the way the reference app opens an artifact beside the chat". Rendered by
 * the group shell as a right column at lg+; ChatComposer opens it on
 * QUERY_HISTORY / QUERY_MY_SPENDING (the chat still answers in the bubble
 * — the panel is the fuller view, not a replacement). Data comes from the
 * same server actions the chat's own filtered-history chips already use.
 */
export function ContextPanel({
  groupId,
  memberNames,
}: {
  groupId: string
  /** memberId → display name, for the payer column. */
  memberNames: Record<string, string>
}) {
  const { panel, setPanel } = useSidebar()
  const t = useTranslations('chat.panel')
  const tLoading = useTranslations('loading')
  if (panel === null) return null

  const title =
    panel.kind === 'mySpending'
      ? t('mySpendingTitle')
      : panel.scope === 'mine'
        ? t('mineTitle')
        : t('historyTitle')
  const fullHref =
    panel.kind === 'mySpending'
      ? `/groups/${groupId}/me`
      : `/groups/${groupId}/history`

  return (
    <aside
      // Fixed, full-height, above the header (z-30, same plane as the left
      // rail) — the reference app's artifact panel geometry. The header and the group
      // shell reserve its width while it is open (RailOffset / GroupShell).
      className="fixed inset-y-0 right-0 z-30 hidden w-[26rem] flex-col border-l border-border bg-card lg:flex"
      data-testid="context-panel"
      aria-label={title}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
        <NavLink
          href={fullHref}
          caption={tLoading('general')}
          testId="context-panel-open-full"
          className="rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
        >
          {t('openFull')}
        </NavLink>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('close')}
          data-testid="context-panel-close"
          onClick={() => setPanel(null)}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
        {panel.kind === 'mySpending' ? (
          <MySpendingBody groupId={groupId} />
        ) : (
          <HistoryBody
            key={JSON.stringify(panel)}
            groupId={groupId}
            panel={panel}
            memberNames={memberNames}
          />
        )}
      </div>
    </aside>
  )
}

function HistoryBody({
  groupId,
  panel,
  memberNames,
}: {
  groupId: string
  panel: Extract<ContextPanelState, { kind: 'history' }>
  memberNames: Record<string, string>
}) {
  const t = useTranslations('chat.panel')
  const format = useFormatter()
  const [rows, setRows] = useState<ExpenseListRow[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [totals, setTotals] = useState<Array<{ currency: string; sumMinor: string }>>([])
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async (offset: number) => {
    setLoading(true)
    const result = await fetchExpenseList(groupId, panel.filters, offset, PANEL_PAGE)
    setLoading(false)
    if ('error' in result) return
    setRows((previous) => (offset === 0 ? result.rows : [...previous, ...result.rows]))
    setTotalCount(result.totalCount)
    setTotals(result.totalsByCurrency)
    setNextOffset(result.nextOffset)
  }
  // First page on mount (keyed by the panel state, so a new question
  // remounts and refetches). Every setState above happens after the
  // await — asynchronously, never inside the effect's own tick.
  useEffect(() => {
    void fetchExpenseList(groupId, panel.filters, 0, PANEL_PAGE).then((result) => {
      if ('error' in result) return
      setRows(result.rows)
      setTotalCount(result.totalCount)
      setTotals(result.totalsByCurrency)
      setNextOffset(result.nextOffset)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-3">
      {totalCount !== null ? (
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
          <span>{t('count', { count: totalCount })}</span>
          {totals.length > 0 ? (
            <span className="font-mono tabular-nums">
              {t('total')}{' '}
              {totals
                .map((x) => formatMinor(BigInt(x.sumMinor), x.currency))
                .join(' · ')}
            </span>
          ) : null}
        </p>
      ) : null}
      {totalCount === 0 ? (
        <p className="pt-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : null}
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id}>
            <NavLink
              href={`/groups/${groupId}/expenses/${row.id}`}
              caption={t('historyTitle')}
              className="flex items-baseline gap-3 py-2.5 hover:bg-muted/60"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm">{row.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {memberNames[row.payerId] ?? ''}
                  {' · '}
                  {format.dateTime(new Date(row.timestampIso), {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </span>
              <span className="shrink-0 font-mono text-sm tabular-nums">
                {formatMinor(BigInt(row.amountMinor), row.currency)}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
      {nextOffset !== null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn('mx-auto', loading && 'opacity-60')}
          disabled={loading}
          onClick={() => void load(nextOffset)}
          data-testid="context-panel-more"
        >
          {t('loadMore')}
        </Button>
      ) : null}
    </div>
  )
}

function MySpendingBody({ groupId }: { groupId: string }) {
  const t = useTranslations('chat.panel')
  const [rows, setRows] = useState<MyShareRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchMyShareBreakdown(groupId).then((result) => {
      if (cancelled || 'error' in result) return
      setRows(result.rows)
    })
    return () => {
      cancelled = true
    }
  }, [groupId])
  if (rows === null) return null
  if (rows.length === 0) {
    return <p className="pt-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {rows.map((row, index) => (
        <li key={index} className="flex items-baseline gap-3 py-2.5">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm">{row.title}</span>
            <span className="truncate text-xs text-muted-foreground">
              {row.evenAmong !== null
                ? t('evenAmong', { count: row.evenAmong })
                : row.items.length > 0
                  ? row.items.join(', ')
                  : t('itemised')}
            </span>
          </span>
          <span className="shrink-0 font-mono text-sm tabular-nums">
            {formatMinor(BigInt(row.shareMinor), row.currency)}
          </span>
        </li>
      ))}
    </ul>
  )
}
