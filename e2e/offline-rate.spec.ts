import { expect, test, type Page } from '@playwright/test'
import { createWallet, recordTopUp } from './wallet-flow'

/**
 * Recording an expense with the rate provider unreachable.
 *
 * The whole suite already runs with both FX providers pointed at a closed
 * port (see `playwright.config.ts`), so "offline" is simply not entering a
 * manual override — which every other spec does precisely because this used
 * to be refused. Here that refusal is the thing under test.
 */
test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(uniqueEmail('offline'))
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

test('a wallet-funded expense saves with no market rate, and says the rate is standing in', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signUp(page, 'Offline E2E')

  await page.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill('Offline Trip E2E')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  // A wallet with a known cost: ₩93,100 bought ¥10,000, i.e. 100 JPY = 931 KRW.
  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, { label: 'Cash', currency: 'JPY' })
  await recordTopUp(page, { rate: '931', received: '10000' })

  // The expense: foreign currency, paid from that wallet, and NO manual rate.
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('3000')
  await page.getByLabel('Currency').selectOption('JPY')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('paid-prepaid').click()
  await page.locator('[data-testid^="funding-"]').filter({ hasText: 'Cash' }).click()
  for (let step = 1; step < 4; step += 1) {
    await page.getByTestId('wizard-next').click()
  }
  await page.getByTestId('save-expense').click()

  // It saves — this is the regression: it used to be refused outright.
  await expect(page.getByTestId('expense-amount')).toBeVisible()

  // And it converts at the wallet's real cost, ¥3,000 x 9.31 = ₩27,930,
  // which is the point: the number was never the market's to give.
  await expect(page.getByTestId('expense-converted')).toContainText('₩27,930')

  // The stand-in is stated rather than hidden.
  await expect(page.getByTestId('provisional-rate-banner')).toContainText(
    'standing in',
  )
})

test('a pay-as-you-go expense with no rate is still refused, because nothing can price it', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signUp(page, 'Offline Card E2E')

  await page.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill('Offline Card E2E')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('3000')
  await page.getByLabel('Currency').selectOption('JPY')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('paid-on-the-spot').click()
  for (let step = 1; step < 4; step += 1) {
    await page.getByTestId('wizard-next').click()
  }
  await page.getByTestId('save-expense').click()

  // No wallet, so no honest number exists — the user is asked, not guessed at.
  await expect(page.getByText('Live rate unavailable')).toBeVisible()
  await expect(page.getByTestId('expense-amount')).toHaveCount(0)
})
