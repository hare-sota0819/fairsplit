import { expect, test, type Locator, type Page } from '@playwright/test'
import { createWallet, recordTopUp } from './wallet-flow'

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

/** Multi-select toggles render as plain buttons carrying data-slot. */
const multiChip = (scope: Page | Locator, name: string) =>
  scope
    .locator('[data-slot=toggle-group-item]')
    .filter({ hasText: new RegExp(`^${name}$`) })

const fundingOption = (page: Page, label: string): Locator =>
  page.locator('[data-testid^="funding-"]').filter({ hasText: label })

const next = (page: Page) => page.getByTestId('wizard-next').click()

/**
 * Rate transparency and the mid-entry detour, both rebuilt on the wizard.
 *
 * The stub answers with a rate dated TWO DAYS before "today" — exactly the
 * shape of the reported complaint, where a Sunday preview served Friday's
 * ECB fix and read as simply wrong. The screen has to name that date.
 */
test('rates: as-of date, wallet detour keeps the draft, unit-anchored override, pairwise status', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  // 1 JPY = 9.1666 KRW, i.e. 100 JPY = 916.66 KRW — fixed on Jul 31, asked
  // for on Aug 2.
  await pageA.route('**/api/rates**', (route) =>
    route.fulfill({
      json: { rate: '9.1666', asOf: '2026-07-31', today: '2026-08-02' },
    }),
  )
  await signUp(pageA, 'Alice E2E', uniqueEmail('alice'))

  await pageA.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await pageA.waitForTimeout(1500)
  await pageA.getByLabel('Group name').fill('Rates E2E')
  await pageA.getByLabel('Settlement currency').selectOption('KRW')
  await pageA.getByLabel('Your display name in this group').fill('Alice')
  await pageA.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  await expect(pageA.getByTestId('home')).toBeVisible()
  const groupUrl = pageA.url()
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await pageA.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signUp(pageB, 'Bob E2E', uniqueEmail('bob'))
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Bob')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the join landed and home rendered.
  await expect(pageB.getByTestId('home')).toBeVisible()

  await pageA.goto(`${groupUrl}/expenses/new`)
  await pageA.getByTestId('amount').fill('5000')
  await pageA.getByLabel('Currency').selectOption('JPY')

  // Step 1 states the conversion, the rate, and — the Phase 4A fix — the day
  // that rate is actually for, plus what kind of rate it is.
  await expect(pageA.getByTestId('converted-preview')).toHaveText('≈ ₩45,833')
  await expect(pageA.getByTestId('rate-preview')).toContainText(
    '100 JPY = 916.66 KRW',
  )
  await expect(pageA.getByTestId('rate-as-of')).toHaveText('rate as of Jul 31')
  // The ECB explainer is gone with the daily fixing it described (Phase
  // 4D-A): the live source restamps every minute, so claiming a weekday
  // publication schedule would be untrue.
  await expect(pageA.getByTestId('rate-preview')).not.toContainText(
    'European Central Bank',
  )
  await expect(pageA.getByTestId('rate-preview')).toContainText(
    'Market rate. Your bank or card will charge a little more.',
  )
  // ...and the number is labelled with WHICH rate it is, at every stage.
  await expect(pageA.getByTestId('rate-source-label')).toHaveText('market rate')
  // The date is on this first screen, not buried at the bottom.
  await expect(pageA.getByTestId('timestamp')).toBeVisible()
  await next(pageA)

  // Step 2 — two questions, not one flat list. Alice holds no wallets, so
  // the follow-up asks for the rate SHE exchanged at rather than offering
  // her a wallet she does not have.
  await expect(pageA.getByTestId('paid-on-the-spot')).toBeVisible()
  await pageA.getByTestId('paid-prepaid').click()
  await expect(pageA.getByTestId('no-wallets-note')).toBeVisible()
  await pageA.getByTestId('own-rate').fill('890')
  // The figure moves, in place, off the market rate and onto her own — and
  // says which one it is now using.
  await expect(pageA.getByTestId('rate-source-label').first()).toHaveText(
    'your exchange rate',
  )
  await expect(pageA.getByTestId('converted-preview').first()).toHaveText(
    '≈ ₩44,500',
  )
  // Back to paying on the spot for the rest of this walkthrough.
  await pageA.getByTestId('paid-on-the-spot').click()

  // Dropping Bob from the split removes him from the review entirely — the
  // check the "consumed nothing but owes money" report needed.
  const bobChip = multiChip(
    pageA.locator('fieldset').filter({ hasText: 'Shared between' }),
    'Bob',
  )
  await bobChip.click()
  for (let step = 1; step < 4; step += 1) await next(pageA)
  await expect(pageA.getByTestId('split-preview')).not.toContainText('Bob')
  await pageA.getByTestId('step-payment').click()
  await bobChip.click()

  // The mid-entry detour: set a wallet up without losing a keystroke.
  await pageA.getByTestId('add-wallet-link').click()
  await createWallet(pageA, { label: 'Cash', currency: 'JPY' })
  await expect(pageA.getByTestId('exchange-rate-anchor')).toHaveText(
    '100 JPY =',
  )
  await recordTopUp(pageA, {
    rate: '900',
    received: '20000',
    expectPaid: '180000',
  })
  // Saving the top-up is the moment the wallet is actually usable, so this
  // is where the auto-return now fires — no manual "back" click needed. The
  // record itself is asserted by the wallet spec, which stays on the screen.
  await expect(pageA).toHaveURL(/\/expenses\/new/)

  // Everything typed is still there, including the step it was left on.
  await expect(pageA.getByTestId('paid-on-the-spot')).toBeVisible()
  await pageA.getByTestId('step-amount').click()
  await expect(pageA.getByTestId('amount')).toHaveValue('5000')

  // Pick the wallet: the expense now converts at what that money cost her
  // (900), not at the day's market rate (916.66) — and it changes ON THIS
  // SCREEN, where the question was answered.
  await pageA.getByTestId('step-payment').click()
  // Answering "prepaid" preselects her only pot, so the number moves the
  // moment the question is answered rather than waiting for a second tap.
  await pageA.getByTestId('paid-prepaid').click()
  await fundingOption(pageA, 'Cash').first().click()
  await expect(pageA.getByTestId('converted-preview')).toHaveText('≈ ₩45,000')
  await expect(pageA.getByTestId('rate-preview')).toContainText(
    '100 JPY = 900 KRW',
  )
  await expect(pageA.getByTestId('rate-source-label')).toHaveText('Cash rate')

  // Step 1 keeps quoting the MARKET rate: it is asked before "what did you
  // pay with?", so it must not answer that question on the user's behalf.
  await pageA.getByTestId('step-amount').click()
  await expect(pageA.getByTestId('converted-preview')).toHaveText('≈ ₩45,833')
  await expect(pageA.getByTestId('rate-source-label')).toHaveText('market rate')
  await pageA.getByTestId('step-payment').click()

  // Manual override: opt-in, unit-anchored, and it catches the 100x mistake.
  await pageA.getByTestId('manual-rate-toggle').click()
  await expect(pageA.getByTestId('rate-anchor')).toHaveText('100 JPY =')
  await pageA.getByTestId('market-rate').fill('91666')
  await expect(pageA.getByTestId('rate-unusual')).toBeVisible()
  await pageA.getByTestId('market-rate').fill('916.66')
  await expect(pageA.getByTestId('rate-unusual')).toHaveCount(0)

  for (let step = 1; step < 4; step += 1) await next(pageA)
  await pageA.getByTestId('save-expense').click()
  // The override sets the MARKET snapshot only; in average-cost mode a
  // prepaid wallet still settles at what its money cost. The preview said
  // ₩45,000 and the saved expense agrees.
  await expect(pageA.getByTestId('expense-converted')).toContainText('₩45,000')
  await expect(pageA.getByTestId('rate-chip')).toHaveText('Cash rate')

  // Status: net summary, expanding onto the pairwise ledger — home is
  // chat-only (Task 5, app-shell restructure) and no longer has a
  // per-person balance of its own to check first.
  await pageB.goto(`${groupUrl}/status`)
  const rows = pageB.getByTestId('status-row')
  await expect(rows.nth(0)).toContainText('Alice')
  await expect(pageB.getByTestId('pairwise-breakdown')).toHaveCount(0)
  await rows.nth(1).getByTestId('status-row-toggle').click()
  const breakdown = pageB.getByTestId('pairwise-breakdown')
  // Bob's own row expands onto his ledger with Alice. Status names a third
  // party, so the line has to say WHICH WAY the money goes — and it says it
  // with an arrow rather than "owes"/"is owed by", because an arrow reads the
  // same in every language and cannot be read backwards.
  await expect(breakdown).toContainText('→ Alice')
  await expect(breakdown).toContainText('₩22,500')

  await contextA.close()
  await contextB.close()
})
