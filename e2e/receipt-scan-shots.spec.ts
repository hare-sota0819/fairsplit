import { expect, test, type Page } from '@playwright/test'

/**
 * Screenshot pass for the confirm screen. Not an assertion suite — it drives
 * the three states worth looking at and writes them to test-results/shots so
 * the layout can be reviewed at phone size.
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

const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z',
  'base64',
)

const SUN_DRUG = {
  ok: true,
  imagePath: null,
  remaining: 49,
  // The 13-line Sun Drug receipt: the density case.
  receipt: {
    items: [
      ...Array.from({ length: 8 }, () => ({
        name: '(消耗)抹茶チョコレート',
        quantity: 1,
        unitPriceMinor: 348,
        amountMinor: 348,
        modifiers: [],
      })),
      ...Array.from({ length: 2 }, () => ({
        name: '(消耗)ティラミスチョコ',
        quantity: 1,
        unitPriceMinor: 700,
        amountMinor: 700,
        modifiers: [],
      })),
      ...Array.from({ length: 3 }, () => ({
        name: '(消耗)抹茶ティラミスチ',
        quantity: 1,
        unitPriceMinor: 700,
        amountMinor: 700,
        modifiers: [],
      })),
    ],
    subtotalMinor: 6284,
    taxMinor: 0,
    taxIncludedInItems: true,
    serviceChargeMinor: null,
    totalMinor: 6284,
    currency: 'JPY',
    merchantName: 'サンドラッグ京都錦店',
    receiptDate: '2026-07-20',
  },
  check: null,
}

test('confirm screen states at 390x844', async ({ page }) => {
  test.setTimeout(180_000)

  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rate: null, asOf: null, asOfInstant: null, today: '2026-08-08' }),
    }),
  )

  let holdOpen = false
  await page.route('**/api/receipts/parse', async (route) => {
    // Held open on the first pass so the reading state can be photographed.
    if (holdOpen) await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SUN_DRUG),
    })
  })

  await signUp(page, 'Shot User', uniqueEmail('shots'))
  await page.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill('Shots')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Shot')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('6284')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('9')
  await next(page)

  // The items step, with the scan tile now live.
  await page.screenshot({ path: 'test-results/shots/01-items-step.png' })

  holdOpen = true
  await page.getByTestId('scan-receipt').click()
  await page.getByTestId('scan-receipt-input').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: TINY_JPEG,
  })
  await expect(page.getByTestId('scan-reading')).toBeVisible()
  await page.screenshot({ path: 'test-results/shots/02-reading.png' })

  await expect(page.getByTestId('scan-check')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: 'test-results/shots/03-confirm-top.png' })

  // Scrolled to the totals block and the invariant banner.
  await page.getByTestId('scan-total').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/shots/04-confirm-totals.png' })

  // Mismatch state: the blocking banner and the disabled confirm button.
  await page.getByTestId('scan-item-price').first().fill('9999')
  await expect(page.getByTestId('scan-check')).toHaveAttribute('data-status', 'MISMATCH')
  await page.getByTestId('scan-check').scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/shots/05-mismatch.png' })
})
