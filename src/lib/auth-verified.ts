import { VERIFIED_ACCOUNT_TYPES } from '@/app/dev/role-policy'

/**
 * The producer for `User.emailVerified` (DECISIONS D2-17 / R-W2-R1).
 *
 * Until this existed, NO path in the app ever wrote the column: `@auth/core`
 * creates an OAuth user with `emailVerified: null` (only the unconfigured
 * `email` magic-link provider stamps a date) and the credentials signup does
 * not touch it. The dev role gate therefore had to say "verified OR has a
 * linked OAuth account" — one claim written in two places. D2-17 moves the
 * claim here, so `role-policy.ts` can test the column alone and PLAN Stage
 * 2's wording ("matched only against verified-email accounts") is literally
 * true.
 *
 * It hangs off the `signIn` event rather than `linkAccount` on purpose.
 * `linkAccount` fires only the FIRST time a provider is attached, so an
 * account linked before this code shipped would keep `emailVerified: null`
 * forever and silently lose the dev role — the exact "identical effect
 * today" the ruling rests on. `signIn` fires on every OAuth sign-in, so the
 * first sign-in after deploy backfills it.
 *
 * Idempotent by construction: the write is scoped to rows that are still
 * `null`, so re-signing in never moves an existing timestamp.
 */

/** Minimal Prisma surface, injected so the rule is unit-testable with no
 *  database. `prisma` satisfies it structurally. */
export interface VerifiedStampStore {
  user: {
    updateMany(args: {
      where: { id: string; emailVerified: null }
      data: { emailVerified: Date }
    }): Promise<{ count: number }>
  }
}

/** True when this sign-in came through a provider that vouches for the
 *  address. The type set is `VERIFIED_ACCOUNT_TYPES` — never a literal:
 *  Auth.js declares Google as `'oidc'`, not `'oauth'`. */
export function vouchesForEmail(
  account: { type?: string | null } | null | undefined,
): boolean {
  const type = account?.type
  return (
    typeof type === 'string' &&
    (VERIFIED_ACCOUNT_TYPES as readonly string[]).includes(type)
  )
}

/** Stamps `emailVerified` for an OAuth/OIDC sign-in that has none yet.
 *  Returns whether a row was written. */
export async function stampEmailVerified(
  store: VerifiedStampStore,
  message: {
    user: { id?: string | null }
    account?: { type?: string | null } | null
  },
  now: Date = new Date(),
): Promise<boolean> {
  const id = message.user.id
  if (!id) return false
  if (!vouchesForEmail(message.account)) return false
  const { count } = await store.user.updateMany({
    where: { id, emailVerified: null },
    data: { emailVerified: now },
  })
  return count > 0
}
