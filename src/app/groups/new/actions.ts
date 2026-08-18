'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CURATED_CURRENCIES } from '@/lib/currencies'
import { resolveTripDestination } from '@/lib/trip-destination'
import { requireUser } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export interface GroupFormState {
  error?: string
}

export async function createGroup(
  _prev: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const user = await requireUser('/groups/new')
  const t = await getTranslations('groups.errors')

  const name = formData.get('name')?.toString().trim()
  const currency = formData.get('currency')?.toString() ?? ''
  const displayName = formData.get('displayName')?.toString().trim()
  // "Where are you going?" is answered with a PLACE. The trip currency is
  // derived from it here — never posted by the client — so the two can never
  // disagree, and an unknown country simply means "not decided".
  const trip = resolveTripDestination(
    formData.get('tripCountry')?.toString(),
    formData.get('tripCity')?.toString(),
  )

  if (
    !name ||
    !displayName ||
    !(CURATED_CURRENCIES as readonly string[]).includes(currency)
  ) {
    return { error: t('invalidInput') }
  }

  const group = await prisma.group.create({
    data: {
      name,
      settlementCurrency: currency,
      tripCurrency: trip.currency,
      tripCountry: trip.country,
      tripCity: trip.city,
      // Exchange-rate mode is NOT asked here any more. It is a settlement
      // policy nobody can judge before the trip exists, and it was the third
      // question on a screen that should ask three. The schema default
      // (AVG_COST) stands and group settings can change it any time.
      inviteCode: randomBytes(16).toString('base64url'),
      createdById: user.id,
      members: { create: { name: displayName, userId: user.id } },
    },
  })
  redirect(`/groups/${group.id}`)
}
