import { expect, test, type Locator, type Page } from '@playwright/test'
import { createWallet, recordTopUp, showWallets, startTopUp } from './wallet-flow'

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

/** Create a wallet and fill it in one pass through the wizard. */
async function addWallet(
  page: Page,
  label: string,
  type: string,
  currency: string,
  topUp: { rate: string; received: string; expectPaid: string },
): Promise<void> {
  await startTopUp(page)
  await createWallet(page, { label, type, currency })
  await recordTopUp(page, topUp)
  await expect(
    page.getByTestId('wallet-card').filter({ hasText: label }),
  ).toBeVisible()
}

/**
 * Phase 4A wallets walkthrough. The point of the whole model is here: Bob
 * carries TWO pots of yen bought at DIFFERENT rates, and which one an
 * expense came out of decides both what it cost and which balance moves.
 *
 * Cash          100 JPY = 931 KRW  (₩93,100 -> ¥10,000)
 * Travel Wallet 100 JPY = 903 KRW  (₩90,300 -> ¥10,000)
 *
 *   ¥10,000 from Travel Wallet -> ₩90,300, Alice owes ₩45,150
 *   ¥5,000 pay-as-you-go, bank billed ₩47,000, Alice owes ₩23,500
 *   Alice owes Bob ₩68,650 in total.
 */
