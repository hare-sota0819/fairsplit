import { getTranslations } from 'next-intl/server'
import { markRecalcSeen } from './exchange/actions'
import { RecalcBanner } from './RecalcBanner'
import { ExpenseFeed } from '@/components/ExpenseFeed'
import { formatMinor } from '@/lib/format'
import { buildFeedRows } from '@/lib/feed-rows'
import { loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

/**
 * Home. Placeholder after the chat removal (2026-08-21): the whole
 * conversational entry surface is sealed in `archive/`, and the input flow
 * that replaces it has not been designed yet. Until it is, home shows the
 * group's expense history — the same rows as `history/`, so the screen is
 * never empty of meaning and every other destination still works.
 */
export default async function GroupHomePage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  const { member: me } = await requireGroupMember(groupId)
  const data = await loadGroupData(groupId)
  const { mode } = data
  const [t, tChip] = await Promise.all([
    getTranslations('home'),
    getTranslations('rateChip'),
  ])

  const feedRows = buildFeedRows(data, me.id, t, tChip, formatMinor)

  // Recalc notice: someone else's exchange records landed after my cursor
  // (AVG_COST only — records don't move MARKET-mode numbers).
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

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6" data-testid="home">
      <header>
        <h1 className="text-2xl font-bold">{data.group.name}</h1>
      </header>

      {recalcRecord ? (
        <RecalcBanner
          groupId={groupId}
          action={markRecalcSeen}
          message={t('recalcBanner', { name: recalcRecord.member.name })}
          dismissLabel={t('recalcDismiss')}
        />
      ) : null}

      {feedRows.length === 0 ? (
        <p
          className="px-5 py-12 text-center text-sm text-muted-foreground"
          data-testid="home-empty"
        >
          {t('feedNone')}
        </p>
      ) : (
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground" data-testid="feed-note">
            {t('feedNote')}
          </p>
          <ExpenseFeed
            initialCount={feedRows.length}
            labels={{
              expand: t('feedExpand'),
              open: t('openExpense'),
              none: t('feedNone'),
              receiptTotal: t('feedReceiptTotal'),
              less: t('showLess'),
              more: t('showMore', { count: 0 }),
            }}
            rows={feedRows}
          />
        </section>
      )}
    </main>
  )
}
