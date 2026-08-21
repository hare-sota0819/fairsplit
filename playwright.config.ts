import 'dotenv/config'
import { defineConfig } from '@playwright/test'
import { E2E_DEV_EMAILS } from './e2e/dev-constants'
import { E2E_BASE_URL, E2E_PORT, scratchDatabaseUrl } from './e2e/scratch-db'

// Smoke tests run against a production build on a dedicated port, using a
// dedicated scratch database — never the developer's dev DB. See
// docs/BUGS.md 2026-08-07 / 2026-08-09-10: the suite used to share the dev
// database, which accumulated thousands of test accounts/groups over months
// of runs and made group creation slow enough to flake most full-suite
// runs. `fairsplit_e2e` is dropped, recreated and migrated fresh at the
// start of every run instead (scripts/e2e-db-reset.sh), so this is
// deterministic no matter how much e2e history exists.
//
// The URL is derived from DATABASE_URL (loaded from .env by `dotenv/config`
// above) rather than hand-typed, so it always tracks whatever host/user/port
// the developer's local Postgres actually uses.
// The port and the scratch database name are env-overridable (E2E_PORT /
// E2E_DB_NAME) so two checkouts of this repo — parallel worker branches, a
// worktree next to the main clone — can run the suite at the same time
// without stealing each other's port or DROPping each other's database
// mid-run. Unset means today's values exactly, so nothing changes for a
// single-checkout developer.
//
// Both live in e2e/scratch-db.ts rather than here, because three specs open
// their own Prisma client against the same database and must agree with this
// file about which one it is.
const e2eDatabaseUrl = scratchDatabaseUrl()

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // One worker, deliberately.
  //
  // The original reason — the settings "Saved." confirmation losing a race —
  // turned out to be a real product bug and is fixed at the source (see
  // docs/SOLVED.md 2026-08-03: a redundant `revalidatePath` was forcing the
  // current tree to re-render on top of the action's own state). Parallel
  // runs are ~2x faster than serial once that is gone.
  //
  // But a SECOND, unrelated parallel-only failure survives it: measured 2
  // failures in 8 runs at `--workers=5`, always `wallet.spec.ts` stalling on
  // a submit button that stays disabled while its server action never
  // resolves, dragging the suite from ~14s to 3 minutes. Serial has been
  // clean across every run since. Until that one is understood, determinism
  // is worth more than the 15 seconds parallelism saves — a gate that is
  // only sometimes green trains everyone to explain failures away, which on
  // this branch already came within one review of shipping two real bugs.
  workers: 1,
  // Server actions revalidate the whole group layout, so a mutation
  // re-renders several database-backed segments; 5s is tight for that on a
  // laptop-class machine.
  expect: { timeout: 15_000 },
  // The suite finds elements by their English text in 192 places. Rather than
  // rewrite all of them, the test browser asks for English: with no locale
  // cookie set, `src/i18n/request.ts` falls back to `Accept-Language`, which
  // Playwright derives from this. Every spec therefore keeps seeing the app in
  // English, and not one selector had to change.
  //
  // The cost was real and used to be worth stating here as "no automated
  // check ever looks at the Korean UI" — no longer true as of
  // e2e/korean.spec.ts (a full Korean walkthrough) and e2e/assistant.spec.ts
  // (most of its suite runs `locale: 'ko-KR'`, since classify()'s Korean
  // lexicon rows need it). Most specs still default to English, and most
  // Korean-locale copy is still only exercised by those two files rather
  // than every spec — that narrower gap remains real.
  use: { baseURL: E2E_BASE_URL, locale: 'en-US' },
  webServer: {
    // Reset the scratch DB, THEN start the app server — chained in one shell
    // command so it runs no matter how Playwright is invoked (verify.sh or a
    // bare `npx playwright test`), and deliberately NOT a `globalSetup`:
    // Playwright starts the webServer plugin before running globalSetup, so
    // a globalSetup-based reset would race the app server's first DB
    // connection instead of preceding it.
    command: `scripts/e2e-db-reset.sh && npx next start -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    // NEVER reuse a running server. `next start` loads the build at boot and
    // a later `npm run build` does not hot-swap it, so a leftover server from
    // an earlier run silently serves stale code. That cost three separate
    // debugging sessions on this branch: it produced 15 failures in specs
    // nobody had touched, an 8.8-minute suite, and twice led to a real bug
    // being written off as a "pre-existing flake" (docs/SOLVED.md
    // 2026-08-03). A few seconds of startup is worth never doubting a result.
    reuseExistingServer: false,
    // Was 60_000: now also covers the scratch DB's DROP/CREATE + migrate
    // deploy ahead of `next start` booting.
    timeout: 120_000,
    // No test may reach a live FX provider. `page.route` only intercepts the
    // BROWSER's call to /api/rates; `getSnapshotRate` runs server-side, so a
    // save that needs a rate would go straight out to the internet. Every
    // spec avoids that by entering a manual override — except the wallet
    // correction, which has no rate field to override. Pointing both
    // providers at a closed port makes the rule the environment's job, and
    // exercises the documented fallback (the wallet's own average cost)
    // rather than leaving it to production.
    //
    // DATABASE_URL/DIRECT_URL here override whatever .env would otherwise
    // supply, for both e2e-db-reset.sh and `next start` (which loads the
    // rest of .env itself — AUTH_SECRET etc. — unaffected by this override).
    env: {
      FXRATESAPI_BASE_URL: 'http://127.0.0.1:9',
      FRANKFURTER_BASE_URL: 'http://127.0.0.1:9',
      DATABASE_URL: e2eDatabaseUrl,
      DIRECT_URL: e2eDatabaseUrl,
      // Dev-mode allowlist (PLAN.md Stage 2). Pinned HERE rather than in
      // `.env` so the permissions spec is reproducible on a fresh clone:
      // `.env` is gitignored, and `verify.sh` only seeds it from
      // `.env.example` when it is missing entirely. The address is the one
      // `e2e/dev-account.ts` exports, so config and specs cannot drift.
      DEV_EMAILS: E2E_DEV_EMAILS.join(', '),
      // D2-3: the chat fallback is rules-only in dev, test AND e2e. The
      // default is keyed off NODE_ENV, and this suite runs a PRODUCTION
      // build (`next start` below) — so without the explicit flag the
      // fallback would be live here, quietly producing cards for exactly
      // the sentences the corpus exists to catch the parser failing on.
      CHAT_FALLBACK_ENABLED: 'false',
    },
  },
})
