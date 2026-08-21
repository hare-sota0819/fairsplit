import { cache } from 'react'
import { auth } from '@/auth'
import { prisma } from '@/lib/prisma'
import { accountRole, parseDevAllowlist, type AccountRole } from './role-policy'

/**
 * The server-side role gate (PLAN.md Stage 2, W2 package item 1).
 *
 * SERVER ONLY, and that is the point rather than an implementation detail:
 * the charter's rule is "the role gate lives server-side only; never ship
 * the trace UI hidden in the client bundle". So the role is never a prop, a
 * cookie, a header or anything else a client can read or forge. Every dev
 * surface either (a) is rendered by a server component that called this, or
 * (b) is served by an action/route handler that calls this again itself.
 * (b) is not belt-and-braces: a dev component's chunk can be fetched by hand
 * once it exists in a build, so the DATA endpoints have to hold the line on
 * their own.
 *
 * This module imports `@/auth` and `@/lib/prisma`, so importing it from a
 * client component is a build error rather than a silent leak. There is no
 * `server-only` package in this repo's dependency set to assert that
 * directly, and adding a dependency for a marker import was not worth it.
 *
 * The decision itself lives in `role-policy.ts` (pure, unit-tested); this is
 * only the plumbing that hands it real data.
 */

/**
 * Per-request memo. `cache()` dedupes within one render/request pass, so a
 * page that gates three surfaces on the role runs one query, not three.
 * It does NOT persist across requests, which is what we want: revoking an
 * address from `DEV_EMAILS` must take effect on the next request, not on
 * the next deploy.
 */
export const resolveAccountRole = cache(async (): Promise<AccountRole> => {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return 'user'
  return resolveAccountRoleFor(userId)
})

/**
 * The role for a KNOWN user id — for callers that already resolved the
 * session (the receipt-parse route reads `auth()` for its own reasons, so
 * making it read it twice would be wasteful).
 */
export async function resolveAccountRoleFor(
  userId: string,
): Promise<AccountRole> {
  const allowlist = parseDevAllowlist(process.env.DEV_EMAILS)
  // No allowlist, no query. The common case in production is an empty
  // `DEV_EMAILS`, and nothing can match an empty list.
  if (allowlist.length === 0) return 'user'

  // `emailVerified` alone since D2-17: the OAuth join this query used to
  // carry made the same claim the column now makes for itself, stamped by
  // the `signIn` event in src/auth.ts.
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  })
  if (!account) return 'user'

  return accountRole(
    { email: account.email, emailVerified: account.emailVerified },
    allowlist,
  )
}

/** Convenience predicate for the common `if (!(await isDev())) return` shape. */
export async function isDev(): Promise<boolean> {
  return (await resolveAccountRole()) === 'dev'
}

export type { AccountRole }
