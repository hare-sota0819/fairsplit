'use server'

import { AuthError } from 'next-auth'
import { getTranslations } from 'next-intl/server'
import { signIn } from '@/auth'
import type { AuthFormState } from '../signup/actions'

export async function signInWithPassword(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const t = await getTranslations('auth.errors')
  const callbackUrl = formData.get('callbackUrl')?.toString() || '/'
  try {
    await signIn('credentials', {
      email: formData.get('email')?.toString().trim().toLowerCase() ?? '',
      password: formData.get('password')?.toString() ?? '',
      redirectTo: callbackUrl,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: t('badCredentials') }
    }
    throw error // NEXT_REDIRECT on success — must propagate.
  }
  return {}
}

export async function signInWithGoogle(callbackUrl: string): Promise<void> {
  await signIn('google', { redirectTo: callbackUrl || '/' })
}
