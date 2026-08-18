'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import { resolveTripDestination } from '@/lib/trip-destination'
import { requireGroupMember } from '@/lib/membership'
import { prisma } from '@/lib/prisma'
import { receiptImageStoreFromEnv } from '@/lib/receipts/storage'

export interface SettingsFormState {
  error?: string
  saved?: boolean
}

const groupSettingsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  currency: z.string(),
  rateMode: z.enum(['AVG_COST', 'MARKET']),
})

export async function updateGroupSettings(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const parsed = groupSettingsSchema.safeParse({
    name: formData.get('name')?.toString(),
    currency: formData.get('currency')?.toString(),
    rateMode: formData.get('rateMode')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }

  // The country is the answer; the currency is derived from it. Same rule as
  // group creation, in the same pure function, so the two screens cannot
  // drift apart.
  const trip = resolveTripDestination(
    formData.get('tripCountry')?.toString(),
    formData.get('tripCity')?.toString(),
  )

  // Settlement currency locks as soon as any expense exists (its snapshots
  // are denominated in it).
  const expenseCount = await prisma.expense.count({ where: { groupId } })
  const currencyChange =
    expenseCount === 0 &&
    (CURATED_CURRENCIES as readonly string[]).includes(parsed.data.currency)
      ? { settlementCurrency: parsed.data.currency }
      : {}

  await prisma.group.update({
    where: { id: groupId },
    data: {
      name: parsed.data.name,
      rateMode: parsed.data.rateMode,
      tripCurrency: trip.currency,
      tripCountry: trip.country,
      tripCity: trip.city,
      ...currencyChange,
    },
  })
  // Deliberately NO revalidatePath here, unlike the two actions below.
  //
  // It was redundant and actively harmful. Every group route is dynamic
  // (`ƒ` in the build output) and this app sets no `staleTimes`, so Next
  // refetches these segments on navigation anyway — measured: rename the
  // group, navigate to home client-side, and the new name is already there
  // without it. What it DID do was force the current tree to re-render as
  // part of the action's response, which raced the "Saved." confirmation
  // rendered from this action's own state. Roughly half of all runs lost
  // that race, so a save that worked showed the user nothing.
  //
  // See docs/SOLVED.md 2026-08-03. Removing the client's router.refresh()
  // was only half the fix; this was the other half.
  return { saved: true }
}

const memberActionSchema = z.object({
  memberId: z.string().min(1),
  name: z.string().trim().min(1).max(100),
})

/** Rename only. Deactivation was removed — see "leave group" instead. */
export async function updateMember(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const parsed = memberActionSchema.safeParse({
    memberId: formData.get('memberId')?.toString(),
    name: formData.get('name')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  const member = await prisma.member.findFirst({
    where: { id: parsed.data.memberId, groupId },
  })
  if (!member) {
    return { error: t('invalidInput') }
  }
  await prisma.member.update({
    where: { id: member.id },
    data: { name: parsed.data.name },
  })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true }
}

const walletHiddenSchema = z.object({ hidden: z.enum(['true', 'false']) })

/**
 * Wallet privacy is strictly self-service: the flag always lands on the
 * acting member resolved by the guard, never on a posted memberId.
 */
export async function setWalletHidden(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)
  const t = await getTranslations('groups.errors')

  const parsed = walletHiddenSchema.safeParse({
    hidden: formData.get('hidden')?.toString(),
  })
  if (!parsed.success) {
    return { error: t('invalidInput') }
  }
  await prisma.member.update({
    where: { id: member.id },
    data: { walletHidden: parsed.data.hidden === 'true' },
  })
  revalidatePath(`/groups/${groupId}`, 'layout')
  return { saved: true }
}

/**
 * Hard delete. Expense.enteredById and ChatMessage.memberId/groupId are both
 * ON DELETE RESTRICT, so the expense rows and chat message rows must go
 * before the members/group they point at; everything else (members, items,
 * participants, assignments, exchange records, checkpoints) cascades from the
 * group. Soft delete was rejected deliberately: with no restore UI it would
 * only leave unreachable rows behind, and it would push a `deletedAt: null`
 * filter into every membership check, where one omission is a security hole.
 */
async function deleteGroupRows(groupId: string): Promise<void> {
  // Collected BEFORE the rows go, because after the transaction there is
  // nothing left to say which objects belonged to this group (brief §173).
  const withPhotos = await prisma.expense.findMany({
    where: { groupId, receiptImagePath: { not: null } },
    select: { receiptImagePath: true },
  })

  // Order matters: ChatMessage -> ChatSession -> Group. Messages point at
  // sessions and both point at group/member with the default RESTRICT (see
  // the schema comment above ChatMessage), so each has to go before what it
  // references, or the group delete trips the FK inside the same cascade.
  await prisma.$transaction([
    prisma.expense.deleteMany({ where: { groupId } }),
    prisma.chatMessage.deleteMany({ where: { groupId } }),
    prisma.chatSession.deleteMany({ where: { groupId } }),
    prisma.group.delete({ where: { id: groupId } }),
  ])

  // After the transaction, and deliberately not inside it: storage is a
  // separate system with no part in the database transaction, and a failed
  // delete there must not roll back a group deletion the user asked for. The
  // cost of the other ordering would be orphaned rows pointing at objects
  // that are already gone; this way the worst case is a few orphaned KB.
  const paths = withPhotos
    .map((expense) => expense.receiptImagePath)
    .filter((path): path is string => path !== null)
  if (paths.length > 0) {
    await receiptImageStoreFromEnv()?.remove(paths)
  }
}

/**
 * Leaving keeps the member row: expenses point at it as payer, enteredBy and
 * participant, and the balance the leaver walks away with still has to be
 * visible to the people on the other side of it. Only access is severed.
 *
 * The last member out deletes the group instead — a group with no members is
 * invisible on every screen yet still openable by its invite link, and there
 * is nobody left who could ever clean it up.
 */
export async function leaveGroup(formData: FormData): Promise<void> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { member } = await requireGroupMember(groupId)

  const othersRemaining = await prisma.member.count({
    where: {
      groupId,
      leftAt: null,
      userId: { not: null },
      id: { not: member.id },
    },
  })
  if (othersRemaining === 0) {
    await deleteGroupRows(groupId)
  } else {
    await prisma.member.update({
      where: { id: member.id },
      data: { leftAt: new Date() },
    })
  }
  redirect('/')
}

/**
 * Creator-only, and the group's exact name must be typed. There is no undo,
 * so the gate is the safety net.
 */
export async function deleteGroup(
  _prev: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const groupId = formData.get('groupId')?.toString() ?? ''
  const { user } = await requireGroupMember(groupId)
  const t = await getTranslations('settings.danger')

  const group = await prisma.group.findUniqueOrThrow({ where: { id: groupId } })
  if (group.createdById !== user.id) {
    return { error: t('notCreator') }
  }
  if (formData.get('confirmName')?.toString().trim() !== group.name) {
    return { error: t('confirmMismatch') }
  }
  await deleteGroupRows(groupId)
  redirect('/')
}
