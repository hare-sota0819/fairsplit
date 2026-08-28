import { expect, test, type Page } from '@playwright/test'
import { createWallet, recordTopUp } from './wallet-flow'
import { inviteJoinPath } from './nav'
import { openLedger } from './group-flow'

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

const next = (page: Page) => page.getByTestId('wizard-next').click()

/**
 * "My card ran out, so Bob paid the rest."
 *
 * Until now an expense had ONE payer and every funding portion belonged to
 * them, so this had nowhere to live. The group's workaround — enter it as two
 * expenses — makes one dinner look like two on the feed and divides the
 * receipt's items wrongly, because each half then splits on its own.
 *
 * A portion now names its own funder, and the settlement credits them for it.
 */
test('a receipt two people fronted credits both of them', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  const contextA = await browser.newContext()
  const alice = await contextA.newPage()
  await signUp(alice, 'Alice E2E', uniqueEmail('cofund-a'))
  await openLedger(alice, 'Co-funded E2E')
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  await expect(alice.getByTestId('home')).toBeVisible()
  const groupUrl = alice.url()
  await alice.goto(`${groupUrl}/invite`)
  const invitePath = await inviteJoinPath(alice)

  const contextB = await browser.newContext()
  const bob = await contextB.newPage()
  await signUp(bob, 'Bob E2E', uniqueEmail('cofund-b'))
  await bob.goto(invitePath)
  await bob.getByLabel('Your display name in this group').fill('Bob')
  await bob.getByRole('button', { name: 'Join group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the join landed and home rendered.
  await expect(bob.getByTestId('home')).toBeVisible()

  // Alice's cash wallet holds exactly ¥30,000, bought at 100 JPY = 1000 KRW.
  // A flat rate both portions share keeps the rates out of the way: this
  // test is about WHO is credited, not what the money cost.
  await alice.goto(`${groupUrl}/exchange`)
  await createWallet(alice, {
    label: 'Wallet',
    type: 'Cash',
    currency: 'JPY',
  })
  await recordTopUp(alice, {
    rate: '1000',
    received: '30000',
    expectPaid: '300000',
  })
  await expect(
    alice.getByTestId('wallet-card').filter({ hasText: 'Wallet' }),
  ).toBeVisible()

  // A ¥50,000 dinner for two, paid ¥30,000 from Alice's wallet.
  await alice.goto(`${groupUrl}/expenses/new`)
  await alice.getByTestId('amount').fill('50000')
  await alice.getByLabel('Currency').selectOption('JPY')
  await next(alice)
  await alice.getByTestId('paid-prepaid').click()
  await alice
    .locator('[data-testid^="funding-"]')
    .filter({ hasText: 'Wallet' })
    .first()
    .click()
  // The manual override every foreign-currency save in this suite uses, so
  // the server never reaches a live rate provider.
  await alice.getByTestId('manual-rate-toggle').click()
  await alice.getByTestId('market-rate').fill('1000')

  // ¥20,000 short, and "someone else covered it" is now one of the answers.
  await expect(alice.getByTestId('split-shortfall')).toContainText(
    '¥20,000 is still missing',
  )
  await alice.getByTestId('answer-someone-else').click()
  const dialog = alice.getByTestId('portion-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('How much')).toHaveValue('20000')
  // With two members, the only other one is preselected.
  await expect(dialog.getByLabel('Who paid this part')).toHaveValue(/.+/)
  await alice.getByTestId('portion-done').click()
  await expect(dialog).toHaveCount(0)
  await expect(alice.getByTestId('split-extra')).toContainText('Bob')

  for (let step = 1; step < 4; step += 1) await next(alice)
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('expense-converted')).toContainText('₩500,000')
  // The detail screen names who fronted which part.
  await expect(alice.getByTestId('funding-portions')).toContainText(
    'paid by Bob',
  )

  // The settlement. Each ate ₩250,000 of a ₩500,000 dinner; Alice put in
  // ₩300,000 and Bob ₩200,000, so Bob owes Alice exactly ₩50,000 — NOT the
  // ₩250,000 a single-payer reading of the same receipt would produce.
  // Per-person balances moved to /status (Task 5, app-shell restructure);
  // each viewer's own row states it from their own side.
  await alice.goto(`${groupUrl}/status`)
  await expect(
    alice.getByTestId('status-row').filter({ hasText: 'Alice' }),
  ).toContainText('₩50,000')

  await bob.goto(`${groupUrl}/status`)
  await expect(
    bob.getByTestId('status-row').filter({ hasText: 'Bob' }),
  ).toContainText('₩50,000')
})
