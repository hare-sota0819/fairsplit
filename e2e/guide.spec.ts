import { expect, test, type Page } from '@playwright/test'
import { inviteJoinPath } from './nav'

/**
 * The path a friend actually walks: a link arrives, they find out what this
 * is, they sign up, they read the guide, and they land in the group that
 * invited them. Every step of it used to be missing or a dead end.
 */

const uniqueEmail = (tag: string): string =>
  `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

async function signUp(page: Page, name: string, email: string): Promise<void> {
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('landing, invite preview, guide after sign-up, and the guide from Account', async ({
  browser,
}) => {
  // The host creates a group so there is a real invite link to hand out.
  const hostContext = await browser.newContext()
  const host = await hostContext.newPage()
  await host.goto('/signup')
  await signUp(host, 'Host E2E', uniqueEmail('host'))
  // Sign-up lands on the guide, not on the group list.
  await expect(host).toHaveURL(/\/guide/)
  await host.getByTestId('guide-continue').click()
  // Zero groups yet, so root's redirect chain lands on the list.
  await expect(host).toHaveURL(/\/groups$/)

  await host.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await host.waitForTimeout(1500)
  await host.getByLabel('Group name').fill('Guide Trip E2E')
  await host.getByLabel('Settlement currency').selectOption('KRW')
  await host.getByLabel('Your display name in this group').fill('Host')
  await host.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): the invite link
  // lives on /invite now, not on home.
  await expect(host.getByTestId('home')).toBeVisible()
  const groupUrl = host.url()
  await host.goto(`${groupUrl}/invite`)
  const invitePath = await inviteJoinPath(host)

  // The guide is reachable from Account for anyone who wants it again.
  await host.goto('/account')
  await host.getByTestId('account-guide').click()
  await expect(host).toHaveURL(/\/guide/)
  await expect(
    host.getByRole('heading', { name: 'How to use Sem' }),
  ).toBeVisible()
  // Pins the guide to the entry step it actually documents, so a
  // regression back to the removed chat copy fails this test.
  await expect(
    host.getByRole('heading', { name: 'Add an expense' }),
  ).toBeVisible()

  // A stranger, signed out. The bare URL now explains itself and offers a
  // way in — it used to be a name and a tagline with no controls at all.
  const guestContext = await browser.newContext()
  const guest = await guestContext.newPage()
  await guest.goto('/')
  await expect(guest.getByTestId('landing-signup')).toBeVisible()
  await guest.getByTestId('landing-guide').click()
  await expect(guest).toHaveURL(/\/guide/)

  // The invite link states who invited them and to what, BEFORE asking for
  // an account. This used to redirect straight to the sign-in form.
  await guest.goto(invitePath)
  await expect(guest.getByTestId('invite-preview')).toBeVisible()
  await expect(
    guest.getByRole('heading', { name: /Host E2E invited you to/ }),
  ).toContainText('Guide Trip E2E')

  // Signing up from the preview: guide first, then the join form it came for.
  await guest.getByTestId('invite-signup').click()
  await signUp(guest, 'Guest E2E', uniqueEmail('guest'))
  await expect(guest).toHaveURL(/\/guide\?next=/)
  await guest.getByTestId('guide-continue').click()
  await expect(guest).toHaveURL(new RegExp(invitePath.replace('/', '\\/')))
  await guest.getByLabel('Your display name in this group').fill('Guest')
  await guest.getByRole('button', { name: 'Join group' }).click()
  await expect(
    guest.getByRole('heading', { name: 'Guide Trip E2E' }),
  ).toBeVisible()

  await guestContext.close()
  await hostContext.close()
})
