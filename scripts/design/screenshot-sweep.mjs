// All-screens screenshot sweep — Task 7 of the design-overhaul-rev2 plan
// (docs/superpowers/plans/2026-08-11-design-overhaul-rev2.md §Task 7).
//
// Boots the app against a disposable scratch database (never the dev DB —
// same guard rule as e2e), seeds one signed-up owner + two joined members +
// four expenses (two via chat, two via the manual wizard) through real UI
// flows (the same helpers e2e specs use — signUp/createGroup/joinGroup),
// then screenshots every route in the brief's list at 390×844, light AND
// dark, into <output-dir>/{light,dark}/<route-slug>.png.
//
// Usage: node scripts/design/screenshot-sweep.mjs <output-dir>
// Requires: a local Postgres reachable via DATABASE_URL (.env), migrated.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '../..')

const OUT_DIR = process.argv[2]
if (!OUT_DIR) {
  console.error('Usage: node scripts/design/screenshot-sweep.mjs <output-dir>')
  process.exit(1)
}
fs.mkdirSync(path.join(OUT_DIR, 'light'), { recursive: true })
fs.mkdirSync(path.join(OUT_DIR, 'dark'), { recursive: true })

// Randomized per run: this sandbox has repeatedly left a `next start` from a
// prior invocation bound to a fixed port even after the spawning script
// exited (SIGTERM not always reaching it across tool-call boundaries) —
// picking a fresh high port every run sidesteps chasing that leak.
const PORT = 34000 + Math.floor(Math.random() * 4000)
const BASE_URL = `http://localhost:${PORT}`
const VIEWPORT = { width: 390, height: 844 }
const THEME_KEY = 'fairsplit:theme'

// --- scratch database (same _e2e-suffix safety guard as playwright.config.ts) ---
function scratchDatabaseUrl(devUrl, suffix) {
  const u = new URL(devUrl)
  const name = u.pathname.replace(/^\//, '')
  u.pathname = `/${name}_${suffix}`
  return u.toString()
}
const devDatabaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
const scratchUrl = scratchDatabaseUrl(devDatabaseUrl, 'design_sweep_e2e')

function run(cmd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    )
  })
}

async function waitForServer(url, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status < 500) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`server at ${url} did not become ready in time`)
}

async function main() {
  console.log('== Resetting scratch database ==')
  await run('bash', ['scripts/e2e-db-reset.sh'], { DATABASE_URL: scratchUrl })

  console.log('== Building the app (screenshots must reflect production output) ==')
  await run('npx', ['next', 'build'], {
    DATABASE_URL: scratchUrl,
    DIRECT_URL: scratchUrl,
  })

  console.log('== Starting the server ==')
  const server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: scratchUrl,
      DIRECT_URL: scratchUrl,
      // No test may reach a live FX provider (same rule as playwright.config.ts).
      FXRATESAPI_BASE_URL: 'http://127.0.0.1:9',
      FRANKFURTER_BASE_URL: 'http://127.0.0.1:9',
    },
  })
  try {
    await waitForServer(BASE_URL, 60_000)
    await sweep()
  } finally {
    server.kill('SIGTERM')
  }
}

// --- seeding helpers (same flows e2e/*.spec.ts use) -------------------------

