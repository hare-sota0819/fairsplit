import { expect, test, type Locator, type Page } from '@playwright/test'
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

/** Add one receipt line: name, UNIT price, and how many of them. */
async function addItem(
  page: Page,
  name: string,
  unitPrice: string,
  qty = 1,
): Promise<void> {
  const existing = await page.getByTestId('item-row').count()
  await page.getByTestId(existing === 0 ? 'enter-manually' : 'add-item').click()
  const row = page.getByTestId('item-row').last()
  await row.getByTestId('item-name').fill(name)
  await row.getByTestId('item-unit-price').fill(unitPrice)
  for (let i = 1; i < qty; i += 1) {
    await row.getByTestId('item-qty-up').click()
  }
}

/** Open one assignment row by its item name. */
function assignRow(page: Page, name: string): Locator {
  return page
    .getByTestId('assign-row')
    .filter({ hasText: new RegExp(`^${name}`) })
}

/**
 * Izakaya walkthrough (Phase 4A definition of done): three people, a line of
 * three beers taken one each, a solo sake, and an unassigned service charge.
 *
 * Hand-checked (payer Alice, settlement KRW, no conversion):
 *   beer   1,500 x 3 = 4,500, one unit each  -> 1,500 each
 *   sake     800 x 1, Bob only               -> 800 to Bob
 *   charge   500 x 1, unassigned             -> split 1500:2300:1500
 *   subtotals Alice 1,500 / Bob 2,300 / Carol 1,500 (sum 5,300)
 *   Alice = 1500 + 500*1500/5300 = 87,000/53  = 1,641.50… -> 1,642
 *   Bob   = 2300 + 500*2300/5300 = 133,400/53 = 2,516.98… -> 2,517
 *   Carol = same as Alice                                 -> 1,642
 * Rows therefore add up to 5,801 against a 5,800 total: one minor unit of
 * payer-favoured rounding, which the review step has to admit to.
 */
