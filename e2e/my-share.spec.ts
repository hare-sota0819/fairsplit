import { expect, test, type Page } from '@playwright/test'
import { createWallet, openWallets, recordTopUp } from './wallet-flow'
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

const next = (page: Page) => page.getByTestId('wizard-next').click()

async function stubRates(page: Page): Promise<void> {
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9', asOf: '2026-08-01', today: '2026-08-02' },
    }),
  )
}

/**
 * The owner's two findings, 2026-08-05, on a receipt of their own:
 *
 *  1. "Recent expenses" showed the RECEIPT total (¥30,000) where they had
 *     eaten ¥20,000 of it, and expanding the row listed everybody's items.
 *     The feed is for remembering what YOU had, so both are now the
 *     viewer's own side of the expense — and the two members of this group
 *     see two different figures against the same row.
 *  2. A "Wallet adjustment" sat in that feed as though the group had bought
 *     one. Corrections are wallet admin: they belong to the wallets screen,
 *     which is now also the only place that makes them.
 */
test('the feed is my own share, and a wallet correction never appears in it', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await stubRates(pageA)
  await signUp(pageA, 'Alice E2E', uniqueEmail('alice'))

  await openLedger(pageA, 'My Share E2E')
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  await expect(pageA.getByTestId('home')).toBeVisible()
  const groupUrl = pageA.url().replace(/\?.*$/, '')
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await inviteJoinPath(pageA)

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await stubRates(pageB)
  await signUp(pageB, 'Bob E2E', uniqueEmail('bob'))
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Bob')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the join landed and home rendered.
  await expect(pageB.getByTestId('home')).toBeVisible()

  // A ¥30,000 receipt: ¥15,000 and ¥5,000 to Alice, ¥10,000 to Bob.
  await pageA.goto(`${groupUrl}/expenses/new`)
  await pageA.getByTestId('amount').fill('30000')
  await pageA.getByLabel('Currency').selectOption('JPY')
  await next(pageA)
  await choosePayer(pageA, 'Alice')
  await pageA.getByTestId('paid-on-the-spot').click()
  await pageA.getByTestId('manual-rate-toggle').click()
  await pageA.getByTestId('market-rate').fill('900')
  await next(pageA)

  await pageA.getByTestId('enter-manually').click()
  await pageA.getByTestId('item-name').fill('Watch 1')
  await pageA.getByTestId('item-unit-price').fill('15000')
  const addLine = async (name: string, price: string, index: number) => {
    await pageA.getByTestId('add-item').click()
    const row = pageA.getByTestId('item-row').nth(index)
    await row.getByTestId('item-name').fill(name)
    await row.getByTestId('item-unit-price').fill(price)
  }
  await addLine('Watch 2', '10000', 1)
  await addLine('Watch 3', '5000', 2)
  await expect(pageA.getByTestId('items-total')).toHaveText('¥30,000')
  await next(pageA)

  const rows = pageA.getByTestId('assign-row')
  await rows.nth(0).getByTestId('assign-toggle').click()
  await rows.nth(0).getByRole('checkbox', { name: 'Alice' }).click()
  await rows.nth(0).getByTestId('assign-done').click()
  await rows.nth(1).getByRole('checkbox', { name: 'Bob' }).click()
  await rows.nth(1).getByTestId('assign-done').click()
  await rows.nth(2).getByRole('checkbox', { name: 'Alice' }).click()
  await next(pageA)
  await pageA.getByTestId('save-expense').click()
  await expect(pageA.getByTestId('expense-converted')).toBeVisible()

  // Alice's row states HER ¥20,000, and opening it lists only her two
  // watches. The receipt total is still there, demoted to one muted line.
  // The feed lives on /history now (Task 5, app-shell restructure made
  // home chat-only), server-rendered rows only.
  await pageA.goto(`${groupUrl}/history`)
  await expect(pageA.getByTestId('feed-note')).toBeVisible()
  const aliceRow = pageA.getByTestId('feed-row').first()
  await expect(aliceRow).toContainText('¥20,000')
  await aliceRow.getByRole('button').first().click()
  const aliceItems = aliceRow.getByTestId('feed-item')
  await expect(aliceItems).toHaveCount(2)
  await expect(aliceItems.nth(0)).toContainText('Watch 1')
  await expect(aliceItems.nth(0)).toContainText('¥15,000')
  await expect(aliceItems.nth(1)).toContainText('Watch 3')
  await expect(aliceRow.getByTestId('feed-detail')).toContainText(
    'Receipt total ¥30,000',
  )
  await expect(aliceRow.getByTestId('feed-detail')).not.toContainText('Watch 2')

  // The SAME expense on Bob's history is ¥10,000, with his one watch.
  await pageB.goto(`${groupUrl}/history`)
  const bobRow = pageB.getByTestId('feed-row').first()
  await expect(bobRow).toContainText('¥10,000')
  await bobRow.getByRole('button').first().click()
  const bobItems = bobRow.getByTestId('feed-item')
  await expect(bobItems).toHaveCount(1)
  await expect(bobItems.nth(0)).toContainText('Watch 2')

  // A personal expense of Alice's: Bob had no part in it at all, which is
  // not the same as a share of zero.
  await pageA.goto(`${groupUrl}/expenses/new`)
  await pageA.getByTestId('amount').fill('4000')
  await pageA.getByLabel('Currency').selectOption('JPY')
  await next(pageA)
  await choosePayer(pageA, 'Alice')
  await pageA.getByTestId('paid-on-the-spot').click()
  await pageA.getByTestId('manual-rate-toggle').click()
  await pageA.getByTestId('market-rate').fill('900')
  await pageA.getByTestId('personal-toggle').check()
  for (let step = 1; step < 4; step += 1) await next(pageA)
  await pageA.getByTestId('save-expense').click()
  await expect(pageA.getByTestId('expense-amount')).toBeVisible()

  await pageB.goto(`${groupUrl}/history`)
  const bobPersonalRow = pageB.getByTestId('feed-row').first()
  await bobPersonalRow.getByRole('button').first().click()
  await expect(bobPersonalRow.getByTestId('feed-detail')).toContainText(
    'Nothing of yours on this one.',
  )

  // ---- Wallet corrections live on the wallets screen ----

  await pageA.goto(`${groupUrl}/exchange`)
  await createWallet(pageA, {
    label: 'Travel Card',
    type: 'Travel card',
    currency: 'JPY',
  })
  const card = pageA.getByTestId('wallet-card').filter({ hasText: 'Travel Card' })

  // Saving the top-up hands over to the wallet list, which is where every
  // correction below lives.
  await recordTopUp(pageA, { rate: '900', received: '50000' })
  await expect(card).toContainText('¥50,000 left')

  // The card really holds ¥42,000. The correction is behind a button, which
  // opens a form with its input not yet on screen.
  await expect(card.getByTestId('wallet-counted')).toHaveCount(0)
  await card.getByTestId('wallet-count-start').click()
  await expect(
    card.getByRole('heading', { name: 'Set the real balance' }),
  ).toBeVisible()
  await expect(card.getByTestId('wallet-counted')).toHaveValue('50000')
  await card.getByTestId('wallet-counted').fill('42000')
  await card.getByTestId('wallet-adjust').click()
  await expect(card).toContainText('¥42,000 left')
  await expect(card.getByTestId('wallet-adjustment-row')).toHaveCount(1)

  // It is NOT an expense of the group's, so it stays out of the feed.
  await pageA.goto(`${groupUrl}/history`)
  await expect(pageA.getByTestId('feed-row').first()).not.toContainText(
    'Wallet adjustment',
  )
  await expect(
    pageA.getByTestId('feed-row').filter({ hasText: 'Wallet adjustment' }),
  ).toHaveCount(0)

  // And it can be taken back, which is the only way out of a mistyped one.
  await openWallets(pageA, groupUrl)
  await card.getByTestId('wallet-adjustment-remove-start').click()
  await card.getByTestId('wallet-adjustment-remove').click()
  await expect(card.getByTestId('wallet-adjustment-row')).toHaveCount(0)
  await expect(card).toContainText('¥50,000 left')

  await contextA.close()
  await contextB.close()
})
