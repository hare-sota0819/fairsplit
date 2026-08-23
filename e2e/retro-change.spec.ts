import { expect, test, type Page } from '@playwright/test'
import { addFundedWallet } from './wallet-flow'

/**
 * The seam between the two halves of checkpoint finality.
 *
 * Stage 1 made a settled expense refuse to be edited. This spec is about what
 * that refusal turns INTO: pressing the same button lands on the same wizard,
 * and saving asks the group instead of changing the numbers. A run that ended
 * at a "frozen" error would mean the feature was built but never connected.
 *
 * It also drives the three things no screenshot can show — serialization,
 * auto-approval, and the audit log recording a refusal — through the real UI.
 */
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
 * Change the amount of an expense the wizard opened for EDITING.
 *
 * An edit opens on Review — everything is already answered — so the amount is
 * reached by tapping the step, not by walking forward from the start. The
 * progress steps are tappable in both directions, which is what makes this the
 * shortest honest path rather than a trick.
 */
async function reviseAmount(page: Page, amount: string): Promise<void> {
  await page.getByRole('button', { name: 'Amount', exact: true }).click()
  await page.getByTestId('amount').fill(amount)
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.getByTestId('save-expense')).toBeVisible()
}

/** Walk the wizard from the amount step to the save button. */
async function fillWizard(
  page: Page,
  amount: string,
  walletLabel: string,
): Promise<void> {
  await page.getByTestId('amount').fill(amount)
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await page.getByTestId('paid-prepaid').click()
  await page
    .locator('[data-testid^="funding-"]')
    .filter({ hasText: walletLabel })
    .first()
    .click()
  for (let step = 1; step < 4; step += 1) {
    await next(page)
  }
}

test('a settled expense is corrected by asking, not by refusing', async ({
  browser,
}) => {
  test.setTimeout(240_000)

  const contextA = await browser.newContext()
  const alice = await contextA.newPage()
  await signUp(alice, 'Alice Retro', uniqueEmail('retro-a'))
  await alice.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration settles can
  // lose the typed values. The documented workaround.
  await alice.waitForTimeout(1500)
  await alice.getByLabel('Group name').fill('Retro Change E2E')
  await alice.getByLabel('Settlement currency').selectOption('KRW')
  await alice.getByLabel('Your display name in this group').fill('Alice')
  await alice.getByRole('button', { name: 'Create group' }).click()
  await expect(alice.getByTestId('home')).toBeVisible()
  const groupUrl = alice.url()

  await alice.goto(`${groupUrl}/invite`)
  const invitePath = await alice.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const bob = await contextB.newPage()
  await signUp(bob, 'Bob Retro', uniqueEmail('retro-b'))
  await bob.goto(invitePath)
  await bob.getByLabel('Your display name in this group').fill('Bob')
  await bob.getByRole('button', { name: 'Join group' }).click()
  await expect(bob.getByTestId('home')).toBeVisible()

  // A flat 100 JPY = 1000 KRW keeps the arithmetic readable: ¥10,000 is
  // ₩100,000, split two ways, so Bob owes Alice ₩50,000.
  await addFundedWallet(
    alice,
    groupUrl,
    { label: 'Wallet', type: 'Cash', currency: 'JPY' },
    { rate: '1000', received: '60000' },
  )

  await alice.goto(`${groupUrl}/expenses/new`)
  await fillWizard(alice, '10000', 'Wallet')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('expense-amount')).toBeVisible()
  const expenseUrl = alice.url().split('?')[0]

  // Settle the period.
  await alice.goto(`${groupUrl}/checkpoints`)
  await alice.getByTestId('checkpoint-name').fill('Day 1')
  await alice.getByTestId('checkpoint-submit').click()
  await expect(alice.getByTestId('checkpoint-saved')).toBeVisible()

  await alice.goto(groupUrl)
  await expect(alice.getByTestId('home-balances')).toContainText('₩50,000')

  // ---- THE SEAM -----------------------------------------------------------
  // Edit is offered on a settled expense, and it leads to the wizard, not to
  // a refusal.
  await alice.goto(expenseUrl)
  await expect(alice.getByTestId('expense-frozen-notice')).toBeVisible()
  await alice.getByTestId('request-edit').click()
  await expect(alice.getByTestId('propose-notice')).toBeVisible()

  // Alice says the dinner was ¥16,000, not ¥10,000. Bob's share rises, so Bob
  // is worse off and has to agree.
  await reviseAmount(alice, '16000')
  await alice.getByTestId('save-expense').click()
  await expect(alice).toHaveURL(/\/changes/)
  await expect(alice.getByTestId('pending-request')).toBeVisible()
  await expect(alice.getByTestId('pending-diff')).toContainText('₩30,000')

  // The numbers on the balance screen have NOT moved, and say a change is
  // waiting on someone.
  await alice.goto(groupUrl)
  await expect(alice.getByTestId('pending-change-badge')).toBeVisible()
  await expect(alice.getByTestId('home-balances')).toContainText('₩50,000')

  // ---- SERIALIZATION ------------------------------------------------------
  await alice.goto(`${expenseUrl}/edit?propose=1`)
  await reviseAmount(alice, '12000')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('wizard-error')).toContainText(
    'Another change is pending',
  )

  // ---- CONSENT ------------------------------------------------------------
  // Alice is not a stakeholder: the change makes her better off, so she is
  // not asked.
  await alice.goto(`${groupUrl}/changes`)
  await expect(alice.getByTestId('pending-readonly')).toContainText('not asked')

  await bob.goto(`${groupUrl}/changes`)
  await expect(bob.getByTestId('pending-diff')).toContainText('₩30,000')
  await bob.getByTestId('respond-approve').click()
  await expect(bob.getByTestId('changes-none-pending')).toBeVisible()

  // Applied: ¥16,000 at 10 KRW/yen is ₩160,000, half of which is ₩80,000.
  await bob.goto(groupUrl)
  await expect(bob.getByTestId('home-balances')).toContainText('₩80,000')
  await expect(bob.getByTestId('pending-change-badge')).toHaveCount(0)

  // The log says what happened, and who said what.
  await bob.goto(`${groupUrl}/changes`)
  await expect(bob.getByTestId('audit-RETRO_CHANGE_APPROVED')).toBeVisible()
  await expect(bob.getByTestId('changes-history')).toContainText('Bob agreed')

  // ---- AUTO-APPROVAL ------------------------------------------------------
  // Back down to ¥10,000: Bob only gains, so nobody is asked and it lands at
  // once. This is the shortcut being a consequence of the stakeholder rule
  // rather than an exception to it.
  await alice.goto(`${expenseUrl}/edit?propose=1`)
  await reviseAmount(alice, '10000')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('expense-amount')).toBeVisible()

  await alice.goto(groupUrl)
  await expect(alice.getByTestId('pending-change-badge')).toHaveCount(0)
  await expect(alice.getByTestId('home-balances')).toContainText('₩50,000')

  await alice.goto(`${groupUrl}/changes`)
  await expect(
    alice.getByTestId('audit-RETRO_CHANGE_AUTO_APPROVED'),
  ).toBeVisible()
  await expect(alice.getByTestId('changes-history')).toContainText(
    'nobody had to be asked',
  )
})

