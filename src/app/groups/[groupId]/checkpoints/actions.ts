'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { planFreeze, type FreezableExpenseRow } from '@/lib/checkpoint-freeze'
import { EXPENSE_INCLUDE, loadGroupData } from '@/lib/group-data'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export interface CheckpointFormState {
  error?: string
  /** How many expenses the new checkpoint pinned, for the confirmation line. */
  frozenCount?: number
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** An ISO instant; the client builds it from the device's own offset. */
  timestamp: z.string().min(1),
})

/**
 * Draw a barrier.
 *
 * Everything before the boundary that is not already pinned is frozen at the
 * rate it converts at RIGHT NOW, in the same transaction that creates the
 * checkpoint. Nothing partial is observable: either the barrier exists with
 * every expense behind it pinned, or it does not exist at all.
 *
 * The arithmetic is `planFreeze` (pure, unit-tested). This function only
 * fetches, writes what the plan says, and revalidates.
 */
export async function createCheckpoint(
  _prev: CheckpointFormState,
  formData: FormData,
): Promise<CheckpointFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('checkpoints')

  const parsed = createSchema.safeParse({
    name: formData.get('name')?.toString(),
    timestamp: formData.get('timestamp')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('errors.invalidInput') }
  }
  const boundary = new Date(parsed.data.timestamp)
  if (Number.isNaN(boundary.getTime())) {
    return { error: t('errors.invalidInput') }
  }

  const [{ mode, context }, rows, clash] = await Promise.all([
    loadGroupData(groupId),
    prisma.expense.findMany({
      where: { groupId },
      include: EXPENSE_INCLUDE,
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    }),
    prisma.checkpoint.findUnique({
      where: { groupId_timestamp: { groupId, timestamp: boundary } },
    }),
  ])
  // `@@unique([groupId, timestamp])` would surface as a Prisma error the user
  // cannot read; two barriers at the same instant is also meaningless.
  if (clash !== null) {
    return { error: t('errors.duplicateTimestamp') }
  }

  const freezable: FreezableExpenseRow[] = rows
  const plans = planFreeze(freezable, boundary, mode, context)
  if (plans.length === 0) {
    return { error: t('errors.nothingToFreeze') }
  }

  await prisma.$transaction(async (tx) => {
    const checkpoint = await tx.checkpoint.create({
      data: {
        groupId,
        name: parsed.data.name,
        timestamp: boundary,
        createdById: member.id,
      },
    })
    for (const plan of plans) {
      for (const portion of plan.portions) {
        await tx.expenseFunding.update({
          where: { id: portion.fundingId },
          data: {
            frozenRateNum: portion.rateNum,
            frozenRateDen: portion.rateDen,
            frozenSource: portion.source,
            frozenAmount: portion.amount,
          },
        })
      }
      // Written LAST for this expense, so the flag that says "pinned" is
      // never true before the rates it promises are there.
      await tx.expense.update({
        where: { id: plan.expenseId },
        data: { frozenAtCheckpointId: checkpoint.id },
      })
    }
  })

  revalidatePath(`/groups/${groupId}`, 'layout')
  return { frozenCount: plans.length }
}
