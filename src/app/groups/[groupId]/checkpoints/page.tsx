import { getTranslations } from 'next-intl/server'
import { LocalTime } from '@/components/LocalTime'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { createCheckpoint } from './actions'
import { CheckpointForm } from './CheckpointForm'

/**
 * Checkpoint management. A checkpoint is a barrier: everything behind it is
 * settled, and its numbers stop responding to anything entered afterwards.
 *
 * Plain shadcn, no visual design — this phase's success criterion is that the
 * flow can be executed end to end, not that it looks finished.
 */
export default async function CheckpointsPage({
  params,
}: {
  params: Promise<{ groupId: string }>
}) {
  const { groupId } = await params
  await requireGroupMember(groupId)
  const [checkpoints, t] = await Promise.all([
    prisma.checkpoint.findMany({
      where: { groupId },
      orderBy: { timestamp: 'desc' },
      include: {
        createdBy: { select: { name: true } },
        _count: { select: { frozenExpenses: true } },
      },
    }),
    getTranslations('checkpoints'),
  ])

  return (
    <main className="flex flex-1 flex-col gap-6 px-5 py-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('createHeading')}</h2>
        <CheckpointForm action={createCheckpoint} groupId={groupId} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t('listHeading')}</h2>
        {checkpoints.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="checkpoints-empty"
          >
            {t('empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="checkpoint-list">
            {checkpoints.map((checkpoint) => (
              <li
                key={checkpoint.id}
                className="flex flex-col gap-1 border-b border-border pb-3"
              >
                <span className="font-medium">{checkpoint.name}</span>
                <span className="text-xs text-muted-foreground">
                  <LocalTime iso={checkpoint.timestamp.toISOString()} />
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('frozenCount', {
                    count: checkpoint._count.frozenExpenses,
                  })}
                  {checkpoint.createdBy
                    ? ` · ${t('drawnBy', { name: checkpoint.createdBy.name })}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
