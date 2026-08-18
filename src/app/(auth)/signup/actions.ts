'use server'

import { hash } from 'argon2'
import { getLocale, getTranslations } from 'next-intl/server'
import { signIn } from '@/auth'
import { isLocale } from '@/i18n/locale'
import { safeNext } from '@/lib/next-path'
import { prisma } from '@/lib/prisma'

export interface AuthFormState {
  error?: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations('auth.errors')
  const name = formData.get('name')?.toString().trim()
  const email = formData.get('email')?.toString().trim().toLowerCase()
  const password = formData.get('password')?.toString()
  const callbackUrl = formData.get('callbackUrl')?.toString() || '/'

  if (
    !name ||
    !email ||
    !EMAIL_PATTERN.test(email) ||
    !password ||
    password.length < 8
  ) {
    return { error: t('invalidInput') }
  }
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return { error: t('emailTaken') }
  }
  // The account inherits the language the sign-up form was actually READ in.
  //
  // `getLocale()` and not the cookie: with no cookie the cookie read is
  // undefined, the column falls back to its "ko" default, and somebody who
  // signed up looking at an English form lands in a Korean app. `getLocale()`
  // is the same resolution the page itself just used, so what gets stored is
  // by definition the language the person was looking at.
  const chosen = await getLocale()
  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash: await hash(password),
      ...(isLocale(chosen) ? { locale: chosen } : {}),
    },
  })
  // Throws a redirect on success — lands the user signed in, on the guide.
  //
  // A brand-new account reads the guide once and then continues to wherever
  // it was going (the invited group, or the group list); the guide carries
  // that destination in `?next=`. Signing IN is deliberately untouched — a
  // returning user has already been through this.
  await signIn('credentials', {
    email,
    password,
    redirectTo: `/guide?next=${encodeURIComponent(safeNext(callbackUrl))}`,
  })
  return {}
}
