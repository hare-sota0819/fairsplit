import { expect, test, type Page } from '@playwright/test'

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

/** A 2x2 JPEG, enough for the browser to decode and the canvas to re-encode. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAIBAREA/8QAHwAAAQUBAQEB' +
    'AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh' +
    'ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ' +
    'WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
    'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+v//Z',
  'base64',
)

/**
 * Scan-to-save happy path with the model call stubbed (brief §217).
 *
 * The route itself is intercepted rather than the Gemini endpoint: that keeps
 * the test off the network entirely and off the free tier's 20-a-day quota,
 * and what this exercises is our own contract — resize, confirm screen, the
 * total-match invariant, and the handoff into the existing assignment step.
 */
test('scan a receipt: parsed items appear, the total check responds, and the expense saves', async ({
  page,
}) => {
  test.setTimeout(120_000)

  // /api/rates proxies a real outbound call, and the environment points the
  // providers at a closed port, so a foreign-currency save needs a manual
  // override. Same convention as trip-currency.spec.ts.
  await page.route('**/api/rates**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ rate: null, asOf: null, asOfInstant: null, today: '2026-08-08' }),
    }),
  )

  let uploadedBytes = 0
  await page.route('**/api/receipts/parse', async (route) => {
    // The upload really did happen and really was resized: the fixture is a
    // 2x2 JPEG, so anything arriving here has been through canvas re-encode.
    uploadedBytes = (route.request().postDataBuffer()?.length ?? 0)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        imagePath: null,
        remaining: 49,
        // The Menshou Takamatsu fixture: two lines, ¥1,560, tax inclusive.
        receipt: {
          items: [
            { name: '味玉つけ麺(大)', quantity: 1, unitPriceMinor: 1260, amountMinor: 1260, modifiers: [] },
            { name: 'コーラ', quantity: 1, unitPriceMinor: 300, amountMinor: 300, modifiers: [] },
          ],
          subtotalMinor: null,
          taxMinor: 141,
          taxIncludedInItems: true,
          serviceChargeMinor: null,
          totalMinor: 1560,
          currency: 'JPY',
          merchantName: '麺匠たか松 本店',
          receiptDate: '2026-07-20',
        },
        check: null,
      }),
    })
  })

  await signUp(page, 'Alice Scan', uniqueEmail('scan'))
  await page.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill('Receipt Scan E2E')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Alice')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('1560')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page) // -> payment
  // Foreign currency, so a rate is needed to save; the environment points the
  // FX providers at a closed port, so a manual override goes in here exactly
  // as every other foreign-currency spec does.
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('9')
  await next(page) // -> items

  // Photograph. `capture` makes this the camera on a phone and a picker here.
  await page.getByTestId('scan-receipt').click()
  await page.getByTestId('scan-receipt-input').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: TINY_JPEG,
  })

  const confirm = page.getByTestId('receipt-confirm')
  await expect(confirm).toBeVisible()

  // Both lines came back, and the invariant is satisfied as parsed.
  await expect(page.getByTestId('scan-item-name').first()).toHaveValue('味玉つけ麺(大)')
  await expect(page.getByTestId('scan-item-count')).toHaveText('2')
  await expect(page.getByTestId('scan-check')).toHaveAttribute('data-status', 'MATCH')
  await expect(page.getByTestId('scan-confirm')).toBeEnabled()
  expect(uploadedBytes).toBeGreaterThan(0)

  // Edit one item so the numbers stop agreeing: saving must block (brief §209).
  await page.getByTestId('scan-item-price').first().fill('1000')
  await expect(page.getByTestId('scan-check')).toHaveAttribute('data-status', 'MISMATCH')
  await expect(page.getByTestId('scan-check-detail')).toContainText('260')
  await expect(page.getByTestId('scan-confirm')).toBeDisabled()

  // Resolve it the way the brief offers: adopt the item sum as the total.
  await page.getByTestId('scan-use-item-sum').click()
  await expect(page.getByTestId('scan-check')).toHaveAttribute('data-status', 'MATCH')
  await expect(page.getByTestId('scan-confirm')).toBeEnabled()

  // Put it back to the receipt's real numbers and continue.
  await page.getByTestId('scan-item-price').first().fill('1260')
  await page.getByTestId('scan-total').fill('1560')
  await expect(page.getByTestId('scan-check')).toHaveAttribute('data-status', 'MATCH')
  await page.getByTestId('scan-confirm').click()

  // Handed to the EXISTING assignment step, prefilled — no second UI.
  await expect(confirm).toBeHidden()
  await expect(page.getByTestId('assign-row')).toHaveCount(2)
  await expect(page.getByTestId('assign-row').first()).toContainText('味玉つけ麺(大)')

  for (const row of await page.getByTestId('assign-row').all()) {
    await row.getByTestId('assign-toggle').click()
    await row.getByRole('button', { name: 'Everyone' }).click()
  }
  await next(page) // -> review
  await page.getByTestId('save-expense').click()

  await expect(page.getByTestId('expense-amount')).toHaveText('¥1,560')
})

