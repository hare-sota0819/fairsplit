import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import { goVia } from './nav'

/**
 * Task 10 of the goat-parser plan: CONTEXT COMMANDS end to end — "아까 그
 * 술값에 유나도 껴줘" against an expense that is already saved.
 *
 * The pure layer (Task 9's `findReference`/`findEditAction`/`resolveReference`,
 * and this task's `resolveEditCard`/`editAskOf`/`editBlockedKey`) is
 * unit-tested exhaustively; nothing short of a real browser exercises the part
 * that matters here — a sentence resolving against the group's ACTUAL
 * expenses, the card asking before anything happens, and the server action
 * moving real rows. All three tests therefore assert on state the DATABASE
 * holds afterwards (a participant on the expense detail, a cancelled row in
 * the feed), not just on the bubble that claimed it.
 *
 * Korean locale, like `e2e/assistant.spec.ts`'s own chat-brain suite: every
 * sentence under test is a Korean lexicon row, `classify()` filters markers by
 * `ctx.locale`, and this is also the only automated look at the new
 * `chat.edit.*` 해요체 copy. Helpers are local copies, this repo's e2e
 * convention (no shared page objects).
 */

test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } })
// Three real accounts, two group joins and four saves per test — the same
// budget e2e/assistant.spec.ts's multi-member flows run on.
test.setTimeout(90_000)