test('izakaya wizard: unit price x qty, per-person quantity, unassigned charge', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  // The group calls this member by the ACCOUNT's name now (patches5):
  // the create form no longer asks for a per-group display name.
  await signUp(pageA, 'Alice', uniqueEmail('alice'))

  await openLedger(pageA, 'Izakaya E2E')
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  await expect(pageA.getByTestId('home')).toBeVisible()
  const groupUrl = pageA.url()
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await inviteJoinPath(pageA)

  const others: { page: Page; close: () => Promise<void> }[] = []
  for (const name of ['Bob', 'Carol']) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signUp(page, `${name} E2E`, uniqueEmail(name.toLowerCase()))
    await page.goto(invitePath)
    await page.getByLabel('Your display name in this group').fill(name)
    await page.getByRole('button', { name: 'Join group' }).click()
    // Home is the expense feed (chat removal, 2026-08-21): it being
    // there is proof the join landed and home rendered.
    await expect(page.getByTestId('home')).toBeVisible()
    others.push({ page, close: () => context.close() })
  }
  const [bob, carol] = others

  await pageA.goto(`${groupUrl}/expenses/new`)

  // Step 1 — amount and when. The date lives here now, not at the bottom.
  await expect(pageA.getByTestId('timestamp')).toHaveValue(/\d{4}-\d{2}-\d{2}T/)
  await pageA.getByTestId('amount').fill('5800')
  await next(pageA)

  // Step 2 — payer, then the two questions. "Was this prepaid?" is asked on
  // its own; Alice has no wallet, so the follow-up says so instead of
  // offering her one she does not have.
  await expect(pageA.getByTestId('paid-on-the-spot')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await pageA.getByTestId('paid-prepaid').click()
  await expect(pageA.getByTestId('no-wallets-note')).toBeVisible()
  // Same currency as the group, so there is no rate to ask about.
  await expect(pageA.getByTestId('own-rate')).toHaveCount(0)
  await pageA.getByTestId('paid-on-the-spot').click()
  await next(pageA)

  // Step 3 — items, priced per unit, with the line maths shown as typed.
  // What is still unaccounted for, live, while typing — the reason to enter
  // items by hand at all: type what you remember, and the remainder tells
  // you what everyone else had.
  await addItem(pageA, 'beer', '1500', 3)
  await expect(pageA.getByTestId('items-remaining')).toHaveText(
    '₩1,300 left to enter',
  )
  await expect(pageA.getByTestId('line-math').last()).toHaveText(
    '₩1,500 × 3 = ₩4,500',
  )
  await addItem(pageA, 'sake', '800')
  await addItem(pageA, 'service charge', '500')
  await expect(pageA.getByTestId('items-total')).toHaveText('₩5,800')
  await expect(pageA.getByTestId('items-remaining')).toHaveText(
    'That is the whole amount.',
  )
  await next(pageA)

  // Step 4 — who had what. One beer each; the sake is Bob's; the service
  // charge stays unassigned on purpose.
  const beer = assignRow(pageA, 'beer')
  await beer.getByTestId('assign-toggle').click()
  await beer.getByRole('button', { name: 'Everyone' }).click()
  await expect(beer.getByTestId('assign-status')).toHaveText('3 of 3 assigned')

  const sake = assignRow(pageA, 'sake')
  await sake.getByTestId('assign-toggle').click()
  // Opening a row closes the one before it: two rosters of the same names on
  // screen at once is how a tick lands on the heading you scrolled past.
  await expect(beer.getByTestId('assign-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  await sake.getByRole('checkbox', { name: 'Bob' }).check()

  await expect(
    assignRow(pageA, 'service charge').getByTestId('unassigned-badge'),
  ).toBeVisible()
  await next(pageA)

  // Step 5 — the receipt agrees, and the breakdown owns up to its rounding.
  await expect(pageA.getByTestId('discrepancy-ok')).toBeVisible()
  await expect(pageA.getByTestId('split-preview')).toContainText('₩1,642')
  await expect(pageA.getByTestId('split-preview')).toContainText('₩2,517')
  await expect(pageA.getByTestId('split-sum')).toContainText('₩5,801')

  await pageA.getByTestId('save-expense').click()
  await expect(pageA.getByTestId('expense-amount')).toHaveText('₩5,800')
  await expect(pageA.getByTestId('entered-by')).toHaveText('Entered by Alice')
  const expenseUrl = pageA.url().replace(/\?.*$/, '')

  // Status: payer-favoured rounding lands where it was predicted. Per-person
  // balances moved off home (Task 5, app-shell restructure) — each viewer's
  // own row states what they owe (here, only Alice, so it is the same
  // figure home's old per-person row would have shown).
  const ownRow = (page: Page, name: string) =>
    page.getByTestId('status-row').filter({ hasText: name })
  await bob.page.goto(`${groupUrl}/status`)
  await expect(ownRow(bob.page, 'Bob')).toContainText('To pay')
  await expect(ownRow(bob.page, 'Bob')).toContainText('₩2,517')
  await carol.page.goto(`${groupUrl}/status`)
  await expect(ownRow(carol.page, 'Carol')).toContainText('₩1,642')

  await pageA.goto(`${groupUrl}/status`)
  const statusRows = pageA.getByTestId('status-row')
  await expect(statusRows).toHaveCount(3)
  await expect(statusRows.nth(0)).toContainText('Alice')
  await expect(statusRows.nth(0)).toContainText('₩4,159')

  // My spending: Alice's own share, including her cut of the service charge.
  await pageA.goto(`${groupUrl}/me`)
  await expect(pageA.getByTestId('my-total')).toHaveText('₩1,642')

  // Editing is a CORRECTION, not a re-entry. Everything is already filled in
  // and valid, so the form opens on Review — where Save lives — instead of
  // making a one-word fix walk the whole five steps again to reach a button.
  await pageA.goto(expenseUrl)
  await pageA.getByRole('link', { name: 'Edit this expense' }).click()
  await expect(pageA.getByTestId('step-label')).toHaveText(
    'Step 5 of 5: Review',
  )
  await expect(pageA.getByTestId('save-expense')).toBeVisible()

  // And every earlier step is one tap away, not four Nexts.
  await pageA.getByTestId('step-amount').click()
  await expect(pageA.getByTestId('amount')).toHaveValue('5800')
  await pageA.getByTestId('amount').fill('5900')
  // Save without walking forward again: the button is on Review, which is
  // still reachable in one tap.
  await pageA.getByTestId('step-review').click()
  await pageA.getByTestId('save-expense').click()
  await expect(pageA.getByTestId('expense-amount')).toHaveText('₩5,900')

  await contextA.close()
  for (const other of others) await other.close()
})

/**
 * The two input defects reported from a real phone, pinned so they cannot
 * come back: typing into a pre-filled numeric field appended instead of
 * replacing, and removing a line was a one-tap loss.
 */
test('numeric inputs replace on focus, and a removed line can be undone', async ({
  page,
}) => {
  await signUp(page, 'Dana E2E', uniqueEmail('dana'))
  await openLedger(page, 'Inputs E2E')
  // Read the URL only once the redirect has landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('1000')
  await next(page)
  await next(page)

  await addItem(page, 'coffee', '4000')
  const qty = page.getByTestId('item-qty')
  await expect(qty).toHaveValue('1')
  // Focus, then type "3": it must be 3, not 13.
  await qty.click()
  await page.keyboard.type('3')
  await expect(qty).toHaveValue('3')
  await expect(page.getByTestId('line-math')).toHaveText('₩4,000 × 3 = ₩12,000')

  await page.getByTestId('remove-item').click()
  await expect(page.getByTestId('item-row')).toHaveCount(0)
  await expect(page.getByTestId('item-removed')).toContainText('coffee')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(1)
  await expect(page.getByTestId('item-unit-price')).toHaveValue('4000')
})
