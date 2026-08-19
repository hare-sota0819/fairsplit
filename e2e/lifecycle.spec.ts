import { expect, test, type Page } from '@playwright/test'
import { openNav } from './nav'
import { createWallet, recordTopUp } from './wallet-flow'

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

async function createGroup(page: Page, name: string): Promise<string> {
  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

test('a one-member group explains itself and hides the empty sections', async ({
  page,
}) => {
  await signUp(page, 'Solo E2E', uniqueEmail('solo'))
  const groupUrl = await createGroup(page, 'Solo Trip E2E')

  // Home is chat-only (Task 5, app-shell restructure): the same empty-chat
  // greeting shows for any group size, solo included — home no longer has
  // solo-specific gating to prove (totals/per-person rows/the feed moved
  // off home entirely, for every group size, not just solo ones).
  await expect(page.getByTestId('chat-empty')).toBeVisible()

  // The invite prompt is no longer gated on being alone either (T3 made
  // `/invite` always show it) — reachable regardless of group size.
  await page.goto(`${groupUrl}/invite`)
  await expect(page.getByTestId('invite-cta')).toBeVisible()

  await page.goto(`${groupUrl}/me`)
  await expect(page.getByTestId('spending-empty')).toBeVisible()
  await expect(page.getByTestId('my-total')).toHaveCount(0)

  await page.goto(`${groupUrl}/status`)
  await expect(page.getByTestId('status-alone')).toBeVisible()
  await expect(page.getByTestId('status-row')).toHaveCount(0)

  await page.goto(`${groupUrl}/history`)
  await expect(page.getByTestId('history-empty')).toBeVisible()
})

test('the last member to leave takes the group with them', async ({ page }) => {
  await signUp(page, 'Last E2E', uniqueEmail('last'))
  const groupUrl = await createGroup(page, 'Doomed Trip E2E')

  await page.goto(`${groupUrl}/settings`)
  // Alone, so the leave button says what it will really do.
  await expect(page.getByTestId('leave-group')).toHaveText(
    'Leave and delete this group',
  )
  await page.getByTestId('leave-group').click()
  await page.getByTestId('leave-confirm').click()

  // Zero groups left, so root's redirect chain lands on the list.
  await expect(page).toHaveURL(/\/groups$/)
  await expect(page.getByTestId('group-list-empty')).toBeVisible()
  // The group is gone for good, not merely hidden.
  await page.goto(groupUrl)
  await expect(page.getByTestId('not-found')).toBeVisible()
  // This 404 is caught above the group layout. The header's text index is
  // still there (it is path-driven), but its group rows point at a group
  // that no longer exists — the account rows are what remain useful.
  await openNav(page)
  await expect(page.getByTestId('nav-all-groups')).toBeVisible()
})

test('a member leaves, the creator deletes, and dead ends offer a way back', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await signUp(pageA, 'Alice L', uniqueEmail('alice-l'))
  const groupUrl = await createGroup(pageA, 'Shared Trip E2E')
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await pageA.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signUp(pageB, 'Bob L', uniqueEmail('bob-l'))
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Bob')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // Wait for the join's own redirect to land before navigating elsewhere —
  // otherwise the /status goto below can race the still-in-flight join.
  await expect(pageB.getByTestId('chat-input')).toBeVisible()
  // Home is chat-only (Task 5, app-shell restructure); per-member balances
  // (and the invite prompt's alone-gating) moved to /status and /invite.
  await pageB.goto(`${groupUrl}/status`)
  await expect(pageB.getByTestId('status-row')).toHaveCount(2)

  // With company, Alice sees Bob as a real co-member too.
  await pageA.goto(`${groupUrl}/status`)
  await expect(pageA.getByTestId('status-row')).toHaveCount(2)

  // Bob is not the creator: no delete button, only leave.
  await pageB.goto(`${groupUrl}/settings`)
  await expect(pageB.getByTestId('delete-group')).toHaveCount(0)
  await expect(pageB.getByTestId('leave-group')).toHaveText('Leave this group')
  await pageB.getByTestId('leave-group').click()
  await pageB.getByTestId('leave-confirm').click()
  await expect(pageB.getByTestId('group-list-empty')).toBeVisible()

  // A non-member URL is a 404 with a route back, not Next's default page.
  await pageB.goto(groupUrl)
  await expect(pageB.getByTestId('not-found')).toBeVisible()
  await pageB.getByRole('link', { name: 'Back to your groups' }).click()
  // Bob has zero groups now, so root's redirect chain lands on the list.
  await expect(pageB).toHaveURL(/\/groups$/)

  // Alice still has the group, and it is back to one member.
  await pageA.goto(`${groupUrl}/status`)
  await expect(pageA.getByTestId('status-alone')).toBeVisible()

  // Delete needs the exact name.
  await pageA.goto(`${groupUrl}/settings`)
  await pageA.getByTestId('delete-group').click()
  await pageA.getByTestId('delete-confirm-name').fill('wrong name')
  await pageA.getByTestId('delete-confirm').click()
  // Next's route announcer is also role=alert, so match on the copy.
  await expect(
    pageA.getByText('That does not match the group name.'),
  ).toBeVisible()
  await pageA.getByTestId('delete-confirm-name').fill('Shared Trip E2E')
  await pageA.getByTestId('delete-confirm').click()
  // Zero groups left, so root's redirect chain lands on the list.
  await expect(pageA).toHaveURL(/\/groups$/)
  await expect(pageA.getByTestId('group-list-empty')).toBeVisible()

  // The invite link outlives nothing.
  await pageA.goto(invitePath)
  await expect(pageA.getByTestId('invite-invalid')).toBeVisible()
  await pageA.getByRole('link', { name: 'Back to your groups' }).click()
  await expect(pageA).toHaveURL(/\/groups$/)

  await contextA.close()
  await contextB.close()
})

