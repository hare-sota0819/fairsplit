import { expect, test, type Locator, type Page } from '@playwright/test'
import { createWallet, openWallets, recordTopUp } from './wallet-flow'

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

const fundingOption = (page: Page, label: string): Locator =>
  page.locator('[data-testid^="funding-"]').filter({ hasText: label })

const next = (page: Page) => page.getByTestId('wizard-next').click()

async function stubRates(page: Page): Promise<void> {
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9', asOf: '2026-08-01', today: '2026-08-02' },
    }),
  )
}

/** A KRW group with one JPY travel card, topped up at 100 JPY = 930 KRW. */
async function setUp(page: Page): Promise<string> {
  await stubRates(page)
  await signUp(page, 'Alice E2E', uniqueEmail('alice'))
  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill('Till E2E')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Alice')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Wait for the redirect before reading the URL, or `page.url()` is still
  // /groups/new and every path built from it 404s.
  await expect(page.getByRole('heading', { name: 'Till E2E' })).toBeVisible()
  const groupUrl = page.url().replace(/\?.*$/, '')

  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, {
    label: 'Travel Card',
    type: 'Travel card',
    currency: 'JPY',
  })
  await recordTopUp(page, { rate: '930', received: '30000' })
  await expect(
    page.getByTestId('wallet-card').filter({ hasText: 'Travel Card' }),
  ).toContainText('¥30,000 left')
  return groupUrl
}

/**
 * The owner's own words, 2026-08-05: "if ¥30,000 is left and the bill is
 * ¥50,000, what you actually do is exchange another ¥40,000 right there and
 * then pay." The card being short is not a receipt paid from two pockets —
 * it is a card that got topped up at the till.
 *
 * Before this, the only answers on offer were splitting the receipt across
 * sources, or a "correction" that recorded the shortfall as spending that
 * never happened and threw away the rate the new money was bought at.
 */
test('a card that cannot cover the bill is topped up at the till', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const groupUrl = await setUp(page)

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('50000')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await choosePayer(page, 'Alice')
  await page.getByTestId('paid-prepaid').click()
  await fundingOption(page, 'Travel Card').click()
  // The manual override is what every foreign-currency save in this suite
  // uses so the server never reaches a live rate provider. It sets the
  // MARKET snapshot only, so the card still settles at what its money cost —
  // which is exactly what this test is about.
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('920')

  // The card is ¥20,000 short. ONE question is asked, and its answers are
  // buttons — not a panel of fields sitting open whatever the numbers say.
  await expect(page.getByTestId('split-shortfall')).toContainText(
    '¥20,000 is still missing',
  )
  await page.getByTestId('answer-till').click()
  // The fields are in a dialog, pre-filled with the one figure the app
  // already knows — the shortfall — and the rate it just looked up, because
  // money changed at a till was changed today. The real exchange was for
  // more than the gap, as it usually is.
  const tillDialog = page.getByTestId('till-dialog')
  await expect(tillDialog).toBeVisible()
  await expect(page.getByTestId('till-amount')).toHaveValue('20000')
  // The rate is STATED, not demanded: it is the one the app just looked up.
  // A booth takes a margin on top of the market, so it stays correctable.
  await expect(page.getByTestId('till-rate-auto')).toContainText(
    '100 JPY = 900 KRW',
  )
  await page.getByTestId('till-rate-change').click()
  await expect(page.getByTestId('till-rate')).toHaveValue('900')
  await page.getByTestId('till-amount').fill('40000')
  await expect(page.getByTestId('till-paid')).toHaveValue('360000')
  await page.getByTestId('till-done').click()
  await expect(tillDialog).toHaveCount(0)

  // ¥40,000 more on the card covers the bill, so the shortfall is answered
  // and the screen keeps one line about it rather than the whole form.
  await expect(page.getByTestId('split-shortfall')).toHaveCount(0)
  await expect(page.getByTestId('till-summary')).toContainText(
    'Topped up 40000 JPY on the spot',
  )
  // And the preview already quotes the BLENDED cost: ₩279,000 for ¥30,000
  // plus ₩360,000 for ¥40,000 is ₩639,000 for ¥70,000 = 9.1285…, so the
  // ¥50,000 dinner is ₩456,429 — not the ₩465,000 the old 9.30 would give.
  await expect(page.getByTestId('rate-preview')).toContainText('₩456,429')

  for (let step = 1; step < 4; step += 1) await next(page)
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-converted')).toContainText('₩456,429')
  await expect(page.getByTestId('rate-chip')).toHaveText('Travel Card rate')

  // The card: ¥30,000 + ¥40,000 − ¥50,000. No correction, no phantom
  // spending, and the top-up is an ordinary record in its history.
  await openWallets(page, groupUrl)
  const card = page.getByTestId('wallet-card').filter({ hasText: 'Travel Card' })
  await expect(card).toContainText('¥20,000 left')
  await expect(card.getByTestId('exchange-record-row')).toHaveCount(2)
  await expect(card.getByTestId('wallet-adjustment-row')).toHaveCount(0)

  // Re-opening the expense does not offer to exchange the money again: the
  // wallet is funded now, so there is no shortfall to answer. The feed lives
  // on /history now (Task 5, app-shell restructure).
  await page.goto(`${groupUrl}/history`)
  await page.getByTestId('feed-row').first().getByRole('button').first().click()
  await page.getByTestId('feed-open').click()
  await page.getByRole('link', { name: 'Edit this expense' }).click()
  await page.getByTestId('step-payment').click()
  await expect(page.getByTestId('split-shortfall')).toHaveCount(0)
  await expect(page.getByTestId('answer-till')).toHaveCount(0)
})

/**
 * The same fact, found late: the card holds more than the records explain.
 * Money only gets into a prepaid wallet one way, so the form says so and
 * asks the one thing the top-up needs — what it cost. It used to record the
 * difference as NEGATIVE spending, which balanced the wallet and silently
 * discarded the rate.
 */
test('a wallet holding more than expected records a top-up, not spending', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const groupUrl = await setUp(page)

  await openWallets(page, groupUrl)
  const card = page.getByTestId('wallet-card').filter({ hasText: 'Travel Card' })
  await card.getByTestId('wallet-count-start').click()

  // Less than expected: spending, and nothing further to ask.
  await card.getByTestId('wallet-counted').fill('25000')
  await expect(card.getByTestId('count-verdict')).toContainText(
    '¥5,000 less than the records explain',
  )
  await expect(card.getByTestId('count-rate')).toHaveCount(0)

  // More than expected: a top-up, and it wants the price.
  await card.getByTestId('wallet-counted').fill('70000')
  await expect(card.getByTestId('count-verdict')).toContainText(
    '¥40,000 more than the records explain',
  )
  await card.getByTestId('count-rate').fill('900')
  await expect(card.getByTestId('count-paid')).toHaveValue('360000')
  await card.getByTestId('wallet-adjust').click()

  // A top-up in the wallet's history — NOT a correction — and the average
  // cost moved with it: ₩639,000 for ¥70,000.
  await expect(card).toContainText('¥70,000 left')
  await expect(card.getByTestId('exchange-record-row')).toHaveCount(2)
  await expect(card.getByTestId('wallet-adjustment-row')).toHaveCount(0)
  await expect(card).toContainText('100 JPY = 912.857')

  // The price is not optional: it is this wallet's rate from here on.
  await card.getByTestId('wallet-counted').fill('90000')
  await card.getByTestId('wallet-adjust').click()
  await expect(card.getByRole('alert')).toContainText(
    'Say what the top-up cost',
  )
})
