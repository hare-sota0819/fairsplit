'use server'

import { cookies } from 'next/headers'
import { auth } from '@/auth'
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  isLocale,
  type Locale,
} from './locale'
import { prisma } from '@/lib/prisma'

/**
 * Change the language.
 *
 * Writes both places on purpose. The cookie is what `request.ts` reads first,
 * so the choice lands on the very next render; the row is what carries it to
 * this person's other devices the next time they sign in there. Writing only
 * the cookie would make the language device-local, which is the exact thing
 * this feature exists to avoid; writing only the row would leave the current
 * device on the old language until its token is reissued.
 *
 * Signed out — on the sign-up screen, say — only the cookie is written, and
 * `signUp` reads it back to stamp the new account.
 */
export async function setLocaleAction(locale: Locale): Promise<void> {
  if (!isLocale(locale)) {
    return
  }
  const store = await cookies()
  store.set(LOCALE_COOKIE, locale, {
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    path: '/',
  })

  const session = await auth()
  if (session?.user?.id) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { locale },
    })
  }
}
