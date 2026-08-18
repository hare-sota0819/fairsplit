import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { createWallet, showWallets } from './wallet-flow'

test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

/**
 * Creates a KRW-settlement group, optionally bound for a country. The trip
 * CURRENCY is derived from that country — the form never asks for it.
 */
async function createGroup(
  page: Page,
  name: string,
  options: { tripCountry?: string; displayName?: string } = {},
): Promise<string> {
  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  if (options.tripCountry) {
    await page.getByTestId('trip-country').selectOption(options.tripCountry)
  }
  await page
    .getByLabel('Your display name in this group')
    .fill(options.displayName ?? 'Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

/** Single-select toggle groups render as Radix radios. */
/**
 * Pick the payer by name. The dropdown suffixes the acting member's own
 * option ("Alice (me)"), so the option is found by substring and selected by
 * its value rather than by an exact label.
 */
const choosePayer = async (page: Page, name: string) => {
  const select = page.getByTestId('payer-select')
  const value = await select
    .locator('option')
    .filter({ hasText: name })
    .first()
    .getAttribute('value')
  await select.selectOption(value!)
}

/** One "Paid from" option, found by the wallet label it shows. */
const fundingOption = (page: Page, label: string): Locator =>
  page.locator('[data-testid^="funding-"]').filter({ hasText: label })

const next = (page: Page) => page.getByTestId('wizard-next').click()

async function addWallet(
  page: Page,
  label: string,
  type: string,
  currency: string,
): Promise<void> {
  await createWallet(page, { label, type, currency })
  await showWallets(page)
  await expect(
    page.getByTestId('wallet-card').filter({ hasText: label }),
  ).toBeVisible()
}

/**
 * `/api/rates` proxies a real outbound call to Frankfurter, so it is stubbed
 * in every test here exactly as the other specs stub it — the live provider
 * must never be reached from a test. The value is arbitrary: nothing below
 * asserts on the preview, only on state that survives it (amount, currency,
 * funding options).
 */
async function stubRates(page: Page): Promise<void> {
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9', asOf: '2026-08-01', today: '2026-08-02' },
    }),
  )
}

/**
 * The scratch DB URL, derived the same way playwright.config.ts derives
 * `webServer`'s DATABASE_URL — duplicated rather than imported because the
 * config module's own copy is not exported.
 */
function scratchDatabaseUrl(devUrl: string): string {
  const u = new URL(devUrl)
  const name = u.pathname.replace(/^\//, '')
  u.pathname = `/${name}_e2e`
  return u.toString()
}

/**
 * Chat (unlike the wizard) has no manual-rate field: a confirm-card save in
 * a currency other than settlement always resolves its rate through
 * `getSnapshotRate`, and this suite's `webServer` deliberately points both
 * FX providers at a closed port (playwright.config.ts) so nothing here ever
 * reaches a live one. Seeding today's rate straight into `RateCache` makes
 * that lookup a cache hit (`cachePlan`'s `reuse` branch — cache-policy.ts)
 * instead of a network call: the same substitute every other spec makes via
 * the wizard's manual-rate-toggle, for the one save path that has no such
 * control to enter one through.
 */
async function seedTodaysRate(
  base: string,
  quote: string,
  rate: string,
): Promise<void> {
  const devUrl =
    process.env.DATABASE_URL ??
    'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: scratchDatabaseUrl(devUrl),
    }),
  })
  const today = new Date().toISOString().slice(0, 10)
  try {
    await db.rateCache.upsert({
      where: { date_base_quote: { date: today, base, quote } },
      create: { date: today, base, quote, rate, asOf: today },
      update: { rate, asOf: today, fetchedAt: new Date() },
    })
  } finally {
    await db.$disconnect()
  }
}

/**
 * The owner's definition of done, verbatim: create a group with trip
 * currency JPY -> expense defaults to JPY -> item prices in JPY -> travel
 * card offered under "Paid from" -> assign by quantity and close the
 * accordion -> home shows wallet balances first, then a per-person list you
 * can tap into -> expense detail reads like a receipt.
 *
 * Item unit prices already followed the expense currency before Phase 4C
 * (StepItems/StepReview both render `state.currency`); the KRW the original
 * phone walkthrough hit came from the expense CURRENCY itself defaulting to
 * settlement. Trip currency fixes that at the source, so this test proves
 * the whole chain rather than the item-price rendering in isolation.
 */
