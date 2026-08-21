// The one definition of "which port and which database does the e2e suite
// use", shared by playwright.config.ts and by the specs that open their own
// Prisma client to seed a row.
//
// It used to be four copies: the config's, plus a private `scratchDatabaseUrl`
// in trip-currency.spec.ts and the other DB-touching specs, each
// with a comment saying it was duplicated because the config's copy was not
// exported. That was survivable while the name was a constant. It stopped
// being survivable the moment the name became configurable (E2E_DB_NAME): the
// server would run against the override while those specs seeded the default
// database — the exact cross-checkout collision the override exists to
// prevent, plus a rate lookup that finds nothing because it was seeded next
// door.
//
// `dotenv/config` is imported here, not only in playwright.config.ts, because
// specs run in worker processes that do not inherit the config module — only
// the real environment. Without it, E2E_PORT/E2E_DB_NAME set in .env would
// reach the app server and not the specs.
import 'dotenv/config'

const DEV_DATABASE_FALLBACK =
  'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'

/** The port `next start` is bound to for the suite. Override to run two
 *  checkouts at once. */
export const E2E_PORT = process.env.E2E_PORT ?? '3100'

if (!/^\d+$/.test(E2E_PORT)) {
  throw new Error(
    `E2E_PORT must be a number, got ${JSON.stringify(E2E_PORT)} — it is interpolated into the webServer command.`,
  )
}

export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`

/**
 * The scratch database URL: the developer's own Postgres host/user/port, with
 * the database name replaced.
 *
 * The name defaults to `<dev database>_e2e` and can be overridden with
 * E2E_DB_NAME. It must still end in `_e2e`: scripts/e2e-db-reset.sh asserts
 * that before it DROPs anything, and that assertion is the only thing between
 * a typo and the developer's real data. Asserting it here too turns a typo
 * into a clear message at config load instead of a confusing failure later.
 */
export function scratchDatabaseUrl(
  devUrl: string = process.env.DATABASE_URL ?? DEV_DATABASE_FALLBACK,
): string {
  const url = new URL(devUrl)
  const devName = url.pathname.replace(/^\//, '')
  const name = process.env.E2E_DB_NAME ?? `${devName}_e2e`
  if (!name.endsWith('_e2e')) {
    throw new Error(
      `E2E_DB_NAME must end in _e2e (got ${JSON.stringify(name)}) — scripts/e2e-db-reset.sh drops this database on every run.`,
    )
  }
  url.pathname = `/${name}`
  return url.toString()
}
