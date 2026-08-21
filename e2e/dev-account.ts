import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { devEmail, E2E_DEV_EMAILS } from './dev-constants'
import { scratchDatabaseUrl } from './scratch-db'

export { devEmail, E2E_DEV_EMAILS }

// The one shared derivation of the scratch database (e2e/scratch-db.ts,
// R-W3-3): this file used to keep its own `_e2e`-suffixing copy, which
// ignored E2E_DB_NAME — so with the override set, the dev-mode/recall/
// batch-review specs would have seeded the DEFAULT database while the app
// server ran against the override. Finished at the integration checkpoint.
export function scratchDb(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: scratchDatabaseUrl() }),
  })
}

/**
 * Leaves the database in the state a real Google sign-in leaves it in: a
 * linked identity-provider `Account` row AND a stamped `User.emailVerified`.
 * The e2e suite can only sign up over email/password, which is deliberately
 * NOT verified, so a dev-role test has to seed this by hand.
 *
 * The stamp is what the role gate now reads (DECISIONS D2-17): production
 * writes it from the `signIn` event in `src/auth.ts` on every OAuth/OIDC
 * sign-in, and `src/app/dev/role-policy.ts` tests the column alone. Seeding
 * only the `Account` row would leave a state the app can no longer produce —
 * an OAuth link whose column is still null — and the specs would fail
 * against a fixture, not against a bug.
 *
 * `type: 'oidc'` is not a stylistic choice: it is the literal value
 * `@auth/core` writes for this app's Google provider, and the same value the
 * stamping event matches on. Seeding `'oauth'` here would make the
 * permissions spec pass against a value production never produces — which is
 * exactly how the first cut of the gate shipped broken and green.
 */
export async function linkOAuthAccount(email: string): Promise<void> {
  const db = scratchDb()
  try {
    const user = await db.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    })
    await db.account.create({
      data: {
        userId: user.id,
        type: 'oidc',
        provider: 'google',
        providerAccountId: `e2e-${user.id}`,
      },
    })
    await db.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    })
  } finally {
    await db.$disconnect()
  }
}
