import { expect, test, type Page } from '@playwright/test'
import { inviteJoinPath } from './nav'
import { openLedger } from './group-flow'

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

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

test('signup, group create, and join via invite link', async ({ browser }) => {
  // User A signs up (email/password fallback path) and creates a group.
  const contextA = await browser.newContext()
  const pageA = await contextA.newPage()
  const aliceEmail = uniqueEmail('alice')
  await signUp(pageA, 'Alice E2E', aliceEmail)

  await openLedger(pageA, 'Japan Trip E2E')
  await expect(
    pageA.getByRole('heading', { name: 'Japan Trip E2E' }),
  ).toBeVisible()
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  const groupUrl = pageA.url()
  await pageA.goto(`${groupUrl}/invite`)
  const invitePath = await inviteJoinPath(pageA)
  expect(invitePath).toMatch(/^\/join\//)

  // The group list is the only way back to a group from a device that has
  // never held its URL. Alice sees it on the device that made it...
  await pageA.goto('/groups')
  await expect(pageA.getByTestId('group-list-row')).toHaveText(/Japan Trip E2E/)

  // User B signs up in a fresh context and joins via the link.
  const contextB = await browser.newContext()
  const pageB = await contextB.newPage()
  const bobEmail = uniqueEmail('bob')
  await signUp(pageB, 'Bob E2E', bobEmail)
  // Not a member yet: B must not see A's group.
  await pageB.goto('/groups')
  await expect(pageB.getByTestId('group-list-empty')).toBeVisible()
  await expect(pageB.getByTestId('group-list-row')).toHaveCount(0)
  await pageB.goto(invitePath)
  await pageB.getByLabel('Your display name in this group').fill('Bob')
  await pageB.getByRole('button', { name: 'Join group' }).click()
  // The join page has its own "Japan Trip E2E" heading (the invite
  // preview), so waiting on that heading alone can resolve BEFORE the join
  // actually redirects — the `home` marker only exists once home itself has
  // rendered, so it is the reliable "the join landed" signal.
  await expect(pageB.getByTestId('home')).toBeVisible()
  // Home is the expense feed (chat removal, 2026-08-21); per-member balances
  // moved to /status — one row per member, Bob's own row included. Bob sees
  // Alice as a real co-member, and the two are settled (nothing spent yet).
  await pageB.goto(`${pageB.url()}/status`)
  await expect(pageB.getByTestId('status-row')).toHaveCount(2)
  await expect(
    pageB.getByTestId('status-row').filter({ hasText: 'Alice' }),
  ).toBeVisible()
  const bobRow = pageB.getByTestId('status-row').filter({ hasText: 'Bob' })
  await bobRow.getByTestId('status-row-toggle').click()
  // Every other member gets a breakdown line, settled ones included (that
  // line is /with/[memberId]'s only entry point) — so this reads "You're
  // all square with Alice", not the zero-lines "You're all square with
  // everyone." fallback.
  await expect(bobRow.getByTestId('pairwise-breakdown')).toContainText(
    "You're all square with Alice",
  )

  // THE regression: a second device. Alice signs in from a browser context
  // that has never seen the group URL and must still find her groups — the
  // list is keyed on the session user id, nothing device-local. The bug this
  // guards was that no list existed at all, so a second device had no route
  // back in and read as "my groups are gone".
  const contextC = await browser.newContext()
  const pageC = await contextC.newPage()
  await signIn(pageC, aliceEmail)
  // Alice has exactly one group and no expense entered yet, so signing in
  // opens straight into it — the list itself lives at /groups.
  await pageC.goto('/groups')
  await expect(pageC.getByTestId('group-list-row')).toHaveText(/Japan Trip E2E/)
  await expect(pageC.getByTestId('group-list-row')).toHaveText(/2 members/)
  await pageC.getByTestId('group-list-row').click()
  await expect(
    pageC.getByRole('heading', { name: 'Japan Trip E2E' }),
  ).toBeVisible()

  await contextA.close()
  await contextB.close()
  await contextC.close()
})