/**
 * The load-bearing half of deletion: BOTH `Expense.enteredById` and
 * `Expense.walletId` are ON DELETE RESTRICT, so a group can only be dropped
 * if the expense rows go first — and Phase 4A added a second chain to trip
 * over, Group -> Member -> Wallet -> Expense. An empty group, or one whose
 * expenses were all pay-as-you-go, would never catch a regression here, so
 * this one deliberately spends money out of a wallet.
 */
test('a group with wallet-funded expenses in it still deletes', async ({
  page,
}) => {
  await signUp(page, 'Purge E2E', uniqueEmail('purge'))
  const groupUrl = await createGroup(page, 'Purge Trip E2E')

  // A wallet with a top-up on it: Wallet -> ExchangeRecord must cascade while
  // Wallet -> Expense is restricted.
  await page.goto(`${groupUrl}/exchange`)
  await createWallet(page, { label: 'Cash', currency: 'JPY' })
  await recordTopUp(page, { rate: '900', received: '10000' })
  await expect(page.getByTestId('exchange-record-row')).toHaveCount(1)

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('4900')
  await page.getByLabel('Currency').selectOption('JPY')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('paid-prepaid').click()
  await page
    .locator('[data-testid^="funding-"]')
    .filter({ hasText: 'Cash' })
    .click()
  // Foreign currency, so a market-rate snapshot is written at save time even
  // though this expense converts at the wallet's own rate. Enter the override
  // every other spec enters, rather than leaning on whatever happens to be in
  // RateCache — that dependency is what made this spec fail for weeks.
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('900')
  // Straight through the rest: nothing on the middle steps is required.
  for (let step = 1; step < 4; step += 1) {
    await page.getByTestId('wizard-next').click()
  }
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-amount')).toBeVisible()
  await expect(page.getByTestId('expense-method')).toHaveText('Paid from Cash')

  await page.goto(`${groupUrl}/settings`)
  await page.getByTestId('delete-group').click()
  await page.getByTestId('delete-confirm-name').fill('Purge Trip E2E')
  await page.getByTestId('delete-confirm').click()
  // Zero groups left, so root's redirect chain lands on the list.
  await expect(page).toHaveURL(/\/groups$/)
  await expect(page.getByTestId('group-list-empty')).toBeVisible()
})

