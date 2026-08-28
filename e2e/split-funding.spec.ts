import { expect, test, type Page } from '@playwright/test'
import { createWallet, openWallets, recordTopUp } from './wallet-flow'
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

/**
 * The reported bug, end to end (docs/BUGS.md 2026-08-04).
 *
 * A travel card holding ¥50,000 paid an ¥82,000 receipt and the wizard said
 * nothing. The wallet went to "¥32,000 over" — but the real damage was the
 * settlement figure: the whole ¥82,000 converted at the card's rate, ₩7,360
 * more than the money actually cost.
 *
 *   ¥50,000 off the card at 100 JPY = 930 KRW -> ₩465,000
 *   ¥32,000 on the spot at 100 JPY = 907 KRW  -> ₩290,240
 *                                                ₩755,240, not ₩762,600.
 */
test('an expense larger than its wallet is split, and each part keeps its own rate', async ({
  page,
}) => {
  test.setTimeout(120_000)
  // The preview's lookup is stubbed; the SAVE calls the provider server-side,
  // which a browser route cannot intercept, so the expense also carries a
  // manual rate override.
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9.07', asOf: '2026-08-04', today: '2026-08-04' },
    }),
  )

  await signUp(page, 'Sota E2E', uniqueEmail('split'))
  await openLedger(page, 'Split E2E')
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  // A travel card with exactly ¥50,000 on it, bought at 100 JPY = 930 KRW.
  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, {
    label: 'Travel Wallet',
    type: 'Travel card',
    currency: 'JPY',
  })
  await recordTopUp(page, {
    rate: '930',
    received: '50000',
    expectPaid: '465000',
  })
  await expect(
    page.getByTestId('wallet-card').filter({ hasText: 'Travel Wallet' }),
  ).toBeVisible()

  // The ¥82,000 dinner.
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('82000')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await choosePayer(page, 'Sota')
  await page.getByTestId('paid-prepaid').click()
  await page
    .locator('[data-testid^="funding-"]')
    .filter({ hasText: 'Travel Wallet' })
    .first()
    .click()

  // The wizard asks ONE question about the ¥32,000 it cannot account for.
  // With no second wallet, the two answers are the top-up and the card.
  await expect(page.getByTestId('split-shortfall')).toContainText(
    '¥32,000 is still missing',
  )
  await expect(page.getByTestId('answer-till')).toBeVisible()
  await page.getByTestId('answer-on-the-spot').click()

  // The fields are in a dialog, pre-filled with the gap.
  const portionDialog = page.getByTestId('portion-dialog')
  await expect(portionDialog).toBeVisible()
  await expect(portionDialog.getByLabel('How much')).toHaveValue('32000')
  await expect(portionDialog.getByLabel('Where from')).toHaveValue(
    'PAY_AS_YOU_GO',
  )
  // The portion may not name the primary source again: that would be two
  // portions that are one. Nor "money I exchanged myself" — that is the
  // answer for a payer with no wallet in this currency, and this one has a
  // wallet, so the only remaining answer is the market-rate one.
  await expect(
    portionDialog.getByLabel('Where from').locator('option'),
  ).toHaveText(['Paid on the spot'])
  await page.getByTestId('portion-done').click()
  await expect(portionDialog).toHaveCount(0)

  // The chosen wallet is the first row of the portion list, and the question
  // is gone now that the arithmetic adds up.
  await expect(page.getByTestId('split-shortfall')).toHaveCount(0)
  await expect(page.getByTestId('split-primary-row')).toContainText(
    'Travel Wallet',
  )
  await expect(page.getByTestId('split-primary')).toContainText('¥50,000')
  await expect(page.getByTestId('split-extra')).toContainText('32000 JPY')

  // Both rates are stated before saving; no single one is claimed.
  await expect(page.getByTestId('rate-portions')).toContainText('¥50,000')
  await expect(page.getByTestId('rate-portions')).toContainText('¥32,000')
  await expect(page.getByTestId('converted-preview')).toContainText('₩755,240')

  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('907')
  for (let step = 1; step < 4; step += 1) await next(page)
  await expect(page.getByTestId('review-split-funding')).toContainText(
    '100 JPY = 930',
  )
  await page.getByTestId('save-expense').click()

  // Saved: the settlement figure is the sum of the two conversions, and the
  // screen names both sources rather than inventing a rate for the whole.
  await expect(page.getByTestId('expense-converted')).toContainText('₩755,240')
  await expect(page.getByTestId('rate-chip')).toHaveText('split across sources')
  await expect(page.getByTestId('expense-method')).toContainText(
    'more than one source',
  )
  const expenseUrl = page.url()
  const portions = page.getByTestId('funding-portions')
  await expect(portions).toContainText('¥50,000 — Travel Wallet')
  await expect(portions).toContainText('¥32,000 — on the spot')

  // And the wallet is drawn down by ITS portion only: empty, not overdrawn.
  // Wallet balances live on /exchange now (Task 5, app-shell restructure).
  await openWallets(page, groupUrl)
  const card = page.getByTestId('wallet-card').filter({ hasText: 'Travel' })
  await expect(card).toContainText('¥0 left')
  await expect(card).not.toContainText('over')

  // Re-opening the expense brings the split back rather than collapsing it.
  await page.goto(expenseUrl)
  await page.getByRole('link', { name: 'Edit this expense' }).click()
  await page.getByTestId('step-payment').click()
  const saved = page.getByTestId('split-extra').first()
  await expect(saved).toContainText('32000 JPY')

  // An expense being edited must not count against the wallet it came out
  // of. Drop the extra and the card has its ¥50,000 back — not ¥0, which is
  // what its own dinner would leave if that dinner counted twice.
  await saved.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('split-shortfall')).toContainText(
    '¥32,000 is still missing',
  )
})

