/**
 * The dev-mode allowlist the e2e app server runs with.
 *
 * Its own module, with NO imports: `playwright.config.ts` reads it at
 * config-load time, and pulling `@prisma/client` in for a few strings would
 * turn a missing `prisma generate` into a config-parse failure before any
 * test runs. `e2e/dev-account.ts` re-exports it for the specs, so config and
 * specs cannot drift.
 *
 * Addresses are allocated PER SPEC FILE rather than from one shared list.
 * `User.email` is unique and the scratch database is reset once per RUN, not
 * per test, so two files drawing from a shared list by index collide the
 * moment either grows — which is exactly what happened: `batch-review` and
 * `dev-mode` both took indices 0-2, and the second file to run failed at
 * sign-up with an error that pointed nowhere near the cause. `devEmail`
 * makes the collision impossible instead of merely unlikely.
 *
 * A `.test` TLD is reserved by RFC 2606 and can never resolve, so these
 * addresses cannot exist anywhere but in the scratch database.
 */

/** How many dev accounts each spec file needs. */
const ALLOCATION = {
  mode: 4,
  recall: 8,
  batch: 5,
} as const

export type DevSpec = keyof typeof ALLOCATION

export function devEmail(spec: DevSpec, index: number): string {
  if (index < 0 || index >= ALLOCATION[spec]) {
    throw new Error(
      `dev email ${spec}#${index} is outside the ${ALLOCATION[spec]} allocated to that spec — raise its count in e2e/dev-constants.ts`,
    )
  }
  return `dev-e2e-${spec}-${index}@fairsplit.test`
}

/** Every allocated address, for the server's `DEV_EMAILS` variable. */
export const E2E_DEV_EMAILS: string[] = Object.entries(ALLOCATION).flatMap(
  ([spec, count]) =>
    Array.from({ length: count }, (_, index) =>
      devEmail(spec as DevSpec, index),
    ),
)