const uniqueEmail = (tag) =>
  `sweep-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page, name, email) {
  await page.goto(`${BASE_URL}/signup`)
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByTestId('account-menu').waitFor()
}

async function createGroup(page, name, displayName) {
  await page.goto(`${BASE_URL}/groups/new`)
  await page.waitForTimeout(1500) // DestinationPicker hydration, see e2e/chat-entry.spec.ts
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await page.getByRole('heading', { name }).waitFor()
  return page.url().replace(/\?.*$/, '')
}

async function joinGroup(page, invitePath, displayName) {
  await page.goto(`${BASE_URL}${invitePath}`)
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Join group' }).click()
  await page.getByTestId('chat-input').waitFor()
}

/** One expense via chat: type it, wait for the confirm card, save it. */
async function addChatExpense(page, sentence) {
  await page.getByTestId('chat-input').fill(sentence)
  await page.getByTestId('chat-send').click()
  await page.getByTestId('chat-confirm-card').waitFor()
  await page.getByTestId('chat-confirm-save').click()
  await page.getByTestId('chat-saved-summary').first().waitFor()
}

/** One expense via the full manual wizard; returns the created expense's URL. */
async function addWizardExpense(page, groupUrl, amount) {
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill(amount)
  await page.getByTestId('wizard-next').click() // -> payment
  const spot = page.getByTestId('paid-on-the-spot')
  if (await spot.isVisible()) await spot.click()
  await page.getByTestId('wizard-next').click() // -> items
  await page.getByTestId('wizard-next').click() // -> assign
  await page.getByTestId('wizard-next').click() // -> review
  await page.getByTestId('save-expense').click()
  await page.getByTestId('expense-amount').waitFor()
  return page.url()
}

// --- screenshot plumbing -----------------------------------------------------

let shotCount = 0
async function shot(page, theme, slug) {
  shotCount += 1
  const file = path.join(OUT_DIR, theme, `${slug}.png`)
  await page.waitForTimeout(250) // let entrance animations settle
  await page.screenshot({ path: file })
  console.log(`  [${theme}] ${slug}`)
}

async function withDarkTwin(browser, storageState, urlPath, slug, fn) {
  // Light: the seeded session's own context (storageState carries cookies).
  const lightCtx = await browser.newContext({
    storageState,
    viewport: VIEWPORT,
    reducedMotion: 'reduce',
  })
  const lightPage = await lightCtx.newPage()
  await lightPage.goto(`${BASE_URL}${urlPath}`)
  if (fn) await fn(lightPage)
  await shot(lightPage, 'light', slug)
  await lightCtx.close()

  // Dark: same session, plus the theme key pre-set so ThemeScript paints
  // dark on first load (no flash, no post-hydration toggle-and-rescreenshot).
  const darkState = injectDarkTheme(storageState)
  const darkCtx = await browser.newContext({
    storageState: darkState,
    viewport: VIEWPORT,
    reducedMotion: 'reduce',
  })
  const darkPage = await darkCtx.newPage()
  await darkPage.goto(`${BASE_URL}${urlPath}`)
  if (fn) await fn(darkPage)
  await shot(darkPage, 'dark', slug)
  await darkCtx.close()
}

function injectDarkTheme(storageState) {
  const origin = BASE_URL
  const origins = (storageState.origins ?? []).filter((o) => o.origin !== origin)
  const existing = (storageState.origins ?? []).find((o) => o.origin === origin)
  const localStorage = (existing?.localStorage ?? []).filter(
    (e) => e.name !== THEME_KEY,
  )
  localStorage.push({ name: THEME_KEY, value: 'dark' })
  return { ...storageState, origins: [...origins, { origin, localStorage }] }
}

// `fairsplit:locale` cookie always wins locale resolution (src/i18n/locale.ts
// resolution order: cookie > signed-in account.locale > Accept-Language >
// default). Seeding uses English UI (getByLabel/getByRole text selectors,
// same as the e2e specs), so once an account exists its JWT already carries
// `locale: 'en'` — a context `locale` option alone could no longer override
// that. Stamping this cookie into the storageState used for every SCREENSHOT
// context is what actually forces Korean regardless of account state.
function withKoreanCookie(storageState) {
  const cookies = (storageState.cookies ?? []).filter(
    (c) => c.name !== 'fairsplit:locale',
  )
  cookies.push({
    name: 'fairsplit:locale',
    value: 'ko',
    domain: 'localhost',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax',
  })
  return { ...storageState, cookies }
}

async function sweep() {
  const browser = await chromium.launch()

  // ---- Unauthenticated screens: no seeded session needed --------------------
  console.log('== Unauthenticated screens ==')
  const anonStateKo = withKoreanCookie({ cookies: [], origins: [] })
  for (const [slug, urlPath] of [
    ['landing', '/'],
    ['signin', '/signin'],
    ['signup', '/signup'],
    ['reset-password', '/reset-password'],
    ['not-found', '/this-route-does-not-exist'],
  ]) {
    await withDarkTwin(browser, anonStateKo, urlPath, slug)
  }

  // ---- Seed: owner + 2 members + 4 expenses ----------------------------------
  console.log('== Seeding: signup, group, members, expenses ==')
  const ownerCtx = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', reducedMotion: 'reduce' })
  const owner = await ownerCtx.newPage()
  await signUp(owner, 'Owner Sweep', uniqueEmail('owner'))
  const groupUrl = await createGroup(owner, 'Design Sweep Trip', 'Owner')

  await owner.goto(`${groupUrl}/invite`)
  const invitePath = await owner.getByTestId('invite-link').innerText()

  const memberCtxs = []
  for (const name of ['Bob', 'Carol']) {
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await signUp(page, `${name} Sweep`, uniqueEmail(name.toLowerCase()))
    await joinGroup(page, invitePath, name)
    memberCtxs.push({ name, ctx, page })
  }

  // owner's page is still sitting on /invite from the invite-link grab
  // above — chat-input only exists on the group home route.
  await owner.goto(groupUrl)
  await owner.getByTestId('chat-input').waitFor()

  // Two expenses via chat (also gives us a real saved-summary + a live
  // in-bubble card to screenshot mid-flow), two via the wizard.
  await addChatExpense(owner, '점심 12000원')
  await addChatExpense(memberCtxs[0].page, '택시 8500원')
  const expenseUrl = await addWizardExpense(owner, groupUrl, '32000')
  await addWizardExpense(memberCtxs[1].page, groupUrl, '5400')

  // A pending join code (a 4th "member" who never joins) for the join-preview
  // screenshot, taken from a signed-out context below.
  const joinInvitePath = invitePath

  const ownerState = await ownerCtx.storageState()
  const ownerStateKo = withKoreanCookie(ownerState)
  for (const m of memberCtxs) await m.ctx.close()
  await ownerCtx.close()

  // ---- Authenticated screens --------------------------------------------------
  console.log('== Authenticated screens ==')

  await withDarkTwin(browser, ownerStateKo, '/groups', 'groups-list')
  await withDarkTwin(browser, ownerStateKo, '/groups/new', 'groups-new')
  await withDarkTwin(browser, ownerStateKo, '/account', 'account')
  await withDarkTwin(browser, ownerStateKo, '/guide', 'guide')

  const groupPath = new URL(groupUrl).pathname
  await withDarkTwin(browser, ownerStateKo, groupPath, 'group-home-empty-composer')

  // Composer with an unsent confirm-card open (chat-only, not yet saved).
  await withDarkTwin(browser, ownerStateKo, groupPath, 'group-home-confirm-card-open', async (page) => {
    await page.getByTestId('chat-input').fill('저녁 15000원')
    await page.getByTestId('chat-send').click()
    await page.getByTestId('chat-confirm-card').waitFor()
  })

  await withDarkTwin(browser, ownerStateKo, `${groupPath}/status`, 'status')
  await withDarkTwin(browser, ownerStateKo, `${groupPath}/me`, 'me')
  await withDarkTwin(browser, ownerStateKo, `${groupPath}/exchange`, 'exchange')
  await withDarkTwin(browser, ownerStateKo, `${groupPath}/settings`, 'settings')
  await withDarkTwin(browser, ownerStateKo, `${groupPath}/history`, 'history')
  await withDarkTwin(browser, ownerStateKo, `${groupPath}/invite`, 'invite')

  const expensePath = new URL(expenseUrl).pathname
  await withDarkTwin(browser, ownerStateKo, expensePath, 'expense-detail')

  // /with/[memberId] — resolve a real member id from /status's pairwise link
  // (the viewer's own row, the only one with an href — see StatusRow.tsx).
  {
    const ctx = await browser.newContext({ storageState: ownerStateKo, viewport: VIEWPORT, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${BASE_URL}${groupPath}/status`)
    await page.getByTestId('status-row-toggle').first().click()
    const href = await page.getByTestId('pairwise-link').first().getAttribute('href')
    await ctx.close()
    if (href) {
      await withDarkTwin(browser, ownerStateKo, href, 'with-member')
    } else {
      console.warn('  (skipped with-member: no pairwise-link found)')
    }
  }

  // Expense wizard steps — walk a fresh draft, screenshotting each step
  // before advancing (light + dark each get their own independent walk,
  // since the draft lives in component state, not the URL).
  for (const theme of ['light', 'dark']) {
    const state = theme === 'dark' ? injectDarkTheme(ownerStateKo) : ownerStateKo
    const ctx = await browser.newContext({ storageState: state, viewport: VIEWPORT, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(`${BASE_URL}${groupPath}/expenses/new`)
    await shot(page, theme, 'wizard-1-amount')
    await page.getByTestId('amount').fill('9900')
    await page.getByTestId('wizard-next').click()
    const spot = page.getByTestId('paid-on-the-spot')
    if (await spot.isVisible()) await spot.click()
    await shot(page, theme, 'wizard-2-payment')
    await page.getByTestId('wizard-next').click()
    await shot(page, theme, 'wizard-3-items')
    await page.getByTestId('wizard-next').click()
    await shot(page, theme, 'wizard-4-assign')
    await page.getByTestId('wizard-next').click()
    await shot(page, theme, 'wizard-5-review')
    await ctx.close()
  }

  // Join preview — a signed-in-but-not-a-member user hitting the invite link.
  {
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: 'en-US', reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await signUp(page, 'Dana Sweep', uniqueEmail('dana'))
    const state = await ctx.storageState()
    await ctx.close()
    await withDarkTwin(browser, withKoreanCookie(state), joinInvitePath, 'join-preview')
  }

  await browser.close()
  console.log(`\n${shotCount} screenshots written to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