/**
 * The other RESTRICT chain: `ChatSession` and `ChatMessage` point at both
 * the group and its members with the default RESTRICT (schema comment above
 * `ChatMessage`), so a group with any persisted conversation in it can only
 * be dropped if those rows go first. A group nobody chatted in never catches
 * a regression here — this one deliberately talks before deleting.
 */
test('a group with a chat conversation in it still deletes', async ({
  page,
}) => {
  await signUp(page, 'Chatty Purge E2E', uniqueEmail('chatty-purge'))
  const groupUrl = await createGroup(page, 'Chatty Purge Trip E2E')

  // Home is chat-only; a saved expense through chat persists a ChatSession
  // row plus its ChatMessage rows.
  await page.getByTestId('chat-input').fill('lunch 13000')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await page.getByTestId('chat-confirm-save').click()
  await expect(page.getByTestId('chat-saved-summary')).toBeVisible()

  await page.goto(`${groupUrl}/settings`)
  await page.getByTestId('delete-group').click()
  await page.getByTestId('delete-confirm-name').fill('Chatty Purge Trip E2E')
  await page.getByTestId('delete-confirm').click()
  await expect(page).toHaveURL(/\/groups$/)
  await expect(page.getByTestId('group-list-empty')).toBeVisible()
})

/** Rejoining reclaims the same member row, not a second one. */
test('a member who left can rejoin through the invite link', async ({
  browser,
}) => {
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  await signUp(pageA, 'Host R', uniqueEmail('host-r'))
  const groupUrl = await createGroup(pageA, 'Revolving Trip E2E')
  // Home is chat-only (Task 5, app-shell restructure): the invite link
  // lives on /invite now, not on home.
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await pageA.getByTestId('invite-link').innerText()

  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  await signUp(pageB, 'Rejoin R', uniqueEmail('rejoin-r'))
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Rey')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // Home is chat-only (Task 5, app-shell restructure): the composer being
  // there is proof the join landed and home rendered.
  await expect(pageB.getByTestId('chat-input')).toBeVisible()

  await pageB.goto(`${groupUrl}/settings`)
  await pageB.getByTestId('leave-group').click()
  await pageB.getByTestId('leave-confirm').click()
  await expect(pageB.getByTestId('group-list-empty')).toBeVisible()

  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Rey')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  await expect(pageB.getByTestId('chat-input')).toBeVisible()

  // One Rey, not two: the old row was reclaimed.
  await pageA.goto('/groups')
  await expect(pageA.getByTestId('group-list-row')).toHaveText(/2 members/)

  await contextA.close()
  await contextB.close()
})

test('an unknown expense id keeps the group sidebar and offers a way back', async ({
  page,
}) => {
  await signUp(page, 'Missing E2E', uniqueEmail('missing'))
  const groupUrl = await createGroup(page, 'Missing Trip E2E')

  await page.goto(`${groupUrl}/expenses/does-not-exist`)
  await expect(page.getByTestId('not-found')).toBeVisible()
  // Inside the group layout (only the expense page itself 404s) — the
  // index still lists this group's screens.
  await openNav(page)
  await expect(page.getByTestId('nav-status')).toBeVisible()
})

/**
 * Trip currency can be set at creation, changed, and cleared back to "not
 * decided" from settings. The clear-to-null path is checked separately from
 * the change path because an empty string passing through a falsy check
 * could silently keep the old value instead of clearing it.
 *
 * `page.reload()` (not `router.refresh()`) is used to read back the saved
 * value: the select's `defaultValue` is only honoured on mount, so a
 * client-side refresh would not show a changed prop even if the DB write
 * failed — a full reload re-renders from the server unconditionally.
 */
