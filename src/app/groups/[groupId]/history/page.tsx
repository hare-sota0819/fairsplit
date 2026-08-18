import { getTranslations } from 'next-intl/server'
import { ExpenseFeed } from '@/components/ExpenseFeed'
import { formatMinor } from '@/lib/format'
import { buildFeedRows } from '@/lib/feed-rows'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'

/**
 * The full expense history for the group — same row markup and i18n keys
 * (`home` namespace) as the old home feed, built from `buildFeedRows`.
 * Server rows only. Home no longer has a feed of its own to merge with
 * (Task 5, app-shell restructure): a chat save now confirms straight in the
 * transcript, from the action's own result, so there is no client-side
 * "pending row" state left to bridge in here.
 */
export default async function GroupHistoryPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const data = await loadGroupData(groupId)
  const [t, tHistory, tChip] = await Promise.all([
    getTranslations('home'),
    getTranslations('history'),
    getTranslations('rateChip'),
  ])

  const feedRows = buildFeedRows(data, me.id, t, tChip, formatMinor)
  // History shows everything it has (no cap passed to buildFeedRows above),
  // so the initial count IS the full list — no "show more" button appears.
  const initialCount = feedRows.length

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          {tHistory('title')}
        </h1>
      </header>

      {feedRows.length === 0 ? (
        <p
          className="px-5 py-12 text-center text-sm text-muted-foreground"
          data-testid="history-empty"
        >
          {tHistory('empty')}
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          {/* The amounts stopped being the receipt totals, so the screen has
              to say so — same note and key as home's feed. */}
          <p className="text-xs text-muted-foreground" data-testid="feed-note">
            {t('feedNote')}
          </p>
          {/* `initialCount` = the full row count: history's whole point is
              to show everything, not a 3-row preview behind a tap. `more`'s
              count is still computed from the difference rather than
              hardcoded, so it stays correct if `initialCount` ever stops
              being the full list. */}
          <ExpenseFeed
            initialCount={initialCount}
            labels={{
              expand: t('feedExpand'),
              open: t('openExpense'),
              none: t('feedNone'),
              receiptTotal: t('feedReceiptTotal'),
              less: t('showLess'),
              more: t('showMore', {
                count: Math.max(0, feedRows.length - initialCount),
              }),
            }}
            rows={feedRows}
          />
        </section>
      )}
    </main>
  )
}
