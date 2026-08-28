import { expect, test, type Page } from '@playwright/test'
import { addFundedWallet, chooseWallet, recordTopUp } from './wallet-flow'
import { openLedger } from './group-flow'

/**
 * The whole promise of a checkpoint, end to end: once a period is settled,
 * a top-up logged afterwards cannot move one won of it.
 *
 * This is the flow the feature exists for, so it is driven through the real
 * screens rather than asserted in a unit test alone — the freeze has to
 * survive the wizard, the action, the reload and the chip.
 */
test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (tag: string) =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page: Page, name: string): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(uniqueEmail('checkpoint'))
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

test('a checkpoint settles a period, and a later top-up cannot move it', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signUp(page, 'Checkpoint E2E')

  await openLedger(page, 'Checkpoint Trip E2E')
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  // ₩93,100 bought ¥10,000: the wallet's money cost 9.31 KRW per yen.
  await addFundedWallet(
    page,
    groupUrl,
    { label: 'Cash', currency: 'JPY' },
    { rate: '931', received: '10000' },
  )

  // ¥3,000 out of that wallet: ¥3,000 x 9.31 = ₩27,930.
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('3000')
  await page.getByLabel('Currency').selectOption('JPY')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('paid-prepaid').click()
  await page
    .locator('[data-testid^="funding-"]')
    .filter({ hasText: 'Cash' })
    .click()
  for (let step = 1; step < 4; step += 1) {
    await page.getByTestId('wizard-next').click()
  }
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-converted')).toContainText('₩27,930')
  const expenseUrl = page.url().split('?')[0]

  // Draw the barrier. The form's default moment is "now", which is after the
  // expense just entered.
  await page.goto(`${groupUrl}/checkpoints`)
  await expect(page.getByTestId('checkpoints-empty')).toBeVisible()
  await page.getByTestId('checkpoint-name').fill('Day 1 settle-up')
  await page.getByTestId('checkpoint-submit').click()
  await expect(page.getByTestId('checkpoint-saved')).toContainText(
    '1 expenses frozen',
  )
  await expect(page.getByTestId('checkpoint-list')).toContainText(
    'Day 1 settle-up',
  )

  // The expense now says so, and offers no way to change it in place.
  await page.goto(expenseUrl)
  await expect(page.getByTestId('rate-chip')).toContainText('frozen')
  await expect(page.getByTestId('expense-frozen-notice')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Edit expense' })).toHaveCount(0)

  // Even reached directly, the edit screen refuses rather than offering a
  // form whose save would be rejected.
  await page.goto(`${expenseUrl}/edit`)
  await expect(page.getByTestId('edit-frozen-notice')).toBeVisible()
  await expect(page.getByTestId('amount')).toHaveCount(0)

  // A forgotten exchange, logged now: ₩50,000 for ¥10,000 is 5.0 KRW per yen,
  // which would drag the wallet's average from 9.31 down to 7.155 and reprice
  // the settled expense from ₩27,930 to ₩21,465 if the barrier did not hold.
  await page.goto(`${groupUrl}/exchange`)
  await chooseWallet(page, 'Cash')
  await recordTopUp(page, { rate: '500', received: '10000' })

  // The notice fired while entering it — a record dated inside a settled
  // period has to say what it will and will not do.
  await page.goto(`${groupUrl}/exchange`)
  await chooseWallet(page, 'Cash')
  await page.getByTestId('exchange-rate').fill('500')
  await page.getByTestId('topup-next').click()
  await page.getByTestId('exchange-received').fill('1')
  await expect(page.getByTestId('exchange-before-checkpoint')).toContainText(
    'already-settled periods',
  )

  // The settled number has not moved.
  await page.goto(expenseUrl)
  await expect(page.getByTestId('expense-converted')).toContainText('₩27,930')
  await expect(page.getByTestId('rate-chip')).toContainText('frozen')
})
