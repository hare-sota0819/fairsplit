'use server'

import { randomBytes } from 'node:crypto'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireUser } from '@/lib/membership'
import { prisma } from '@/lib/prisma'

export interface GroupFormState {
  error?: string
}

/** The locale's home currency: the only thing we can honestly presume. */
const HOME_CURRENCY: Record<string, string> = { ko: 'KRW' }
const FALLBACK_CURRENCY = 'USD'

/**
 * Create a group from ONE answer — its name.
 *
 * Everything the old form asked is derived or deferred instead of asked:
 * - settlement currency <- account locale (changeable in group settings);
 * - member display name <- the account (name, else email local-part, else
 *   the localized "me") — people rename themselves in the group any time;
 * - destination <- not decided yet. It never belonged on this screen: you
 *   can open a ledger before you know where you are going.
 */
export async function createGroup(
  _prev: GroupFormState,
  formData: FormData,
): Promise<GroupFormState> {
  const user = await requireUser('/groups/new')
  const [locale, t, tErrors] = await Promise.all([
    getLocale(),
    getTranslations('groups.new'),
    getTranslations('groups.errors'),
  ])

  const name = formData.get('name')?.toString().trim()
  if (!name) {
    return { error: tErrors('invalidInput') }
  }

  const displayName =
    user.name?.trim() || user.email?.split('@')[0]?.trim() || t('me')

  const group = await prisma.group.create({
    data: {
      name,
      settlementCurrency: HOME_CURRENCY[locale] ?? FALLBACK_CURRENCY,
      tripCurrency: null,
      tripCountry: null,
      tripCity: null,
      // Exchange-rate mode stays the schema default (AVG_COST) — a settlement
      // policy nobody can judge before the trip exists. Group settings can
      // change it any time.
      inviteCode: randomBytes(16).toString('base64url'),
      createdById: user.id,
      members: { create: { name: displayName, userId: user.id } },
    },
  })
  redirect(`/groups/${group.id}`)
}