/**
 * Overspending a wallet is still allowed — people forget to log a top-up far
 * more often than they overspend. What must not happen is the wallet card
 * offering a correction it will then refuse.
 */
test('an overdrawn wallet offers a count of zero, not a negative one', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9.07', asOf: '2026-08-04', today: '2026-08-04' },
    }),
  )

  await signUp(page, 'Over E2E', uniqueEmail('over'))
  await openLedger(page, 'Overdraft E2E')
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, { label: 'Pocket', type: 'Cash', currency: 'JPY' })
  await recordTopUp(page, { rate: '930', received: '10000' })

  // ¥15,000 out of a ¥10,000 pocket, and the split question declined.
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('15000')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await choosePayer(page, 'Over')
  await page.getByTestId('paid-prepaid').click()
  await expect(page.getByTestId('split-shortfall')).toContainText(
    '¥5,000 is still missing',
  )
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('907')
  for (let step = 1; step < 4; step += 1) await next(page)
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-converted')).toBeVisible()

  // Wallet balances live on /exchange now (Task 5, app-shell restructure).
  await openWallets(page, groupUrl)
  const card = page.getByTestId('wallet-card').filter({ hasText: 'Pocket' })
  await expect(card).toContainText('¥5,000 over')
  // The /exchange wallet card (unlike home's old one) shows the overdrawn
  // hint directly, with no details/summary toggle to open first.
  await expect(card.getByTestId('wallet-overdrawn-hint')).toBeVisible()
  // The balance and nothing else at this point. The correction form used to
  // sit here, open and pre-filled with the figure printed above it.
  await expect(card.getByTestId('wallet-counted')).toHaveCount(0)

  await openWallets(page, groupUrl)
  const walletCard = page
    .getByTestId('wallet-card')
    .filter({ hasText: 'Pocket' })
  await walletCard.getByTestId('wallet-count-start').click()
  // Zero, not -5000: the action refuses anything below zero, so the old
  // default was the one value its own form would reject.
  await expect(walletCard.getByTestId('wallet-counted')).toHaveValue('0')
})