test('trip currency can be set, changed, and cleared in settings', async ({
  page,
}) => {
  await signUp(page, 'Trip Currency E2E', uniqueEmail('tripcur'))

  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill('Trip Currency E2E Group')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByTestId('trip-country').selectOption('JP')
  await page.getByLabel('Your display name in this group').fill('Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(
    page.getByRole('heading', { name: 'Trip Currency E2E Group' }),
  ).toBeVisible()
  const groupUrl = page.url().replace(/\?.*$/, '')

  // The empty wallet slot names the DESTINATION and preselects its currency
  // on the create form. It lived on home until Task 5 (app-shell restructure,
  // 2026-08-10) made home chat-only; it is now the /exchange screen's own
  // empty state, the only place a member with no wallet yet is prompted.
  //
  // It named the currency until 2026-08-07 ("somewhere you'll spend JPY"),
  // which in Korean came out as "JPY 쓰는 곳으로 가시나요?" — a sentence no
  // one says. Naming the country reads better in both languages.
  await page.goto(`${groupUrl}/exchange`)
  await expect(page.getByTestId('cash-slot')).toContainText('Heading to Japan?')
  await expect(page.getByTestId('wallet-onboarding-link')).toHaveAttribute(
    'href',
    `${new URL(groupUrl).pathname}/exchange?newWalletCurrency=JPY`,
  )
  await page.getByTestId('wallet-onboarding-link').click()
  await expect(page.getByTestId('wallet-create-currency')).toHaveValue('JPY')

  await page.goto(`${groupUrl}/settings`)
  await expect(page.getByTestId('trip-country')).toHaveValue('JP')
  // The currency is stated back, derived — never asked for.
  await expect(page.getByTestId('trip-currency-note')).toContainText('JPY')

  await page.getByTestId('trip-country').selectOption('US')
  await expect(page.getByTestId('trip-currency-note')).toContainText('USD')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('trip-country')).toHaveValue('US')

  // A city is offered only once a country is chosen, and picking one sticks.
  await page.getByTestId('trip-city').selectOption('New York')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('trip-city')).toHaveValue('New York')

  // Clearing the country clears the city and the derived currency with it.
  await page.getByTestId('trip-country').selectOption('')
  await expect(page.getByTestId('trip-city')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('trip-country')).toHaveValue('')
})

/**
 * A trip currency equal to the settlement currency is not in the
 * wallet-create form's currency list (that list excludes the settlement
 * currency — no exchange rate is needed for money already in it). Naming a
 * currency the select can't offer would make the browser silently fall back
 * to its first option instead, so home must not emit the parameter at all.
 */
test('a trip currency matching settlement is never preselected on the wallet form', async ({
  page,
}) => {
  await signUp(page, 'Same Currency E2E', uniqueEmail('samecur'))

  await page.goto('/groups/new')
  await page.getByLabel('Group name').fill('Same Currency E2E Group')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByTestId('trip-country').selectOption('KR')
  await page.getByLabel('Your display name in this group').fill('Owner')
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(
    page.getByRole('heading', { name: 'Same Currency E2E Group' }),
  ).toBeVisible()
  const groupUrl = page.url().replace(/\?.*$/, '')

  await page.goto(`${groupUrl}/exchange`)
  // No currency to preselect, so the link — which would otherwise point at
  // the exact page already open, a no-op click — does not render at all
  // (review fix, 2026-08-10). The prompt copy stays.
  await expect(page.getByTestId('wallet-onboarding-link')).toHaveCount(0)
  // The prompt copy above the (now-absent) link must fall back to the
  // generic wording too — the "you'll spend {currency}" phrasing implies a
  // conversion that, when trip currency equals settlement currency, never
  // happens.
  await expect(page.getByTestId('cash-slot')).not.toContainText("you'll spend")
})
