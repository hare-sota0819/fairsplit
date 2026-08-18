'use server'

import { signOut } from '@/auth'

/** End the session and land on the marketing/landing page. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/' })
}

/**
 * "Switch account": the same sign-out, but it drops you on the sign-in
 * screen instead of the landing page, because the next thing you want is to
 * sign in as somebody else. There is no multi-session support to switch
 * BETWEEN — pretending otherwise would be a worse lie than one extra tap.
 */
export async function switchAccountAction(): Promise<void> {
  await signOut({ redirectTo: '/signin' })
}
