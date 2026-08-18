import { expect, test, type Page } from '@playwright/test'
import { goVia } from './nav'

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

async function createGroup(
  page: Page,
  name: string,
  displayName: string,
): Promise<string> {
  await page.goto('/groups/new')
  // Same pre-existing hydration flake noted in chat-entry.spec.ts
  // (docs/BUGS.md 2026-08-09) — wait for hydration to settle before filling.
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

/**
 * Same shape as chat-entry.spec.ts's own helper (docs/SOLVED.md 2026-08-09 —
 * the saved confirmation renders straight from the action result, so a miss
 * here is a real regression, not a refresh timing flake).
 */
async function expectSavedBubble(page: Page, text: string): Promise<void> {
  await expect(
    page.getByTestId('chat-saved-summary').filter({ hasText: text }),
  ).toBeVisible()
}

/** A 2x2 JPEG, enough for the browser to decode and the client resize's
 *  canvas to re-encode (same fixture e2e/receipt-scan.spec.ts uses). */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z',
  'base64',
)

async function attachPhoto(page: Page): Promise<void> {
  await page.getByTestId('chat-attach-input').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: TINY_JPEG,
  })
}

/**
 * Task 3 (docs/superpowers/plans/2026-08-12-c-chat-receipt.md): e2e coverage
 * for the chat receipt-attach flow Tasks 1-2 built — attach button, resize,
 * `/api/receipts/parse`, `mergeReceiptIntoChat`'s three outcomes, and the
 * i18n error bubbles. The parse route is stubbed at the BROWSER level
 * (`page.route`), same convention as e2e/receipt-scan.spec.ts, so no test
 * ever reaches a live model. Every fixture keeps MATCH/MISMATCH trivial by
 * hand (no tax/service) so the numbers asserted below are easy to audit
 * against `checkTotal` (src/lib/receipts/invariant.ts) without re-deriving
 * it in the test.
 */
test.describe.configure({ mode: 'serial' })

test('items outcome: attach opens a merchant-titled items card, one assignment saves, and the detail page shows the receipt rows plus photo', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await signUp(page, 'Alice Receipt', uniqueEmail('receipt-items'))
  const homeUrl = await createGroup(page, 'Chat Receipt Items E2E', 'Alice')
  const groupId = homeUrl.split('/groups/')[1]
  const imagePath = `${groupId}/00000000-0000-4000-8000-000000000001.jpg`

  const receipt = {
    items: [
      { name: 'Coffee', quantity: 2, unitPriceMinor: 3000, amountMinor: 6000, modifiers: [] },
      { name: 'Bagel', quantity: 1, unitPriceMinor: 2000, amountMinor: 2000, modifiers: [] },
    ],
    subtotalMinor: 8000,
    taxMinor: null,
    serviceChargeMinor: null,
    totalMinor: 8000,
    currency: 'KRW',
    merchantName: 'Test Cafe',
    receiptDate: '2026-08-01',
    taxIncludedInItems: null,
  }
  const check = {
    status: 'MATCH',
    canSave: true,
    itemSum: 8000,
    computedTotal: 8000,
    readTotal: 8000,
    difference: 0,
    taxTreatedAsExclusive: false,
  }

  await page.route('**/api/receipts/parse', async (route) => {
    // A small delay so the scanning indicator is actually observable below,
    // rather than flashing and vanishing within the same tick.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, receipt, check, imagePath, remaining: 49 }),
    })
  })

  await attachPhoto(page)

  // The user's own photo bubble and the scanning indicator both appear
  // while the (stubbed) parse call is in flight.
  await expect(page.getByAltText('Receipt photo').first()).toBeVisible()
  await expect(page.getByTestId('chat-scan-reading')).toBeVisible()

  await expect(page.getByTestId('chat-confirm-items-card')).toBeVisible()

  // Owner request 2026-08-13: tapping the sent photo opens it enlarged
  // (same Dialog as the wizard's "view photo"), so the sender can confirm
  // it's the right receipt. Close it before carrying on with the card.
  await page.getByTestId('chat-image-bubble').click()
  await expect(page.getByTestId('chat-photo-dialog')).toBeVisible()
  await page.getByTestId('chat-photo-dialog-close').click()
  await expect(page.getByTestId('chat-photo-dialog')).toHaveCount(0)
  await expect(page.getByTestId('chat-scan-reading')).toHaveCount(0)

  // Merchant name won the title, not an auto-generated "first item + N more".
  await expect(page.getByTestId('chat-description')).toHaveValue('Test Cafe')

  const rows = page.getByTestId('chat-assign-row')
  await expect(rows).toHaveCount(2)
  await expect(page.getByTestId('chat-assign-summary')).toHaveText(
    '2 items · ₩8,000',
  )
  const coffee = rows.filter({ hasText: 'Coffee' })
  const bagel = rows.filter({ hasText: 'Bagel' })
  await expect(coffee).toContainText('₩6,000')
  await expect(bagel).toContainText('₩2,000')

  // Assign the Coffee line to the sole member; leave Bagel unassigned
  // (legal — the engine's proportional rule handles it).
  await coffee.getByTestId('chat-assign-toggle').click()
  await page.getByRole('checkbox', { name: 'Alice' }).click()

  await page.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(page, 'Test Cafe')

  await goVia(page, 'history')
  await page.getByTestId('feed-row').filter({ hasText: 'Test Cafe' }).click()
  await page.getByTestId('feed-open').click()
  await expect(page).toHaveURL(/\/expenses\/[^/]+$/)

  await expect(page.getByTestId('expense-amount')).toContainText('₩8,000')

  const receiptRows = page.getByTestId('receipt-row')
  await expect(receiptRows).toHaveCount(2)
  const coffeeRow = receiptRows.filter({ hasText: 'Coffee' })
  await expect(coffeeRow).toContainText('₩3,000 × 2')
  await expect(coffeeRow).toContainText('₩6,000')
  const bagelRow = receiptRows.filter({ hasText: 'Bagel' })
  await expect(bagelRow).toContainText('₩2,000')

  await coffeeRow.click()
  await expect(coffeeRow.getByTestId('receipt-assignees')).toContainText('Alice')
  await bagelRow.click()
  await expect(bagelRow.getByTestId('receipt-assignees')).toContainText('Unassigned')

  // The receipt photo section is present, linking at the uploaded path.
  const thumbnail = page.getByTestId('receipt-thumbnail')
  await expect(thumbnail).toBeVisible()
  await expect(thumbnail).toHaveAttribute(
    'href',
    `/api/receipts/image?path=${encodeURIComponent(imagePath)}`,
  )
})