/**
 * Failure exit (brief §159-165, §211): a parse that fails must not trap the
 * user, and the manual-entry path stays one tap away.
 */
test('a failed parse offers manual entry instead of trapping the user', async ({ page }) => {
  test.setTimeout(120_000)

  await page.route('**/api/receipts/parse', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      // The server uploads the photo even when the parse fails (brief §163),
      // so a real failure response carries a path.
      body: JSON.stringify({
        ok: false,
        error: 'PARSE_FAILED',
        imagePath: 'grp/00000000-0000-4000-8000-000000000000.jpg',
      }),
    })
  })

  await signUp(page, 'Bob Scan', uniqueEmail('scanfail'))
  await page.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill('Receipt Fail E2E')
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('Bob')
  await page.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(page.getByTestId('home')).toBeVisible()
  const groupUrl = page.url()

  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('800')
  await page.getByLabel('Currency').selectOption('JPY')
  await next(page)
  await next(page)

  await page.getByTestId('scan-receipt').click()
  await page.getByTestId('scan-receipt-input').setInputFiles({
    name: 'receipt.jpg',
    mimeType: 'image/jpeg',
    buffer: TINY_JPEG,
  })

  await expect(page.getByTestId('scan-error')).toBeVisible()
  // The photo is still on screen, and both exits are offered.
  await expect(page.getByTestId('scan-thumbnail')).toBeVisible()
  await expect(page.getByTestId('scan-retry')).toBeVisible()

  await page.getByTestId('scan-manual-entry').click()
  await expect(page.getByTestId('receipt-confirm')).toBeHidden()
  // Dropped into the ordinary item form with a row ready to type into.
  await expect(page.getByTestId('item-row')).toHaveCount(1)
})

/**
 * Receipt images are group data (brief §175, §213). There is no live bucket in
 * e2e, so these drive the AUTHORISATION gate rather than the bytes: every
 * refusal below happens before storage is ever consulted, and a request that
 * gets past the gate is distinguishable because it fails later, at 503
 * "no storage configured", instead of 404.
 */
test('a receipt image is refused to anyone outside the group', async ({ browser }) => {
  test.setTimeout(120_000)

  const ownerContext = await browser.newContext()
  const owner = await ownerContext.newPage()
  await signUp(owner, 'Owner Img', uniqueEmail('img-owner'))
  await owner.goto('/groups/new')
  // docs/BUGS.md [2026-08-09]: filling this form before hydration
  // settles can lose the typed values — DestinationPicker's country-name
  // mismatch regenerates a subtree that takes sibling form state with it.
  // The documented workaround (docs/BUGS.md [2026-08-09]).
  await owner.waitForTimeout(1500)
  await owner.getByLabel('Group name').fill('Image ACL E2E')
  await owner.getByLabel('Settlement currency').selectOption('KRW')
  await owner.getByLabel('Your display name in this group').fill('Owner')
  await owner.getByRole('button', { name: 'Create group' }).click()
  // Home is the expense feed (chat removal, 2026-08-21): it being
  // there is proof the redirect landed.
  await expect(owner.getByTestId('home')).toBeVisible()
  const groupId = owner.url().split('/groups/')[1].split('/')[0]

  const path = `${groupId}/00000000-0000-4000-8000-000000000000.jpg`
  const url = `/api/receipts/image?path=${encodeURIComponent(path)}`

  // A member: past the membership gate, refused because no expense in this
  // group claims that object. Without this check a member could read any
  // object under their own group's prefix, including an abandoned scan.
  expect((await owner.request.get(url)).status()).toBe(404)

  // Traversal cannot be used to authorise against one group and read another.
  const traversal = `${groupId}/../other/x.jpg`
  expect(
    (await owner.request.get(`/api/receipts/image?path=${encodeURIComponent(traversal)}`)).status(),
  ).toBe(400)

  // A signed-in NON-member gets 404 — the same answer a missing image gives,
  // so this is no oracle for which groups or receipts exist.
  const outsiderContext = await browser.newContext()
  const outsider = await outsiderContext.newPage()
  await signUp(outsider, 'Outsider Img', uniqueEmail('img-out'))
  expect((await outsider.request.get(url)).status()).toBe(404)

  // Signed out: refused outright.
  const anonContext = await browser.newContext()
  const anon = await anonContext.newPage()
  expect((await anon.request.get(url)).status()).toBe(401)

  await ownerContext.close()
  await outsiderContext.close()
  await anonContext.close()
})
