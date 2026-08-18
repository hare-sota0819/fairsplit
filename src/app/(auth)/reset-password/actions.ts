'use server'

import { createHash, randomBytes } from 'node:crypto'
import { hash } from 'argon2'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { mailer } from '@/lib/email/mailer'
import { prisma } from '@/lib/prisma'

export interface ResetFormState {
  error?: string
  done?: boolean
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

export async function requestPasswordReset(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const email = formData.get('email')?.toString().trim().toLowerCase()
  // Always report success so account existence can't be probed.
  if (!email) return { done: true }
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return { done: true }

  const token = randomBytes(32).toString('base64url')
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    },
  })
  const requestHeaders = await headers()
  const host = requestHeaders.get('host') ?? 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  await mailer.sendPasswordResetEmail(
    email,
    `${protocol}://${host}/reset-password/${token}`,
  )
  return { done: true }
}

export async function resetPassword(
  _prev: ResetFormState,
  formData: FormData,
): Promise<ResetFormState> {
  const t = await getTranslations('auth')
  const token = formData.get('token')?.toString()
  const password = formData.get('password')?.toString()
  if (!token || !password || password.length < 8) {
    return { error: t('errors.invalidInput') }
  }
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: sha256(token) },
  })
  if (!record || record.expiresAt < new Date()) {
    return { error: t('reset.invalidToken') }
  }
  const passwordHash = await hash(password)
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordResetToken.deleteMany({ where: { userId: record.userId } }),
  ])
  return { done: true }
}