test('the phone walkthrough: JPY trip currency end to end', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await stubRates(pageA)
  await signUp(pageA, 'Alice E2E', uniqueEmail('alice'))
  const groupUrl = await createGroup(pageA, 'JPY Trip E2E', {
    tripCountry: 'JP',
    displayName: 'Alice',
  })
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await pageA.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signUp(pageB, 'Bob E2E', uniqueEmail('bob'))
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Bob')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // Home is chat-only (Task 5, app-shell restructure): the composer being
  // there is proof the join landed and home rendered.
  await expect(pageB.getByTestId('chat-input')).toBeVisible()

  // A travel card in the trip currency, so "Paid from" has something to
  // offer besides the bank.
  await pageA.goto(`${groupUrl}/exchange`)
  await addWallet(pageA, 'Travel Card', 'Travel card', 'JPY')

  // Step 1 (amount): no prior expense exists, so the trip currency alone
  // decides the default — the defaulting chain the whole phase exists for.
  await pageA.goto(`${groupUrl}/expenses/new`)
  await expect(pageA.getByLabel('Currency')).toHaveValue('JPY')
  await pageA.getByTestId('amount').fill('1300')
  await next(pageA)

  // Step 2 (payment): the travel card is offered, not silently dropped
  // because the expense currency does not match settlement.
  await pageA.getByTestId('paid-prepaid').click()
  await expect(fundingOption(pageA, 'Travel Card')).toBeVisible()
  await choosePayer(pageA, 'Alice')
  // Foreign currency, so a rate is needed to save. A manual override is used
  // here (as every other e2e spec does for a foreign-currency save) so the
  // save never has to reach Frankfurter for real.
  await pageA.getByTestId('manual-rate-toggle').click()
  await pageA.getByTestId('market-rate').fill('900')
  await next(pageA)

  // Step 3 (items): unit prices already read the expense currency, and the
  // scan-receipt tile is now live — Phase 5 turned it on, so the assertion
  // that it stays inert has been replaced by one that it is reachable. What
  // it does once tapped belongs to receipt-scan.spec.ts.
  await expect(pageA.getByTestId('item-row')).toHaveCount(0)
  const scan = pageA.getByTestId('scan-receipt')
  await expect(scan).toBeEnabled()
  await expect(scan).not.toHaveAttribute('aria-disabled', 'true')

  await pageA.getByTestId('enter-manually').click()
  const price = pageA.getByTestId('item-unit-price')
  await expect(price.locator('xpath=..')).toContainText('JPY')
  await pageA.getByTestId('item-name').fill('Coffee')
  await price.fill('500')
  await pageA.getByTestId('item-qty-up').click()

  await pageA.getByTestId('add-item').click()
  const snack = pageA.getByTestId('item-row').nth(1)
  await snack.getByTestId('item-name').fill('Snack')
  await snack.getByTestId('item-unit-price').fill('300')

  await expect(
    pageA.getByTestId('item-row').nth(0).getByTestId('line-math'),
  ).toHaveText('¥500 × 2 = ¥1,000')
  await expect(
    pageA.getByTestId('item-row').nth(1).getByTestId('line-math'),
  ).toHaveText('¥300 × 1 = ¥300')
  await expect(pageA.getByTestId('items-total')).toHaveText('¥1,300')
  await next(pageA)

  // Step 4 (assign): two participants, so no filter appears at all; ticking
  // one and pressing Done closes this row and opens the next unassigned one.
  // Bob, not the payer, is ticked — the unassigned pool (the untaken coffee
  // unit plus the whole snack line) distributes proportionally to whoever
  // HAS an assigned subtotal, so ticking the payer here would attribute it
  // all back to her and leave nothing for Bob to owe.
  const rows = pageA.getByTestId('assign-row')
  await rows.nth(0).getByTestId('assign-toggle').click()
  await expect(pageA.getByTestId('member-filter')).toHaveCount(0)
  await rows.nth(0).getByRole('checkbox', { name: 'Bob' }).click()
  await rows.nth(0).getByTestId('assign-done').click()

  await expect(rows.nth(0).getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await expect(rows.nth(0).getByTestId('unassigned-badge')).toHaveCount(0)
  await expect(rows.nth(1).getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(rows.nth(1).getByTestId('unassigned-badge')).toBeVisible()

  await next(pageA)
  await pageA.getByTestId('save-expense').click()

  // Expense detail reads like a receipt: the multi-unit line shows its
  // multiplier, the single-unit one does not, and no assignee is named until
  // its row is opened.
  await expect(pageA.getByTestId('expense-amount')).toBeVisible()
  const receiptRows = pageA.getByTestId('receipt-row')
  await expect(receiptRows.nth(0)).toContainText('× 2')
  await expect(receiptRows.nth(1)).not.toContainText('×')
  await expect(
    receiptRows.nth(0).getByTestId('receipt-assignees'),
  ).not.toBeVisible()
  await receiptRows.nth(0).locator('summary').click()
  await expect(receiptRows.nth(0).getByTestId('receipt-assignees')).toContainText(
    'Bob',
  )

  // The member's TWO TOTALS, wallet balances and per-person list used to
  // all lead home, in that DOM order. Task 5 (app-shell restructure,
  // 2026-08-10) made home chat-only — totals and the per-person list moved
  // to /status, wallet balances to /exchange. They are on different screens
  // by design now, so the single-page ordering check does not carry over;
  // each is checked on its own screen instead.
  await pageA.goto(`${groupUrl}/exchange`)
  await showWallets(pageA)
  await expect(pageA.getByTestId('wallet-card').first()).toBeVisible()

  await pageA.goto(`${groupUrl}/status`)
  await expect(pageA.getByTestId('total-fronted')).toBeVisible()

  // Each total opens into rows that state WHICH rate produced them, and the
  // rows sum to the figure above them — the unit tests pin the arithmetic,
  // this pins that the screen actually shows it.
  await pageA.getByTestId('total-fronted').getByRole('button').click()
  const breakdown = pageA.getByTestId('total-fronted-breakdown')
  await expect(breakdown).toBeVisible()
  // The row names WHAT IT WAS PAID WITH and the two amounts. It deliberately
  // does NOT carry the rate: that belongs on the expense, not on a summary of
  // what you fronted.
  const firstRow = breakdown.getByTestId('breakdown-row').first()
  await expect(firstRow).toContainText('Travel Card')
  await expect(firstRow).not.toContainText('100 JPY =')
  await expect(breakdown.getByTestId('breakdown-total')).toBeVisible()
  // No hero-sized net balance anywhere (that treatment is reserved for the
  // expense detail and the per-pair history screens).
  await expect(pageA.locator('main .text-4xl')).toHaveCount(0)
  await expect(pageA.getByTestId('summary-note')).toBeVisible()

  // The per-person list moved to /status too — the viewer's own row (only
  // that one, home never showed anyone else's counterparties) opens onto
  // the shared two-person history, same as home's old per-person row did.
  const aliceRow = pageA
    .getByTestId('status-row')
    .filter({ hasText: 'Alice' })
  await aliceRow.getByTestId('status-row-toggle').click()
  await aliceRow.getByTestId('pairwise-link').first().click()
  await expect(pageA).toHaveURL(/\/with\//)
  await expect(pageA.getByTestId('with-row').first()).toBeVisible()

  await contextA.close()
  await contextB.close()
})

/**
 * A payer's wallet in a currency other than the expense's is not silently
 * dropped from "Paid from" — it is named, and switching the expense to that
 * currency turns it into a real funding option without touching the typed
 * amount.
 */
test('a wallet in another currency is named, and switching keeps the amount', async ({
  page,
}) => {
  await stubRates(page)
  await signUp(page, 'Wallet Switch E2E', uniqueEmail('walletswitch'))
  const groupUrl = await createGroup(page, 'Wallet Switch Trip E2E')

  await page.goto(`${groupUrl}/exchange`)
  await addWallet(page, 'Travel Card', 'Travel card', 'JPY')
  await addWallet(page, 'Coin Purse', 'Cash', 'JPY')

  await page.goto(`${groupUrl}/expenses/new`)
  // No trip currency and no prior expense: the default is the settlement
  // currency, which neither JPY wallet can fund.
  await expect(page.getByLabel('Currency')).toHaveValue('KRW')
  await page.getByTestId('amount').fill('5000')
  await next(page)

  // Two wallets in the SAME hidden currency must still collapse into one
  // grouped notice row naming both, and one switch button — not one per
  // wallet.
  await expect(page.getByTestId('other-currency-wallets')).toContainText(
    'Travel Card',
  )
  await expect(page.getByTestId('other-currency-wallets')).toContainText(
    'Coin Purse',
  )
  await expect(page.getByTestId('switch-currency-JPY')).toHaveCount(1)
  await page.getByTestId('switch-currency-JPY').click()
  await page.getByTestId('paid-prepaid').click()
  await expect(fundingOption(page, 'Travel Card')).toBeVisible()

  // The digits typed for the amount are untouched by the currency switch.
  await page.getByTestId('step-amount').click()
  await expect(page.getByTestId('amount')).toHaveValue('5000')
  await expect(page.getByLabel('Currency')).toHaveValue('JPY')
})

/**
 * Task 10 built the >10-participant filter and Done's wrap-around search but
 * only verified them with a throwaway (deleted) Playwright script. This is
 * their permanent coverage: eleven participants trip the filter, a member
 * filtered OUT of view keeps their tick and per-unit quantity, and Done
 * wraps to the earliest still-unassigned item when nothing is left after the
 * one just finished — closing everything once nothing anywhere is left.
 *
 * The <=10 case (no filter at all) is covered by the two-participant
 * walkthrough above; it does not need its own group here.
 */
test('assignment step: the >10 filter keeps ticks intact, and Done wraps around', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signUp(ownerPage, 'Roster Owner', uniqueEmail('roster-owner'))
  const groupUrl = await createGroup(ownerPage, 'Roster Trip E2E')
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await ownerPage.goto(`${groupUrl}/invite`)
  const invitePath = await ownerPage.getByTestId('invite-link').innerText()

  for (let i = 1; i <= 10; i += 1) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signUp(page, `Member ${i}`, uniqueEmail(`roster-${i}`))
    await page.goto(invitePath)
    await page
      .getByLabel('Your display name in this group')
      .fill(`Member ${i}`)
    await page.getByRole('button', { name: 'Join group' }).click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
    await context.close()
  }

  // Eleven members total (the owner plus ten). Three items, entered so that
  // Done on the LAST one has nothing after it to advance to.
  await ownerPage.goto(`${groupUrl}/expenses/new`)
  await ownerPage.getByTestId('amount').fill('9000')
  await next(ownerPage)
  await next(ownerPage)

  await ownerPage.getByTestId('enter-manually').click()
  await ownerPage.getByTestId('item-name').fill('Snacks')
  await ownerPage.getByTestId('item-unit-price').fill('500')

  await ownerPage.getByTestId('add-item').click()
  const water = ownerPage.getByTestId('item-row').nth(1)
  await water.getByTestId('item-name').fill('Water')
  await water.getByTestId('item-unit-price').fill('300')

  await ownerPage.getByTestId('add-item').click()
  const bread = ownerPage.getByTestId('item-row').nth(2)
  await bread.getByTestId('item-name').fill('Bread')
  await bread.getByTestId('item-unit-price').fill('1000')
  await bread.getByTestId('item-qty-up').click()
  await bread.getByTestId('item-qty-up').click()
  await bread.getByTestId('item-qty-up').click()

  await next(ownerPage)

  const rows = ownerPage.getByTestId('assign-row')

  // Bread (the last item) opens with a filter, since 11 > 10.
  await rows.nth(2).getByTestId('assign-toggle').click()
  await expect(rows.nth(2).getByTestId('member-filter')).toBeVisible()

  await rows.nth(2).getByTestId('member-filter').fill('Member 3')
  const member3 = rows.nth(2).locator('li').filter({ hasText: 'Member 3' })
  await member3.getByRole('checkbox').check()
  await member3.getByRole('button', { name: 'One more' }).click()

  // Filtering Member 3 OUT of view does not lose their tick or quantity.
  await rows.nth(2).getByTestId('member-filter').fill('Member 9')
  await expect(
    rows.nth(2).locator('li').filter({ hasText: 'Member 3' }),
  ).toHaveCount(0)
  await rows.nth(2).getByTestId('member-filter').fill('')
  await expect(member3.getByRole('checkbox')).toBeChecked()
  await expect(member3.locator('input[inputmode="numeric"]')).toHaveValue('2')

  // Done on Bread (index 2, nothing after it) wraps to the EARLIEST
  // still-unassigned item — Snacks (index 0), not Water.
  await rows.nth(2).getByTestId('assign-done').click()
  await expect(rows.nth(0).getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await expect(rows.nth(2).getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  )

  // Snacks -> Water is a plain forward advance (nothing to wrap for).
  await rows.nth(0).getByRole('checkbox', { name: 'Member 5' }).click()
  await rows.nth(0).getByTestId('assign-done').click()
  await expect(rows.nth(1).getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  // Water is the last unassigned item anywhere: Done closes everything.
  await rows.nth(1).getByRole('checkbox', { name: 'Member 7' }).click()
  await rows.nth(1).getByTestId('assign-done').click()
  const expandedCount = await ownerPage
    .getByTestId('assign-toggle')
    .evaluateAll(
      (nodes) =>
        nodes.filter((node) => node.getAttribute('aria-expanded') === 'true')
          .length,
    )
  expect(expandedCount).toBe(0)

  await ownerContext.close()
})

/**
 * A1 hotfix: the chat composer's `defaultCurrency` now matches the wizard's
 * (`defaultExpenseCurrency` — group.tripCurrency, not group.settlementCurrency).
 * Before the fix, chat always defaulted to settlement, so a trip-currency
 * mention on a foreign-trip group was misclassified as `crossCurrency` (its
 * parsed currency != the chat default) and bounced to the wizard for no
 * reason — even though the wizard itself would have opened on that exact
 * currency. This is the regression test for that: same JPY-trip/KRW-settlement
 * group as "the phone walkthrough" above, entered through chat instead of the
 * wizard.
 */
test('chat entry in the trip currency saves directly instead of bouncing to the wizard', async ({
  page,
}) => {
  await signUp(page, 'Erin E2E', uniqueEmail('erin'))
  await createGroup(page, 'JPY Trip Chat E2E', {
    tripCountry: 'JP',
    displayName: 'Erin',
  })

  // See seedTodaysRate's doc comment: chat has no manual-rate field, so this
  // stands in for a live provider answering (which it would, in production;
  // this suite's webServer never lets one be reached for real).
  await seedTodaysRate('JPY', 'KRW', '9')

  await page.getByTestId('chat-input').fill('택시 8500엔')
  await page.getByTestId('chat-send').click()

  // The bug: this used to render `chat-cross-currency-card` instead.
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-cross-currency-card')).toHaveCount(0)
  await expect(page.getByTestId('chat-amount')).toContainText('¥8,500')

  await page.getByTestId('chat-confirm-save').click()
  await expect(
    page.getByTestId('chat-saved-summary').filter({ hasText: '택시' }),
  ).toBeVisible()
})

/**
 * A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차") superseded this test's
 * old premise: a currency matching neither the trip nor the settlement
 * currency used to bail to the wizard with no way back — the A1 hotfix this
 * file otherwise documents only changed what counted as "the same currency
 * as the default", not that crossCurrency mechanism itself. A2 removed the
 * mechanism entirely: ANY currency now opens an ordinary confirm card, with
 * an inline funding-source section whenever it differs from the group's
 * settlement currency (here: USD, JPY trip currency, KRW settlement — all
 * three distinct, so this is the strictest version of that case). The
 * escape to the wizard survives as a secondary link, never the only path.
 */
test('a currency mention that matches neither the trip nor settlement currency is recorded in-chat, with a funding section', async ({
  page,
}) => {
  await signUp(page, 'Frank E2E', uniqueEmail('frank'))
  await createGroup(page, 'JPY Trip USD Mention E2E', {
    tripCountry: 'JP',
    displayName: 'Frank',
  })
  // See seedTodaysRate's own doc comment above: chat's confirm card has no
  // manual-rate field, so this stands in for a live provider answering.
  await seedTodaysRate('USD', 'KRW', '1300')

  await page.getByTestId('chat-input').fill('저녁 50달러')
  await page.getByTestId('chat-send').click()

  // The bug this used to pin: this rendered `chat-cross-currency-card`
  // instead, with no way to finish the entry without leaving the chat.
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-cross-currency-card')).toHaveCount(0)
  await expect(page.getByTestId('chat-amount')).toContainText('$50')

  // USD differs from the group's KRW settlement currency, so the
  // funding-source section is offered — defaulting to the safe "paid on
  // the spot" choice, since Frank has no USD wallet.
  await expect(page.getByTestId('chat-funding-section')).toBeVisible()
  await expect(page.getByTestId('chat-funding-onspot')).toHaveAttribute(
    'data-state',
    'on',
  )

  // The wizard escape still exists (never a dead end, never the ONLY path).
  await expect(page.getByTestId('chat-open-form')).toBeVisible()

  await page.getByTestId('chat-confirm-save').click()
  await expect(
    page.getByTestId('chat-saved-summary').filter({ hasText: '저녁' }),
  ).toBeVisible()
})
