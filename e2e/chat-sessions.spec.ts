import { expect, test, type Page } from '@playwright/test'


test.use({ viewport: { width: 390, height: 844 } })

const uniqueEmail = (): string =>
  `e2e-sessions-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

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
  // Known pre-existing flake workaround (docs/BUGS.md 2026-08-09): wait for
  // DestinationPicker hydration before filling.
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill('빅헤드')
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

/** The session list lives on the /chats page (the drawer that used to
 *  mirror it is gone — navigation is the in-place text index). */
async function openChatsPage(page: Page, groupUrl: string): Promise<void> {
  await page.goto(`${groupUrl}/chats`)
  await expect(page.getByTestId('sidebar-sessions')).toBeVisible()
}

/** A row menu can detach mid-click while an RSC refresh is in flight —
 *  retry like a real second tap. */
async function openRowMenuWithRetry(page: Page): Promise<void> {
  const menuButtons = page.locator('[data-testid^="sidebar-session-menu-"]')
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await menuButtons.first().click({ timeout: 5000 })
      await expect(
        page.getByTestId('sidebar-session-rename-input'),
      ).toBeVisible({ timeout: 2000 })
      return
    } catch {
      await page.waitForTimeout(500)
    }
  }
  await menuButtons.first().click()
  await expect(page.getByTestId('sidebar-session-rename-input')).toBeVisible()
}

async function sendChat(page: Page, text: string): Promise<void> {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

test('sessions: lazy creation, auto-title, switch, cross-session ledger, rename, delete', async ({
  page,
}) => {
  await signUp(page, '세션 사용자', uniqueEmail())
  const groupUrl = await createGroup(page, '세션 테스트')

  // --- Conversation 1: record an expense; its first message becomes the
  // session title once the sidebar renders again. -------------------------
  await sendChat(page, '점심 김치찌개 13000원')
  await page.getByTestId('chat-confirm-save').click()
  // e2e accounts run the en locale — the saved summary opens with "Noted."
  await expect(page.getByText(/Noted\./)).toBeVisible()

  // --- New chat starts empty (?s=new; no session row yet). ----------------
  await openChatsPage(page, groupUrl)
  await expect(
    page.getByTestId('sidebar-sessions').getByText('점심 김치찌개 13000원'),
  ).toBeVisible()
  await page.getByTestId('chats-new-chat').click()
  await page.waitForURL(/\?s=new/)
  // The fresh conversation greets empty — no card, no prior bubbles.
  await expect(page.getByText('What did you spend today?')).toBeVisible()
  await expect(page.getByTestId('chat-confirm-save')).toHaveCount(0)

  // --- Cross-session ledger: the OTHER conversation's expense answers a
  // history question here. -------------------------------------------------
  await sendChat(page, 'show me the history')
  await expect(page.getByText('김치찌개').last()).toBeVisible()

  // The follow-up created conversation 2 lazily; both are now listed.
  await openChatsPage(page, groupUrl)
  await expect(
    page.getByTestId('sidebar-sessions').getByText('show me the history'),
  ).toBeVisible()

  // --- Switching back reopens conversation 1 with its transcript. ---------
  await page
    .getByTestId('sidebar-sessions')
    .getByText('점심 김치찌개 13000원')
    .click()
  await page.waitForURL(/\?s=(?!new)/)
  await expect(
    page.getByText('점심 김치찌개 13000원').first(),
  ).toBeVisible()

  // --- Rename pins a hand-given title; delete removes the thread. ---------
  await openChatsPage(page, groupUrl)
  await openRowMenuWithRetry(page)
  await page.getByTestId('sidebar-session-rename-input').fill('여행 첫날')
  await page.getByTestId('sidebar-session-rename-save').click()
  await expect(
    page.getByTestId('sidebar-sessions').getByText('여행 첫날'),
  ).toBeVisible()

  await openRowMenuWithRetry(page)
  await page.getByTestId('sidebar-session-delete').click()
  await expect(
    page.getByTestId('sidebar-sessions').getByText('여행 첫날'),
  ).toHaveCount(0)
})