test('a refusal is recorded, and changes nothing', async ({ browser }) => {
  test.setTimeout(240_000)

  const contextA = await browser.newContext()
  const alice = await contextA.newPage()
  await signUp(alice, 'Alice Reject', uniqueEmail('reject-a'))
  await alice.goto('/groups/new')
  await alice.waitForTimeout(1500)
  await alice.getByLabel('Group name').fill('Retro Reject E2E')
  await alice.getByLabel('Settlement currency').selectOption('KRW')
  await alice.getByLabel('Your display name in this group').fill('Alice')
  await alice.getByRole('button', { name: 'Create group' }).click()
  await expect(alice.getByTestId('home')).toBeVisible()
  const groupUrl = alice.url()

  await alice.goto(`${groupUrl}/invite`)
  const invitePath = await alice.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const bob = await contextB.newPage()
  await signUp(bob, 'Bob Reject', uniqueEmail('reject-b'))
  await bob.goto(invitePath)
  await bob.getByLabel('Your display name in this group').fill('Bob')
  await bob.getByRole('button', { name: 'Join group' }).click()
  await expect(bob.getByTestId('home')).toBeVisible()

  await addFundedWallet(
    alice,
    groupUrl,
    { label: 'Wallet', type: 'Cash', currency: 'JPY' },
    { rate: '1000', received: '60000' },
  )
  await alice.goto(`${groupUrl}/expenses/new`)
  await fillWizard(alice, '10000', 'Wallet')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('expense-amount')).toBeVisible()
  const expenseUrl = alice.url().split('?')[0]

  await alice.goto(`${groupUrl}/checkpoints`)
  await alice.getByTestId('checkpoint-name').fill('Day 1')
  await alice.getByTestId('checkpoint-submit').click()
  await expect(alice.getByTestId('checkpoint-saved')).toBeVisible()

  await alice.goto(`${expenseUrl}/edit?propose=1`)
  await reviseAmount(alice, '16000')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('pending-request')).toBeVisible()

  await bob.goto(`${groupUrl}/changes`)
  await bob.getByTestId('respond-reject').click()

  // Nothing moved, and the refusal is in the log — a record of what happened,
  // not a record of what was agreed.
  await expect(bob.getByTestId('audit-RETRO_CHANGE_REJECTED')).toBeVisible()
  await bob.goto(groupUrl)
  await expect(bob.getByTestId('home-balances')).toContainText('₩50,000')
  await expect(bob.getByTestId('pending-change-badge')).toHaveCount(0)

  // And the group is not stuck: with the refusal decided, a new request opens.
  await alice.goto(`${expenseUrl}/edit?propose=1`)
  await reviseAmount(alice, '14000')
  await alice.getByTestId('save-expense').click()
  await expect(alice.getByTestId('pending-request')).toBeVisible()
})