test.describe('Chat context commands', () => {
  const uniqueEmail = (tag: string): string =>
    `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`

  async function signUpKo(
    page: Page,
    name: string,
    email: string,
  ): Promise<void> {
    await page.goto('/signup')
    await page.getByLabel('이름').fill(name)
    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill('password123')
    await page.getByRole('button', { name: '계정 만들기' }).click()
    await expect(page.getByTestId('account-menu')).toBeVisible()
  }

  async function createGroupKo(
    page: Page,
    name: string,
    displayName: string,
  ): Promise<string> {
    await page.goto('/groups/new')
    // Pre-existing hydration flake (docs/BUGS.md 2026-08-09) — filling the
    // form within the first ~second of DestinationPicker mounting can take
    // sibling form state down with it.
    await page.waitForTimeout(1500)
    await page.getByLabel('모임 이름').fill(name)
    await page.getByLabel('정산 통화').selectOption('KRW')
    await page.getByLabel('이 모임에서 쓸 내 이름').fill(displayName)
    await page.getByRole('button', { name: '모임 만들기' }).click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
    return page.url().replace(/\?.*$/, '')
  }

  async function joinGroupKo(
    page: Page,
    invitePath: string,
    displayName: string,
  ): Promise<void> {
    await page.goto(invitePath)
    await page.getByLabel('이 모임에서 쓸 내 이름').fill(displayName)
    await page.getByRole('button', { name: '모임 참여' }).click()
    await expect(page.getByTestId('chat-input')).toBeVisible()
  }

  async function send(page: Page, text: string): Promise<void> {
    await page.getByTestId('chat-input').fill(text)
    await page.getByTestId('chat-send').click()
  }

  /** One participant pill on the confirm card, found by the name it shows. */
  const participantPill = (page: Page, name: string): Locator =>
    page.locator('[data-testid^="chat-participant-"]').filter({ hasText: name })

  const lastAnswer = (page: Page): Locator =>
    page.getByTestId('chat-answer').last()

  /**
   * Saves one expense from chat. `soloParticipant` untoggles everyone but the
   * actor first — `parse()` shares an expense between every member by default,
   * so without it "유나도 껴줘" would have nothing to add and the test would
   * pass on a no-op.
   */
  async function saveExpense(
    page: Page,
    sentence: string,
    options: { without?: string } = {},
  ): Promise<void> {
    await send(page, sentence)
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    if (options.without !== undefined) {
      await participantPill(page, options.without).click()
      await expect(participantPill(page, options.without)).toHaveAttribute(
        'data-state',
        'off',
      )
    }
    const saved = page.getByTestId('chat-saved-summary')
    const before = await saved.count()
    await page.getByTestId('chat-confirm-save').click()
    // A NEW saved bubble, counted — `.last()` alone would be satisfied by the
    // PREVIOUS save's bubble and let this helper return while the action was
    // still in flight. That matters beyond neatness: a successful save ends in
    // `cancel()`, which clears the composer's text — returning early let the
    // next sentence be typed and then wiped before it was ever sent. The card
    // disappearing is that same `cancel()` observed, so both are waited for.
    await expect(saved).toHaveCount(before + 1)
    await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
  }

  /**
   * Saves an ITEMISED expense (the "who had what" card) — same participant
   * pills and same Save button as the ordinary confirm card, different card
   * testid. Its title comes from the first item's name (`chat.items.autoTitle`
   * → "김치찌개 외 1건"), which is what the reference keyword below matches.
   */
  async function saveItemsExpense(
    page: Page,
    sentence: string,
    options: { without?: string } = {},
  ): Promise<void> {
    await send(page, sentence)
    await expect(page.getByTestId('chat-confirm-items-card')).toBeVisible()
    if (options.without !== undefined) {
      await participantPill(page, options.without).click()
      await expect(participantPill(page, options.without)).toHaveAttribute(
        'data-state',
        'off',
      )
    }
    const saved = page.getByTestId('chat-saved-summary')
    const before = await saved.count()
    await page.getByTestId('chat-confirm-save').click()
    await expect(saved).toHaveCount(before + 1)
    await expect(page.getByTestId('chat-confirm-items-card')).toHaveCount(0)
  }

  /** Opens the newest matching expense's detail page from the history feed. */
  async function openExpenseDetail(page: Page, title: string): Promise<void> {
    await goVia(page, 'history')
    await page
      .getByTestId('feed-row')
      .filter({ hasText: title })
      .getByRole('button')
      .click()
    await page.getByTestId('feed-open').click()
    await expect(page.getByTestId('expense-amount')).toBeVisible()
  }

  /**
   * F-T4 (docs/PROMPT.md [2026-08-14] decision 2, saved half) — the two
   * helpers a currency swap needs, local copies of `e2e/assistant.spec.ts`'s
   * own pair (this repo's e2e convention is a local copy per spec, not a
   * shared page object).
   *
   * The scratch DB URL is derived the same way playwright.config.ts derives
   * `webServer`'s, duplicated because the config's copy is not exported.
   */
  function scratchDatabaseUrl(devUrl: string): string {
    const u = new URL(devUrl)
    const name = u.pathname.replace(/^\//, '')
    u.pathname = `/${name}_e2e`
    return u.toString()
  }

  function scratchDb(): PrismaClient {
    const devUrl =
      process.env.DATABASE_URL ??
      'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
    return new PrismaClient({
      adapter: new PrismaPg({ connectionString: scratchDatabaseUrl(devUrl) }),
    })
  }

  /**
   * Neither the chat's confirm card nor its currency SWAP has a manual-rate
   * field: both resolve the new expense's snapshot through `getSnapshotRate`,
   * and this suite's `webServer` deliberately points both FX providers at a
   * closed port so no test ever reaches a live one. Seeding today's rate
   * straight into `RateCache` makes that lookup a cache hit instead of a
   * network call.
   */
  async function seedTodaysRate(
    base: string,
    quote: string,
    rate: string,
  ): Promise<void> {
    const db = scratchDb()
    const today = new Date().toISOString().slice(0, 10)
    try {
      await db.rateCache.upsert({
        where: { date_base_quote: { date: today, base, quote } },
        create: { date: today, base, quote, rate, asOf: today },
        update: { rate, asOf: today, fetchedAt: new Date() },
      })
    } finally {
      await db.$disconnect()
    }
  }

  /**
   * The other half of it. `RateCache` is a single scratch DB shared by the
   * WHOLE run, so a seeded rate outlives the spec that seeded it — and
   * `e2e/offline-rate.spec.ts` exists precisely to prove what happens when
   * JPY→KRW cannot be had, sorting AFTER this file. A spec returns the shared
   * DB the way it found it.
   */
  async function clearTodaysRate(base: string, quote: string): Promise<void> {
    const db = scratchDb()
    const today = new Date().toISOString().slice(0, 10)
    try {
      await db.rateCache.deleteMany({ where: { date: today, base, quote } })
    } finally {
      await db.$disconnect()
    }
  }

  // Runs whether the tests passed or failed — see `clearTodaysRate`.
  test.afterAll(async () => {
    await clearTodaysRate('JPY', 'KRW')
  })

  /**
   * A two-member group with the two expenses every test below references:
   * 이자카야 (the 술값 the synonym table maps onto) and 택시.
   */
  async function seedGroup(
    browser: Browser,
    tag: string,
    groupName: string,
  ): Promise<{ ownerPage: Page; groupUrl: string; close: () => Promise<void> }> {
    const ownerContext = await browser.newContext({ locale: 'ko-KR' })
    const ownerPage = await ownerContext.newPage()
    await ownerPage.setViewportSize({ width: 390, height: 844 })
    await signUpKo(ownerPage, 'Alice E2E', uniqueEmail(`alice-${tag}`))
    const groupUrl = await createGroupKo(ownerPage, groupName, '앨리스')
    await ownerPage.goto(`${groupUrl}/invite`)
    const invitePath = await ownerPage.getByTestId('invite-link').innerText()

    const yunaContext = await browser.newContext({ locale: 'ko-KR' })
    const yunaPage = await yunaContext.newPage()
    await signUpKo(yunaPage, 'Yuna E2E', uniqueEmail(`yuna-${tag}`))
    await joinGroupKo(yunaPage, invitePath, '유나')
    await yunaContext.close()

    // Back to the chat, now that the roster has two members.
    await ownerPage.goto(groupUrl)
    return {
      ownerPage,
      groupUrl,
      close: async () => {
        await ownerContext.close()
      },
    }
  }

  /**
   * Test 1 — the flagship sentence. A synonym match (술값 → 이자카야) resolves
   * to exactly ONE expense, so the card confirms rather than asks which; the
   * card names the target expense; and confirming it actually puts 유나 on that
   * expense in the database.
   */
  test('술값 finds the 이자카야 expense, the card names it, and confirming adds 유나 to it', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'add',
      'Context Add E2E',
    )

    // 이자카야 is shared by 앨리스 alone, so adding 유나 is a real change.
    await saveExpense(page, '이자카야 30000원', { without: '유나' })
    await saveExpense(page, '택시 8500원')

    await send(page, '아까 그 술값에 유나도 껴줘')

    // ONE match: the confirm card, naming BOTH the change and the expense it
    // changes — never a silent edit, never a "which one?" for a resolved
    // reference.
    const card = page.getByTestId('chat-confirm-edit-card')
    await expect(card).toBeVisible()
    await expect(page.getByTestId('chat-disambiguate-card')).toHaveCount(0)
    await expect(card.getByTestId('chat-edit-question')).toContainText('유나')
    await expect(card.getByTestId('chat-edit-question')).toContainText('이자카야')
    await expect(card.getByTestId('chat-edit-target')).toContainText('이자카야')
    await expect(card.getByTestId('chat-edit-target')).toContainText('₩30,000')

    await card.getByTestId('chat-edit-confirm').click()
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)
    await expect(lastAnswer(page)).toContainText('이자카야')

    // The DATABASE, not the bubble: the expense detail lists 유나 as someone
    // this expense is split with.
    await openExpenseDetail(page, '이자카야')
    await expect(page.locator('main')).toContainText('유나')

    await close()
  })

  /**
   * Review Critical 1 — an ITEMISED expense is split by its item ASSIGNMENTS,
   * not by `participants`, so a chat participant edit on one would be
   * silently ineffective (adding: nobody's share moves, yet the reply says it
   * worked) or actively wrong (removing: hidden from every screen while the
   * assigned lines still charge them). The card must refuse BEFORE the tap,
   * name the reason, and point at the one screen that can do it.
   */
  test('a participant edit on an itemised expense is blocked before it can be tapped, and writes nothing', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'items',
      'Context Items E2E',
    )

    // Two receipt lines, shared by 앨리스 alone — so "유나도 껴줘" would be a
    // real change if it were allowed, not a no-op that could pass either way.
    await saveItemsExpense(page, '13000원 김치찌개 3개, 7000원 콜라 2개', {
      without: '유나',
    })

    await send(page, '아까 그 김치찌개에 유나도 껴줘')

    const card = page.getByTestId('chat-confirm-edit-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('chat-edit-blocked')).toContainText(
      '채팅에서는 못 바꿔요',
    )
    // No way to apply it at all — the button is not merely disabled, it is
    // not offered.
    await expect(card.getByTestId('chat-edit-confirm')).toHaveCount(0)
    // The escape IS offered here, because the full form really can do this.
    await expect(card.getByTestId('chat-edit-open-form')).toBeVisible()

    // Nothing was written: 유나 is still not on this expense.
    await openExpenseDetail(page, '김치찌개')
    await expect(page.locator('main')).not.toContainText('유나')

    await close()
  })

  /**
   * Test 2 — ambiguity is an ASK, never a guess. A bare 그거 names no category,
   * so both expenses survive: the disambiguation card lists them, picking one
   * narrows to the confirm card for THAT expense, and confirming cancels it —
   * visible as the greyed-out row in the feed.
   */
  test('그거 취소해줘 with two candidates lists them, and the picked one is cancelled', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'cancel',
      'Context Cancel E2E',
    )

    await saveExpense(page, '이자카야 30000원')
    await saveExpense(page, '택시 8500원')

    await send(page, '그거 취소해줘')

    const list = page.getByTestId('chat-disambiguate-card')
    await expect(list).toBeVisible()
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)
    await expect(list.getByTestId('chat-edit-prompt')).toHaveText(
      '이 중 어느 지출이에요?',
    )
    await expect(list.getByTestId('chat-edit-candidate')).toHaveCount(2)

    await list
      .getByTestId('chat-edit-candidate')
      .filter({ hasText: '이자카야' })
      .click()

    const card = page.getByTestId('chat-confirm-edit-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('chat-edit-question')).toContainText(
      '이자카야',
    )
    await card.getByTestId('chat-edit-confirm').click()
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)
    await expect(lastAnswer(page)).toContainText('취소했어요')

    // Greyed out in the feed — and only that one. (Cancelling is deliberately
    // the one edit NOT blocked on an itemised expense either: it removes the
    // whole receipt from settlement, so nothing can half-apply.)
    await goVia(page, 'history')
    await expect(page.getByTestId('feed-cancelled')).toHaveCount(1)
    await expect(page.getByTestId('feed-cancelled')).toContainText('이자카야')
    await expect(page.getByTestId('feed-row')).toHaveCount(1)
    await expect(page.getByTestId('feed-row')).toContainText('택시')

    await close()
  })

  /**
   * Test 3 — a reference that matches nothing. The window and keyword found no
   * expense at all, so the card says so and offers the newest few as a "is it
   * one of these?" list, plus the escape into the full history. Nothing is
   * ever applied on a miss.
   */
  test('a reference that matches nothing falls back to the recent list, with a way into history', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'none',
      'Context Fallback E2E',
    )

    await saveExpense(page, '이자카야 30000원')
    await saveExpense(page, '택시 8500원')

    // Yesterday's parking: the right shape of sentence, pointing at nothing
    // this group has.
    await send(page, '어제 주차비 취소해줘')

    const list = page.getByTestId('chat-disambiguate-card')
    await expect(list).toBeVisible()
    await expect(list.getByTestId('chat-edit-prompt')).toContainText(
      '못 찾았어요',
    )
    // The fallback is the newest few EXPENSES, offered as a question.
    await expect(list.getByTestId('chat-edit-candidate')).toHaveCount(2)
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)

    // The escape: the full history, one tap away.
    await list.getByTestId('chat-edit-history').click()
    await page.waitForURL(/\/history$/)
    await expect(page.getByTestId('feed-row')).toHaveCount(2)
    // Nothing was cancelled on the way out.
    await expect(page.getByTestId('feed-cancelled')).toHaveCount(0)

    await close()
  })

  /**
   * F-T4, test 1 — the owner's headline sentence for the saved half of
   * decision 2. A stored expense's currency and rate snapshot are immutable,
   * so "그거 4000엔으로 바꿔줘" is answered by CANCELLING it and re-creating it
   * in the new currency: two operations this app already performs safely,
   * agreed to ONCE, on a card that names both sides and says the new expense
   * is priced again.
   *
   * Asserted on the DATABASE's own answer, like every test above: the old row
   * greyed out in the feed, a NEW row beside it, and the new expense's detail
   * page showing JPY with the participants and payer the old one had.
   */
  test('a saved ₩ expense told to become ¥ is cancelled and re-created behind one confirm', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'swap',
      'Context Swap E2E',
    )
    // The re-created expense is JPY in a KRW group, so it needs a snapshot for
    // the ORIGINAL day — which is today, since it is saved here and now.
    await seedTodaysRate('JPY', 'KRW', '9')

    // 앨리스 alone shares it: a re-create that quietly defaulted the
    // participants back to "everyone" would put 유나 on the new row, and the
    // assertion at the bottom would catch it.
    await saveExpense(page, '점심 4000원', { without: '유나' })

    await send(page, '그거 4000엔으로 바꿔줘')

    // ONE confirm card — never a refusal (the pre-F-T4 answer), never two
    // separate confirmations for the cancel and the re-create.
    const card = page.getByTestId('chat-confirm-edit-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('chat-edit-blocked')).toHaveCount(0)
    // Both sides named, old → new.
    await expect(card.getByTestId('chat-edit-question')).toContainText('₩4,000')
    await expect(card.getByTestId('chat-edit-question')).toContainText('¥4,000')
    // And what the user is really agreeing to: a new expense, re-calculated.
    await expect(card.getByTestId('chat-edit-swap-detail')).toContainText(
      '새 지출로 다시 계산돼요',
    )

    await card.getByTestId('chat-edit-confirm').click()
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)
    await expect(lastAnswer(page)).toContainText('점심')

    // The feed: the old row greyed out, the new one live beside it.
    await goVia(page, 'history')
    await expect(page.getByTestId('feed-cancelled')).toHaveCount(1)
    await expect(page.getByTestId('feed-cancelled')).toContainText('점심')
    await expect(page.getByTestId('feed-row')).toHaveCount(1)
    await expect(page.getByTestId('feed-row')).toContainText('점심')

    // The new expense itself: JPY, same payer, same (single) participant.
    await page.getByTestId('feed-row').getByRole('button').click()
    await page.getByTestId('feed-open').click()
    await expect(page.getByTestId('expense-amount')).toContainText('¥4,000')
    await expect(page.locator('main')).toContainText('앨리스')
    await expect(page.locator('main')).not.toContainText('유나')

    await close()
  })

  /**
   * F-T4, test 2 — the same flow in the other direction, which is the one
   * that actually happens on a trip: a foreign-currency expense corrected back
   * into the group's own settlement currency. The re-created row needs no
   * provider at all here (KRW settles at 1), so this also proves the swap is
   * not quietly coupled to the rate lookup the first test seeds.
   */
  test('the swap runs the other way too — a ¥ expense told to become ₩', async ({
    browser,
  }) => {
    const { ownerPage: page, close } = await seedGroup(
      browser,
      'swapback',
      'Context Swap Back E2E',
    )
    // Needed by the SAVE below (a JPY expense in a KRW group), not by the swap.
    await seedTodaysRate('JPY', 'KRW', '9')

    await saveExpense(page, '스시 4000엔', { without: '유나' })

    await send(page, '그거 30000원으로 바꿔줘')

    const card = page.getByTestId('chat-confirm-edit-card')
    await expect(card).toBeVisible()
    await expect(card.getByTestId('chat-edit-question')).toContainText('¥4,000')
    await expect(card.getByTestId('chat-edit-question')).toContainText('₩30,000')

    await card.getByTestId('chat-edit-confirm').click()
    await expect(page.getByTestId('chat-confirm-edit-card')).toHaveCount(0)

    await goVia(page, 'history')
    await expect(page.getByTestId('feed-cancelled')).toHaveCount(1)
    await expect(page.getByTestId('feed-cancelled')).toContainText('스시')
    await expect(page.getByTestId('feed-row')).toHaveCount(1)

    await page.getByTestId('feed-row').getByRole('button').click()
    await page.getByTestId('feed-open').click()
    await expect(page.getByTestId('expense-amount')).toContainText('₩30,000')
    // Settlement currency now, so there is nothing left to convert.
    await expect(page.getByTestId('expense-converted')).toHaveCount(0)

    await close()
  })
})