test('totalOnly (SUM_MISMATCH) outcome: the printed total wins, with a notice, and the saved bubble shows it', async ({
  page,
}) => {
  await signUp(page, 'Bob Receipt', uniqueEmail('receipt-mismatch'))
  const homeUrl = await createGroup(page, 'Chat Receipt Mismatch E2E', 'Bob')
  const groupId = homeUrl.split('/groups/')[1]
  const imagePath = `${groupId}/00000000-0000-4000-8000-000000000002.jpg`

  // Items sum to 5,000 but the printed total is 6,000 — a genuine mismatch.
  const receipt = {
    items: [
      { name: 'A', quantity: 1, unitPriceMinor: 2000, amountMinor: 2000, modifiers: [] },
      { name: 'B', quantity: 1, unitPriceMinor: 3000, amountMinor: 3000, modifiers: [] },
    ],
    subtotalMinor: null,
    taxMinor: null,
    serviceChargeMinor: null,
    totalMinor: 6000,
    currency: 'KRW',
    merchantName: 'Mismatch Diner',
    receiptDate: null,
    taxIncludedInItems: null,
  }
  const check = {
    status: 'MISMATCH',
    canSave: false,
    itemSum: 5000,
    computedTotal: 5000,
    readTotal: 6000,
    difference: -1000,
    taxTreatedAsExclusive: false,
  }

  await page.route('**/api/receipts/parse', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, receipt, check, imagePath, remaining: 48 }),
    }),
  )

  await attachPhoto(page)

  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-confirm-items-card')).toHaveCount(0)
  // The printed total is what shows, not the item sum.
  await expect(page.getByTestId('chat-amount')).toHaveText('₩6,000')
  await expect(page.getByTestId('chat-description')).toHaveValue('Mismatch Diner')
  await expect(page.getByTestId('chat-scan-notice')).toHaveText(
    "The items didn't add up to the printed total, so the printed total was used instead.",
  )

  await page.getByTestId('chat-confirm-save').click()
  await expectSavedBubble(page, 'Mismatch Diner')
  await expect(page.getByTestId('chat-saved-summary')).toContainText('₩6,000')
})

test('refuse outcome: a receipt with no items and no total never opens a card and never saves', async ({
  page,
}) => {
  await signUp(page, 'Carol Receipt', uniqueEmail('receipt-refuse'))
  await createGroup(page, 'Chat Receipt Refuse E2E', 'Carol')

  const receipt = {
    items: [],
    subtotalMinor: null,
    taxMinor: null,
    serviceChargeMinor: null,
    totalMinor: null,
    currency: null,
    merchantName: null,
    receiptDate: null,
    taxIncludedInItems: null,
  }
  const check = {
    status: 'NO_TOTAL',
    canSave: false,
    itemSum: 0,
    computedTotal: 0,
    readTotal: null,
    difference: null,
    taxTreatedAsExclusive: false,
  }

  await page.route('**/api/receipts/parse', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, receipt, check, imagePath: null, remaining: 47 }),
    }),
  )

  await attachPhoto(page)

  await expect(page.getByTestId('chat-scan-refused')).toBeVisible()
  await expect(page.getByTestId('chat-confirm-items-card')).toHaveCount(0)
  await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
  await expect(page.getByTestId('chat-saved-summary')).toHaveCount(0)
})

test('NOT_CONFIGURED error: an i18n error bubble shows, and the composer stays usable afterwards', async ({
  page,
}) => {
  await signUp(page, 'Dana Receipt', uniqueEmail('receipt-notconfigured'))
  await createGroup(page, 'Chat Receipt NotConfigured E2E', 'Dana')

  await page.route('**/api/receipts/parse', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ ok: false, error: 'NOT_CONFIGURED' }),
    }),
  )

  await attachPhoto(page)

  await expect(page.getByTestId('chat-scan-error')).toBeVisible()
  await expect(page.getByTestId('chat-scan-error')).toContainText(
    "Photo scanning isn't set up on this server yet — type the expense in instead.",
  )

  // The scan failure didn't wedge the composer: a plain sentence still opens
  // an ordinary confirm card.
  await page.getByTestId('chat-input').fill('택시 8500원')
  await page.getByTestId('chat-send').click()
  await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
  await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')
})
