import { expect, test } from '@playwright/test'

/**
 * The only spec that reads the app in Korean.
 *
 * Every other spec asks for `en-US` (see `playwright.config.ts`) so that 192
 * English text selectors could survive the localisation untouched — which
 * left the Korean UI with no automated cover at all. This closes that hole
 * from the other side: it drives a whole trip using nothing but Korean
 * labels, so a missing key, a broken message file or a locale that fails to
 * resolve turns it red.
 *
 * It deliberately asserts on the copy the glossary treats as load-bearing —
 * `내가 낸 돈` vs `내 부담액`, the `님` that keeps particles decidable, and the
 * settlement switch — rather than on every string. A translation review is a
 * human job; this is here to catch the app forgetting how to speak Korean.
 */
test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } })

const uniqueEmail = () =>
  `ko-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

test('the app can be used end to end in Korean', async ({ page }) => {
  test.setTimeout(120_000)

  // No cookie and nobody signed in, so the locale comes from Accept-Language.
  await page.goto('/signup')
  await expect(
    page.getByRole('heading', { name: '시작하기' }),
  ).toBeVisible()

  await page.getByLabel('이름').fill('소타')
  await page.getByLabel('이메일').fill(uniqueEmail())
  await page.getByLabel('비밀번호').fill('password123')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()

  await page.goto('/groups/new')
  await page.getByLabel('모임 이름').fill('오사카 여행')
  await page.getByLabel('정산 통화').selectOption('KRW')
  await page.getByLabel('이 모임에서 쓸 내 이름').fill('소타')
  await page.getByRole('button', { name: '모임 만들기' }).click()
  // Home is chat-only (Task 5, app-shell restructure): the empty-chat
  // greeting is what a brand-new group shows now — also proof the redirect
  // landed, so no separate wait is needed first.
  await expect(page.getByText('오늘 어떤 지출이 있었나요?')).toBeVisible()
  const groupUrl = page.url()

  // A foreign-currency expense: the manual override keeps this off the network,
  // exactly as every other spec does.
  await page.goto(`${groupUrl}/expenses/new`)
  await page.getByTestId('amount').fill('30000')
  await page.getByLabel('통화').selectOption('JPY')
  await page.getByTestId('wizard-next').click()
  await page.getByTestId('manual-rate-toggle').click()
  await page.getByTestId('market-rate').fill('900')
  for (let step = 1; step < 4; step += 1) {
    await page.getByTestId('wizard-next').click()
  }
  await page.getByTestId('save-expense').click()
  await expect(page.getByTestId('expense-amount')).toBeVisible()

  // `님` after a name is what keeps the following particle decidable; without
  // it this line would read 소타이 결제 for some names and 소타가 for others.
  await expect(page.getByText('소타님이 결제')).toBeVisible()

  // The settlement switch, and the help line that separates it from 개인 지출.
  await expect(page.getByTestId('cancel-expense')).toBeVisible()
  await expect(page.getByText('끄면 기록은 그대로 남고 정산에서만 빠져요.')).toBeVisible()

  // The two numbers the glossary says must never be confused with each
  // other — on /status now (Task 5, app-shell restructure moved totals off
  // home).
  await page.goto(`${groupUrl}/status`)
  await expect(page.getByTestId('total-fronted')).toContainText('내가 낸 돈')
  await expect(page.getByTestId('total-consumed')).toContainText('내 부담액')

  // Switching to English is a property of the account, so it survives a reload.
  await page.goto('/account')
  await expect(page.getByTestId('locale-ko')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await page.getByTestId('locale-en').click()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible()
})
