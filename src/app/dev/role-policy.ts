/**
 * Who counts as a dev account — the pure half of the role gate
 * (PLAN.md Stage 2, W2 package item 1).
 *
 * Split from `role.ts` on purpose: this file reads no session, no database
 * and no environment, so the rule that decides who gets unlimited Gemini
 * scans and the trace panel is unit-testable on its own. `role.ts` is the
 * thin server wrapper that feeds it real data.
 *
 * Two conditions, both required:
 *
 *  1. the address is on the `DEV_EMAILS` allowlist, and
 *  2. the account's address is VERIFIED.
 *
 * Condition 2 is the load-bearing one and it is not decoration: an
 * unlimited-scan role is real Gemini spend, so "sign up with the owner's
 * address and inherit their quota" is a live attack, not a hypothetical.
 * Which is exactly the signup this codebase offers — email + password, no
 * verification mail anywhere in it.
 *
 * ## What "verified" means here (DECISIONS D2-17)
 *
 * Literally `User.emailVerified !== null`, and nothing else.
 *
 * That test used to be unusable: no path in the app ever WROTE the column
 * (`@auth/core` creates an OAuth user with `emailVerified: null`; only the
 * unconfigured `email` magic-link provider stamps a date), so this file
 * carried an OR clause — "… or a linked OAuth account" — that made the
 * claim the column could not. D2-17 gives the column a producer instead:
 * `stampEmailVerified` (src/lib/auth-verified.ts) stamps it on every
 * OAuth/OIDC sign-in, so the two readings agree by construction and the
 * claim is written down in ONE place. Who gets the role is unchanged; PLAN
 * Stage 2's wording ("matched only against verified-email accounts") is now
 * literally true.
 */

export type AccountRole = 'user' | 'dev'

/**
 * `Account.type` values that mean "an identity provider vouched for this
 * address" — read by `stampEmailVerified` (src/lib/auth-verified.ts), which
 * is the only consumer since D2-17 moved the claim out of this file.
 *
 * BOTH are needed and the omission of `'oidc'` is not hypothetical — it
 * silently killed the gate in the first cut of this file. `@auth/core`
 * writes `Account.type` verbatim from the provider's own declared type
 * (`lib/actions/callback/oauth/callback.js`), `@auth/prisma-adapter` stores
 * it unmodified (`linkAccount: (data) => p.account.create({ data })`), and
 * this app's Google provider declares **`type: "oidc"`**, not `"oauth"`
 * (verified at runtime, not read off a doc — see the seam test in
 * role-policy.test.ts). An `'oauth'`-only test therefore matches nothing a
 * Google sign-in ever writes, and the gate fails closed and silent: the
 * owner adds their address to DEV_EMAILS, signs in, and gets nothing, with
 * no error anywhere.
 *
 * `'email'` (magic link) is deliberately absent: that provider stamps
 * `User.emailVerified` itself, so stamping it again would only overwrite a
 * truer timestamp. `'credentials'` is absent because that is exactly the
 * unverified signup this gate exists to refuse.
 */
export const VERIFIED_ACCOUNT_TYPES = ['oauth', 'oidc'] as const

/**
 * Reads the `DEV_EMAILS` allowlist. Comma- or whitespace-separated, so a
 * multi-line value in a `.env` file works as well as a single line.
 *
 * Addresses are lowercased here and compared lowercased below — the app
 * already stores them that way (the credentials `authorize` looks accounts
 * up by `email.trim().toLowerCase()`), and an allowlist that misses because
 * someone typed a capital letter into an env var is a support call, not a
 * security property.
 */
export function parseDevAllowlist(raw: string | null | undefined): string[] {
  if (typeof raw !== 'string') return []
  return [
    ...new Set(
      raw
        .split(/[,\s]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0),
    ),
  ]
}

export interface AccountIdentity {
  email: string | null | undefined
  /** `User.emailVerified` — written by `stampEmailVerified` (D2-17). */
  emailVerified: Date | null | undefined
}

/** The verification half of the gate, isolated so the one claim it makes has
 *  one home (D2-17). */
export function hasVerifiedIdentity(account: AccountIdentity): boolean {
  return account.emailVerified !== null && account.emailVerified !== undefined
}

/**
 * The role this account gets. `user` unless BOTH conditions hold — there is
 * no third state and no "partial" dev.
 */
export function accountRole(
  account: AccountIdentity,
  allowlist: readonly string[],
): AccountRole {
  const email = account.email?.trim().toLowerCase()
  if (!email) return 'user'
  if (!allowlist.includes(email)) return 'user'
  if (!hasVerifiedIdentity(account)) return 'user'
  return 'dev'
}