test('wallets: two pots at two rates, pay-as-you-go, overdraft, recalc, cancel, privacy', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await signUp(pageA, 'Alice E2E', uniqueEmail('alice'))

  await pageA.goto('/groups/new')
  await pageA.getByLabel('Group name').fill('Wallet E2E')
  await pageA.getByLabel('Settlement currency').selectOption('KRW')
  await pageA.getByLabel('Your display name in this group').fill('Alice')
  await pageA.getByRole('button', { name: 'Create group' }).click()
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await expect(pageA.getByTestId('chat-input')).toBeVisible()
  const groupUrl = pageA.url()
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

  // Two wallets, two rates. A member-scoped average could not tell them apart.
  await pageB.goto(`${groupUrl}/exchange`)
  // Arriving with no returnTo (from the tab bar) is not a dead end: the back
  // link always renders, top-left, reading "Back" rather than "Back to your
  // expense". The arrow is an icon now, not a text character.
  await expect(pageB.getByTestId('back-to-expense')).toHaveText('Back')
  // With no wallet at all there is nothing to choose between, so the wizard
  // opens straight onto making one.
  await expect(pageB.getByTestId('wallet-create-label')).toBeVisible()
  await addWallet(pageB, 'Cash', 'Cash', 'JPY', {
    rate: '931',
    received: '10000',
    expectPaid: '93100',
  })
  await addWallet(pageB, 'Travel Wallet', 'Travel card', 'JPY', {
    rate: '903',
    received: '10000',
    expectPaid: '90300',
  })
  // No returnTo: saving stays put rather than navigating anywhere — the
  // user may well be about to log a third top-up.
  await expect(pageB).toHaveURL(`${groupUrl}/exchange`)

  const walletCard = (page: Page, label: string) =>
    page.getByTestId('wallet-card').filter({ hasText: label })
  await expect(walletCard(pageB, 'Cash').first()).toContainText('100 JPY = 931')
  await expect(walletCard(pageB, 'Travel Wallet')).toContainText(
    '100 JPY = 903',
  )

  // Wallet balances moved to /exchange's wallet list (Task 5, app-shell
  // restructure: home no longer shows a wallet summary of its own).
  await pageB.goto(`${groupUrl}/exchange`)
  await showWallets(pageB)
  await expect(walletCard(pageB, 'Travel Wallet')).toContainText('¥10,000 left')

  // Spend from the travel card: it converts at 9.03, NOT at the market rate
  // and not at the cash wallet's 9.31.
  await pageB.goto(`${groupUrl}/expenses/new`)
  await pageB.getByTestId('amount').fill('10000')
  await pageB.getByLabel('Currency').selectOption('JPY')
  await next(pageB)
  await choosePayer(pageB, 'Bob')
  await pageB.getByTestId('paid-prepaid').click()
  await fundingOption(pageB, 'Travel Wallet').click()
  await pageB.getByTestId('manual-rate-toggle').click()
  await pageB.getByTestId('market-rate').fill('950')
  for (let step = 1; step < 4; step += 1) await next(pageB)
  await pageB.getByTestId('save-expense').click()

  await expect(pageB.getByTestId('rate-chip')).toHaveText('Travel Wallet rate')
  await pageB.getByTestId('rate-chip').click()
  await expect(pageB.getByTestId('rate-chip-explanation')).toBeVisible()
  await expect(pageB.getByTestId('expense-converted')).toContainText('₩90,300')
  await expect(pageB.getByTestId('expense-method')).toHaveText(
    'Paid from Travel Wallet',
  )

  // Only that wallet is drawn down.
  // Wallet balances moved to /exchange's wallet list (Task 5, app-shell
  // restructure: home no longer shows a wallet summary of its own).
  await pageB.goto(`${groupUrl}/exchange`)
  await showWallets(pageB)
  await expect(walletCard(pageB, 'Travel Wallet')).toContainText('¥0 left')
  await expect(walletCard(pageB, 'Cash').first()).toContainText('¥10,000 left')

  // Paid on the spot. The wizard no longer asks what the bank charged —
  // nobody has their banking app open mid-dinner and the statement has not
  // posted yet — so it saves at the market rate...
  await pageB.goto(`${groupUrl}/expenses/new`)
  await pageB.getByTestId('amount').fill('5000')
  await pageB.getByLabel('Currency').selectOption('JPY')
  await next(pageB)
  await choosePayer(pageB, 'Bob')
  await pageB.getByTestId('paid-on-the-spot').click()
  await expect(pageB.getByTestId('actual-charged')).toHaveCount(0)
  await pageB.getByTestId('manual-rate-toggle').click()
  await pageB.getByTestId('market-rate').fill('950')
  for (let step = 1; step < 4; step += 1) await next(pageB)
  await pageB.getByTestId('save-expense').click()
  await expect(pageB.getByTestId('rate-chip')).toHaveText('market rate')
  await expect(pageB.getByTestId('expense-converted')).toContainText('₩47,500')
  await expect(pageB.getByTestId('expense-method')).toHaveText(
    'Paid by card (pay-as-you-go)',
  )

  // ...and the correction lives here instead, for when the statement lands.
  await pageB.getByTestId('bank-charged-input').fill('47000')
  await pageB.getByTestId('bank-charged-save').click()
  await expect(pageB.getByTestId('bank-charged-saved')).toBeVisible()
  await pageB.reload()
  await expect(pageB.getByTestId('rate-chip')).toHaveText('bank-charged')
  await expect(pageB.getByTestId('expense-converted')).toContainText('₩47,000')

  // Clearing it goes back to the rate that was snapshotted at entry.
  await pageB.getByTestId('bank-charged-clear').click()
  // Wait for the action to actually land: the Clear button only disappears
  // once the returned state says there is nothing left to clear. Reloading
  // straight after the click aborts the in-flight request.
  await expect(pageB.getByTestId('bank-charged-clear')).toHaveCount(0)
  await pageB.reload()
  await expect(pageB.getByTestId('expense-converted')).toContainText('₩47,500')
  await pageB.getByTestId('bank-charged-input').fill('47000')
  await pageB.getByTestId('bank-charged-save').click()
  await expect(pageB.getByTestId('bank-charged-saved')).toBeVisible()
  await pageB.reload()
  await expect(pageB.getByTestId('expense-converted')).toContainText('₩47,000')

  // Wallet balances moved to /exchange's wallet list (Task 5, app-shell
  // restructure: home no longer shows a wallet summary of its own).
  await pageB.goto(`${groupUrl}/exchange`)
  await showWallets(pageB)
  await expect(walletCard(pageB, 'Cash').first()).toContainText('¥10,000 left')

  // Overspending a wallet is allowed — people forget to log a top-up far
  // more often than they overspend — but it must say so. Personal, so the
  // group balances below stay predictable.
  await pageB.goto(`${groupUrl}/expenses/new`)
  await pageB.getByTestId('amount').fill('3000')
  await pageB.getByLabel('Currency').selectOption('JPY')
  await next(pageB)
  await choosePayer(pageB, 'Bob')
  await pageB.getByTestId('paid-prepaid').click()
  await fundingOption(pageB, 'Travel Wallet').click()
  // Foreign currency, so a market-rate snapshot is written at save time even
  // though this expense converts at the wallet's own rate. Enter the override
  // every other spec enters, rather than leaning on whatever happens to be in
  // RateCache — that dependency is what made this spec fail for weeks.
  await pageB.getByTestId('manual-rate-toggle').click()
  await pageB.getByTestId('market-rate').fill('900')
  await pageB.getByTestId('personal-toggle').check()
  for (let step = 1; step < 4; step += 1) await next(pageB)
  await pageB.getByTestId('save-expense').click()
  await expect(pageB.getByTestId('expense-amount')).toBeVisible()
  // Wallet balances moved to /exchange's wallet list (Task 5, app-shell
  // restructure: home no longer shows a wallet summary of its own).
  await pageB.goto(`${groupUrl}/exchange`)
  await showWallets(pageB)
  await expect(walletCard(pageB, 'Travel Wallet')).toContainText('over')

  // Alice sees the one-time recalc banner naming Bob, and dismisses it.
  await pageA.goto(groupUrl)
  await expect(pageA.getByTestId('recalc-banner')).toContainText('Bob')
  await pageA.getByTestId('recalc-dismiss').click()
  await expect(pageA.getByTestId('recalc-banner')).toHaveCount(0)
  await pageA.reload()
  await expect(pageA.getByTestId('recalc-banner')).toHaveCount(0)

  // Alice's own expense triggers the one-time wallet onboarding prompt.
  await pageA.goto(`${groupUrl}/expenses/new`)
  await pageA.getByTestId('amount').fill('30000')
  await next(pageA)
  await choosePayer(pageA, 'Alice')
  // The wizard defaults this to JPY (the currency of every expense before it),
  // so the save wants a market-rate snapshot and must not go looking for one.
  await pageA.getByTestId('manual-rate-toggle').click()
  await pageA.getByTestId('market-rate').fill('900')
  for (let step = 1; step < 4; step += 1) await next(pageA)
  await pageA.getByTestId('save-expense').click()
  await expect(pageA.getByTestId('exchange-prompt')).toBeVisible()
  await pageA.getByTestId('exchange-prompt-skip').click()
  await expect(pageA.getByTestId('exchange-prompt')).not.toBeVisible()

  // Cancelling asks first, then reverts the balance to 45,150 + 23,500.
  await pageA.getByTestId('cancel-expense').click()
  await pageA.getByTestId('cancel-expense-confirm').click()
  await expect(pageA.getByTestId('cancelled-banner')).toContainText(
    'Alice took this out of the settlement',
  )
  await pageA.goto(`${groupUrl}/history`)
  await expect(pageA.getByTestId('feed-cancelled')).toBeVisible()

  // The feed lives on /history now (Task 5, app-shell restructure), and
  // shows everything it has — no preview cap or "show more" button (T2's
  // history screen intentionally dropped the 3-row preview home used to
  // apply). Tapping a row EXPANDS it — "what did we buy again?" is answered
  // in place — and the full detail screen is still reachable from inside.
  const feedRows = pageA.locator('[data-testid^="feed-"]').filter({
    has: pageA.locator('button[aria-expanded]'),
  })
  await expect(feedRows.count()).resolves.toBeGreaterThan(3)
  const firstRow = feedRows.first()
  await firstRow.getByRole('button').first().click()
  await expect(firstRow.getByTestId('feed-detail')).toBeVisible()
  await firstRow.getByTestId('feed-open').click()
  await expect(pageA).toHaveURL(/\/expenses\//)
  await pageA.goto(groupUrl)

  // The invite link is setup, not something to meet on the screen you open
  // every day — the dedicated /invite screen (sidebar menu) is its home;
  // settings keeps at most a link out to it (T7 intake: settings used to
  // duplicate the whole invite block, deduped down to one link).
  await expect(pageA.getByTestId('invite-link')).toHaveCount(0)
  await pageA.goto(`${groupUrl}/settings`)
  await expect(pageA.getByTestId('settings-invite-link')).toBeVisible()
  await pageA.getByTestId('settings-invite-link').click()
  await expect(pageA.getByTestId('invite-link')).toBeVisible()

  // Per-person balances moved to /status (Task 5, app-shell restructure);
  // Alice's own row states her net, and expanding it names who it is with.
  await pageA.goto(`${groupUrl}/status`)
  const aliceRow = pageA.getByTestId('status-row').filter({ hasText: 'Alice' })
  await expect(aliceRow).toContainText('To pay')
  await expect(aliceRow).toContainText('₩68,650')
  await aliceRow.getByTestId('status-row-toggle').click()
  const aliceBreakdown = aliceRow.getByTestId('pairwise-breakdown')
  await expect(aliceBreakdown).toContainText('Bob')
  await expect(aliceBreakdown).toContainText('₩68,650')

  // Status lists every wallet Bob holds, until he hides them.
  await pageA.goto(`${groupUrl}/status`)
  const bobCash = pageA
    .getByTestId('status-row')
    .filter({ hasText: 'Bob' })
    .getByTestId('cash-cell')
  await expect(bobCash).toContainText('Cash')
  await expect(bobCash).toContainText('¥10,000')

  await pageB.goto(`${groupUrl}/settings`)
  await pageB.getByTestId('wallet-privacy-toggle').click()
  await expect(
    pageB.getByRole('button', { name: 'Show my wallet to the group' }),
  ).toBeVisible()
  await pageA.goto(`${groupUrl}/status`)
  await expect(
    pageA
      .getByTestId('status-row')
      .filter({ hasText: 'Bob' })
      .getByTestId('cash-cell'),
  ).toHaveText('—')

  await contextA.close()
  await contextB.close()
})
