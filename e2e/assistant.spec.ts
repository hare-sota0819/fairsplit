import { expect, test, type Locator, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { goVia } from './nav'

/**
 * Task 7 of the assistant-brain plan (docs/superpowers/plans/
 * 2026-08-10-assistant-brain.md): end-to-end coverage for the conversational
 * layer `classify()`/`compose.ts`/T6's `ChatComposer` wiring added on top of
 * chat-first expense entry (`e2e/chat-entry.spec.ts`, which stays scoped to
 * the parser/save/handoff flows and is not touched here).
 *
 * There is no component-test harness in this repo (node env) — `classify()`/
 * `compose.ts` are unit-tested exhaustively, but nothing renders `ChatComposer`
 * itself short of a real browser, so this file is the ONLY net for: the
 * CONFIRM_YES/NO tokens actually saving/cancelling the live card, a worded
 * CONFIRM_MODIFY edit actually mutating the rendered card, all three
 * `resolveHalfSplitParticipants` branches end to end (named member / exactly
 * two members / genuinely ambiguous), a query answering with a REAL
 * settlement number (not a composer unit test's synthetic transfer), the
 * GUIDED chips actually being tappable and the escape link actually
 * navigating with `draftNote` carried, and review round 2's NEW-4 (a GUIDED
 * reply's chip closures going stale once a newer card has opened).
 *
 * Most of this suite runs in Korean (`locale: 'ko-KR'`) because the
 * sentences under test — confirm tokens, worded amount edits, 반반 — are
 * Korean-locale lexicon rows; `classify()` filters every marker by
 * `ctx.locale`, and `ctx.locale` is `useLocale()`, which (like every other
 * spec's account) resolves from `Accept-Language` on a brand-new account
 * with no locale cookie yet (see `e2e/korean.spec.ts`'s own doc comment).
 * The one English-locale test lives in its own `describe` with the suite's
 * ordinary `en-US` default (`playwright.config.ts`), overriding nothing.
 */

test.setTimeout(90_000)

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
  // Same pre-existing hydration flake e2e/chat-entry.spec.ts's createGroup
  // works around (docs/BUGS.md 2026-08-09) — filling within the first
  // ~second of the DestinationPicker mounting can take sibling form state
  // down with it.
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

async function signUpEn(
  page: Page,
  name: string,
  email: string,
): Promise<void> {
  await page.goto('/signup')
  await page.getByLabel('Name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByTestId('account-menu')).toBeVisible()
}

async function createGroupEn(
  page: Page,
  name: string,
  displayName: string,
): Promise<string> {
  await page.goto('/groups/new')
  await page.waitForTimeout(1500)
  await page.getByLabel('Group name').fill(name)
  await page.getByLabel('Settlement currency').selectOption('KRW')
  await page.getByLabel('Your display name in this group').fill(displayName)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  return page.url().replace(/\?.*$/, '')
}

/** One participant pill on the chat confirm card, found by the name it shows. */
const participantPill = (page: Page, name: string): Locator =>
  page.locator('[data-testid^="chat-participant-"]').filter({ hasText: name })

/** The most recently pushed composer/query reply bubble — there can be
 *  several `chat-answer` bubbles in one transcript, so every assertion below
 *  is scoped to the last one rather than risking a Playwright strict-mode
 *  match across more than one (same reasoning as the dynamic
 *  `chat-suggestion-*`/`chat-guided-escape-*` testids being suffixed with a
 *  message id — see transcript-render.tsx). */
const lastAnswer = (page: Page): Locator =>
  page.getByTestId('chat-answer').last()

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('chat-input').fill(text)
  await page.getByTestId('chat-send').click()
}

/**
 * The scratch DB URL, derived the same way playwright.config.ts derives
 * `webServer`'s DATABASE_URL — duplicated rather than imported because the
 * config module's own copy is not exported (same duplication
 * trip-currency.spec.ts's own copy of this pair explains).
 */
function scratchDatabaseUrl(devUrl: string): string {
  const u = new URL(devUrl)
  const name = u.pathname.replace(/^\//, '')
  u.pathname = `/${name}_e2e`
  return u.toString()
}

/**
 * Chat has no manual-rate field: a confirm-card save in a currency other
 * than settlement always resolves its rate through `getSnapshotRate`, and
 * this suite's `webServer` deliberately points both FX providers at a closed
 * port — nothing here ever reaches a live one. Seeding today's rate straight
 * into `RateCache` makes that lookup a cache hit instead of a network call
 * (see trip-currency.spec.ts's own copy of this helper for the fuller
 * doc comment).
 */
async function seedTodaysRate(
  base: string,
  quote: string,
  rate: string,
): Promise<void> {
  const devUrl =
    process.env.DATABASE_URL ??
    'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: scratchDatabaseUrl(devUrl),
    }),
  })
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
 * The other half of `seedTodaysRate` — `RateCache` is a single scratch DB
 * shared by the WHOLE run (one worker, reset once before the first spec), so a
 * seeded rate outlives the test that seeded it. That is harmless for the pairs
 * seeded here so far, but NOT for JPY→KRW: `e2e/offline-rate.spec.ts` exists
 * precisely to prove what happens when no rate can be had for that pair, and
 * this file sorts BEFORE it. Task 3's test therefore hands its seed back.
 */
async function clearTodaysRate(base: string, quote: string): Promise<void> {
  const devUrl =
    process.env.DATABASE_URL ??
    'postgresql://fairsplit:localdev@localhost:5432/fairsplit?schema=public'
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: scratchDatabaseUrl(devUrl),
    }),
  })
  const today = new Date().toISOString().slice(0, 10)
  try {
    await db.rateCache.deleteMany({ where: { date: today, base, quote } })
  } finally {
    await db.$disconnect()
  }
}

test.describe('Korean chat-brain flows', () => {
  test.use({ locale: 'ko-KR', viewport: { width: 390, height: 844 } })

  // Runs whether the tests below passed or failed — see `clearTodaysRate`.
  // Every pair this file seeds is handed back, not just the one that has a
  // known downstream victim today: the rule the helper documents is "a spec
  // returns the shared DB the way it found it", and USD→KRW is no more this
  // file's to leave behind than JPY→KRW was.
  test.afterAll(async () => {
    await clearTodaysRate('JPY', 'KRW')
    await clearTodaysRate('USD', 'KRW')
  })

  test('ㄱㄱ saves the open confirm card; ㄴㄴ dismisses it with a polite cancel ack', async ({
    page,
  }) => {
    await signUpKo(page, 'Alice E2E', uniqueEmail('alice-gg'))
    await createGroupKo(page, 'Assistant Confirm E2E', 'Alice')

    await send(page, '택시 8500원')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')

    await send(page, 'ㄱㄱ')
    await expect(
      page.getByTestId('chat-saved-summary').filter({ hasText: '택시' }),
    ).toBeVisible()
    await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)

    // A second card, opened and then explicitly cancelled — never saved.
    // Checked BEFORE any navigation: the transcript has no storage of its
    // own by design (a reload starts empty — ChatTranscript.tsx's own doc
    // comment), so this count only means anything within the same page load.
    await send(page, '커피 4000원')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await send(page, 'ㄴㄴ')
    await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
    await expect(lastAnswer(page)).toContainText(
      '지웠어요. 다시 알려주시면 새로 적을게요.',
    )
    await expect(page.getByTestId('chat-saved-summary')).toHaveCount(1)

    // The history destination, proven once (same pattern as
    // e2e/chat-entry.spec.ts's expectHistoryRow) — only the 택시 expense is
    // durably recorded, not the cancelled 커피 card.
    await goVia(page, 'history')
    await expect(page.getByTestId('feed-row')).toHaveCount(1)
    await expect(
      page.getByTestId('feed-row').filter({ hasText: '택시' }),
    ).toBeVisible()
  })

  test('a worded amount edit, and all three half-split branches (named / two-member / ask-then-resolve)', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await signUpKo(ownerPage, 'Alice E2E', uniqueEmail('alice-modify'))
    const groupUrl = await createGroupKo(
      ownerPage,
      'Assistant Modify E2E',
      'Alice',
    )
    await ownerPage.goto(`${groupUrl}/invite`)
    const invitePath = await ownerPage.getByTestId('invite-link').innerText()

    const minsuContext = await browser.newContext()
    const minsuPage = await minsuContext.newPage()
    await signUpKo(minsuPage, 'Minsu E2E', uniqueEmail('minsu-modify'))
    await joinGroupKo(minsuPage, invitePath, '민수')

    const yunaContext = await browser.newContext()
    const yunaPage = await yunaContext.newPage()
    await signUpKo(yunaPage, 'Yuna E2E', uniqueEmail('yuna-modify'))
    await joinGroupKo(yunaPage, invitePath, '유나')

    await ownerPage.goto(groupUrl)

    // Open a card naming nobody: participants default to everyone (all 3).
    await send(ownerPage, '저녁 20000')
    await expect(ownerPage.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(ownerPage.getByTestId('chat-amount')).toHaveText('₩20,000')

    // A worded amount edit — CONFIRM_MODIFY {field:'amount'}, not a fresh
    // EXPENSE_ENTRY — mutates the SAME open card in place. The natural
    // '…으로' phrasing (DECISIONS.md 2026-08-10 erratum f: '으로' is now
    // recognized fragment-check noise, so this no longer supersedes the
    // card with a junk "으로" draft the way it used to).
    await send(ownerPage, '금액 3만원으로')
    await expect(ownerPage.getByTestId('chat-amount')).toHaveText('₩30,000')
    await expect(lastAnswer(ownerPage)).toContainText('₩30,000으로 고쳤어요')

    // Branch 1 (resolveHalfSplitParticipants): a member actually named in
    // the sentence — splits between the actor and exactly that member,
    // regardless of group size.
    await send(ownerPage, '민수랑 반반')
    await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(participantPill(ownerPage, '유나')).toHaveAttribute(
      'data-state',
      'off',
    )
    await expect(lastAnswer(ownerPage)).toContainText(
      '민수님하고 반씩 나눌게요',
    )

    // A fresh sentence supersedes the open card entirely (spec §5.5(b)) —
    // proves the pair above wasn't a permanent restriction: this new card,
    // naming nobody, is back to all three.
    await send(ownerPage, '점심 15000')
    await expect(ownerPage.getByTestId('chat-amount')).toHaveText('₩15,000')
    await expect(participantPill(ownerPage, '유나')).toHaveAttribute(
      'data-state',
      'on',
    )

    // Branch 3: bare 반반, no name, a 3-member group — genuinely ambiguous.
    // The assistant asks instead of guessing, and the card survives
    // untouched (still all three).
    await send(ownerPage, '반반')
    await expect(ownerPage.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(ownerPage.getByTestId('chat-amount')).toHaveText('₩15,000')
    await expect(participantPill(ownerPage, '유나')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(lastAnswer(ownerPage)).toContainText('누구를 뺄까요?')

    // Answering closes the loop: a plain CONFIRM_MODIFY participants-remove.
    await send(ownerPage, '유나 빼줘')
    await expect(participantPill(ownerPage, '유나')).toHaveAttribute(
      'data-state',
      'off',
    )
    await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
      'data-state',
      'on',
    )
    // '끼리 나누는' (not just '나누는 걸로 고쳤어요'): updatedEveryone's copy
    // ("다같이 나누는 걸로 고쳤어요.") shares that shorter substring, so a
    // looser assertion here would not actually discriminate a genuine
    // participants-only update from that different reply.
    await expect(lastAnswer(ownerPage)).toContainText(
      '끼리 나누는 걸로 고쳤어요',
    )

    await ownerContext.close()
    await minsuContext.close()
    await yunaContext.close()
  })

  test('branch 2: bare 반반 in a two-member group splits between both without asking', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext()
    const ownerPage = await ownerContext.newPage()
    await signUpKo(ownerPage, 'Alice E2E', uniqueEmail('alice-half2'))
    const groupUrl = await createGroupKo(
      ownerPage,
      'Assistant Half Two E2E',
      'Alice',
    )
    await ownerPage.goto(`${groupUrl}/invite`)
    const invitePath = await ownerPage.getByTestId('invite-link').innerText()

    const minsuContext = await browser.newContext()
    const minsuPage = await minsuContext.newPage()
    await signUpKo(minsuPage, 'Minsu E2E', uniqueEmail('minsu-half2'))
    await joinGroupKo(minsuPage, invitePath, '민수')

    await ownerPage.goto(groupUrl)
    await send(ownerPage, '저녁 20000')
    await expect(ownerPage.getByTestId('chat-confirm-card')).toBeVisible()

    await send(ownerPage, '반반')
    await expect(ownerPage.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(participantPill(ownerPage, 'Alice')).toHaveAttribute(
      'data-state',
      'on',
    )
    await expect(participantPill(ownerPage, '민수')).toHaveAttribute(
      'data-state',
      'on',
    )
    // Resolved outright — the assistant states the split, it doesn't ask.
    await expect(lastAnswer(ownerPage)).toContainText(
      '민수님하고 반씩 나눌게요',
    )

    await ownerContext.close()
    await minsuContext.close()
  })

  test('나 얼마 내야 돼? answers with the real pairwise balance from seeded expenses', async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext()
    const alicePage = await ownerContext.newPage()
    await signUpKo(alicePage, 'Alice E2E', uniqueEmail('alice-balance'))
    const groupUrl = await createGroupKo(
      alicePage,
      'Assistant Balance E2E',
      'Alice',
    )
    await alicePage.goto(`${groupUrl}/invite`)
    const invitePath = await alicePage.getByTestId('invite-link').innerText()

    const minsuContext = await browser.newContext()
    const minsuPage = await minsuContext.newPage()
    await signUpKo(minsuPage, 'Minsu E2E', uniqueEmail('minsu-balance'))
    await joinGroupKo(minsuPage, invitePath, '민수')

    // 민수 pays for something split evenly between the two of them (nobody
    // named — a 2-member group defaults participants to everyone) — Alice
    // now owes exactly half: 20,000 / 2 = 10,000.
    await send(minsuPage, '저녁 20000')
    await expect(minsuPage.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(minsuPage.getByTestId('chat-payer')).toContainText(
      '민수님이 결제',
    )
    await minsuPage.getByTestId('chat-confirm-save').click()
    await expect(
      minsuPage.getByTestId('chat-saved-summary').filter({ hasText: '저녁' }),
    ).toBeVisible()

    // Alice's page was server-rendered before that save — reload so its
    // assistantData (settlement-engine output, gathered server-side) picks
    // up the new expense before she asks.
    await alicePage.goto(groupUrl)
    await send(alicePage, '나 얼마 내야 돼?')
    await expect(lastAnswer(alicePage)).toContainText('₩10,000')

    await ownerContext.close()
    await minsuContext.close()
  })

  test('unknown input renders guided chips; tapping one answers; the escape link carries draftNote; a stale chip stays safe once a newer card is open', async ({
    page,
  }) => {
    await signUpKo(page, 'Alice E2E', uniqueEmail('alice-guided'))
    await createGroupKo(page, 'Assistant Guided E2E', 'Alice')

    const gibberish = 'asdkjasdlkj zzz'
    await send(page, gibberish)
    await expect(lastAnswer(page)).toContainText(
      '셈이 잠깐 헷갈렸어요. 혹시 이 중에 있나요?',
    )
    const myBalanceChip = page.locator(
      '[data-testid^="chat-suggestion-myBalance-"]',
    )
    const helpChip = page.locator('[data-testid^="chat-suggestion-help-"]')
    const escapeLink = page.locator('[data-testid^="chat-guided-escape-"]')
    await expect(myBalanceChip).toBeVisible()
    await expect(helpChip).toBeVisible()
    await expect(escapeLink).toBeVisible()

    // Tapping a query chip resubmits its canonical question and answers it
    // for real — no expenses yet, so the empty-state balance copy.
    await myBalanceChip.click()
    await expect(lastAnswer(page)).toContainText('지출을 하나 적으면')

    // A newer card opens — this is the "newer card" NEW-4 (task-6-report.md)
    // warns about: the gibberish reply's chips/escape link closed over the
    // world as it was when THAT reply was pushed, before this card existed.
    await send(page, '택시 8500원')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')

    // Tapping the OLD reply's stale 'help' chip must not disturb the
    // currently open card, and must still append its own answer safely —
    // no ordering corruption, no lost/duplicated card.
    await helpChip.click()
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')
    await expect(lastAnswer(page)).toContainText('이런 건 셈한테 맡기면 돼요.')

    // The stale escape link's href was also fixed at push time — it still
    // carries the ORIGINAL gibberish text, not anything typed since.
    await escapeLink.click()
    await expect(page).toHaveURL(/\/expenses\/new/)
    expect(new URL(page.url()).searchParams.get('draftNote')).toBe(gibberish)
  })

  test('final review I2: a stale EXPENSE_ENTRY chip does not upsert the outcome card back at its OLD transcript position', async ({
    page,
  }) => {
    await signUpKo(page, 'Alice E2E', uniqueEmail('alice-stale-expense'))
    await createGroupKo(page, 'Assistant Stale Expense E2E', 'Alice')

    // "냈어" alone (a genuine pay-verb, no other content) has no card open
    // yet, so it classifies to UNKNOWN suggesting
    // ['QUERY_MY_SPENDING','EXPENSE_ENTRY'] (§4.8 partial-hit ranking). Its
    // 'expense' chip bypasses classify() entirely and opens a card straight
    // from `parse('냈어', ...)` when tapped (review I1, T6) — the SAME
    // "GUIDED chip closure goes stale" shape the HELP chip test above
    // covers, but this one actually mutates `outcome`, which the HELP chip
    // never does.
    await send(page, '냈어')
    const staleExpenseChip = page.locator(
      '[data-testid^="chat-suggestion-expense-"]',
    )
    await expect(staleExpenseChip).toBeVisible()

    // A newer card opens from a different sentence.
    await send(page, '택시 8500원')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('₩8,500')

    // Another assistant reply lands AFTER the card, with the card's own
    // transcript slot still sitting between the 택시 send and this one —
    // this is what makes the OLD ("upsert in place at the stale index")
    // and the FIXED ("remove, then re-append at the end") behavior
    // observably different: with nothing interposed here, both positions
    // would coincide and the bug would be invisible.
    await send(page, '뭐 할 수 있어?')
    await expect(lastAnswer(page)).toContainText('이런 건 셈한테 맡기면 돼요.')

    // Tapping the STALE 'expense' chip from the very first reply supersedes
    // the open card with a fresh draft parsed from "냈어" (no amount -> an
    // askAmount card). Final-review I2: `openExpenseCard` now reads the
    // CURRENT outcome via a ref (`outcomeRef`), so it correctly REMOVES the
    // old card before re-appending the new one at the end of the
    // transcript, instead of upserting in place at the confirm card's
    // now-stale index — above the "뭐 할 수 있어?" reply that landed after
    // it, which is exactly what the old (buggy) read produced.
    await staleExpenseChip.click()
    await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
    const newCard = page.getByTestId('chat-ask-amount-card')
    await expect(newCard).toBeVisible()

    const cardBox = await newCard.boundingBox()
    const helpReplyBox = await lastAnswer(page).boundingBox()
    expect(cardBox).not.toBeNull()
    expect(helpReplyBox).not.toBeNull()
    // The card must render BELOW (later in the vertically-stacked
    // transcript than) the "뭐 할 수 있어?" reply — the old bug placed it
    // ABOVE, at the superseded confirm card's original position.
    expect(cardBox!.y).toBeGreaterThan(helpReplyBox!.y)
  })

  /**
   * A2 (docs/PROMPT.md "2026-08-11 배포 후 폰 리뷰 2차") superseded the old
   * "final review I3" test this replaces: a crossCurrency card used to
   * refuse CONFIRM_YES entirely and point at the wizard handoff instead
   * (spec §2.2 as it stood then, round-2 review M11). That dead end is
   * gone — a foreign-currency mention now opens an ORDINARY confirm card
   * (this suite's own charter names "the CONFIRM_YES/NO tokens actually
   * saving/cancelling the live card" as exactly what this file exists to
   * prove, so CONFIRM_YES on THIS kind of card belongs here too), with an
   * inline funding-source section (the currency differs from the group's
   * KRW settlement currency), and a typed CONFIRM_YES saves it for real —
   * the classify.ts unit tests already pin that CONFIRM_YES/CONFIRM_MODIFY
   * no longer special-case a foreign-currency card; this is the one place
   * that proves the save actually lands.
   */
  test('A2: a typed CONFIRM_YES on a foreign-currency confirm card saves it directly, funding section and all', async ({
    page,
  }) => {
    await signUpKo(page, 'Alice E2E', uniqueEmail('alice-crosscur'))
    await createGroupKo(page, 'Assistant CrossCurrency E2E', 'Alice')
    await seedTodaysRate('USD', 'KRW', '1300')

    // A foreign-currency mention (달러 = USD, group settles in KRW) opens an
    // ordinary confirm card now — never the old dedicated dead-end card.
    await send(page, '점심 50달러')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-cross-currency-card')).toHaveCount(0)
    await expect(page.getByTestId('chat-amount')).toContainText('$50')

    // The funding section is offered (USD != the group's KRW settlement
    // currency), defaulting to the safe "paid on the spot" choice.
    const funding = page.getByTestId('chat-funding-section')
    await expect(funding).toBeVisible()
    await expect(page.getByTestId('chat-funding-onspot')).toHaveAttribute(
      'data-state',
      'on',
    )

    // A CONFIRM_YES token acts exactly like tapping Save — no more special
    // case, no wizard-handoff detour.
    await send(page, 'ㅇㅇ')
    await expect(
      page.getByTestId('chat-saved-summary').filter({ hasText: '점심' }),
    ).toBeVisible()
    await expect(page.getByTestId('chat-confirm-card')).toHaveCount(0)
  })

  /**
   * Task 3 (docs/PROMPT.md [2026-08-14] decision 2) — appended HERE, not to
   * `e2e/chat-entry.spec.ts` or `e2e/trip-currency.spec.ts`: this is a worded
   * CONFIRM_MODIFY edit mutating the rendered card, which is this suite's own
   * declared charter (see the file header), and it is the only suite that
   * already runs in `ko-KR` — `classify()` filters every MODIFY marker by
   * `ctx.locale`, so "바꿔줘" is inert in the en-US locale the other two specs
   * run under. It also already owns `seedTodaysRate`, which a foreign-currency
   * chat save needs (chat's confirm card has no manual-rate field).
   *
   * The ruling: an open card is an UNSAVED DRAFT, so naming a currency in the
   * edit changes the card's currency along with its amount — nothing is
   * stored yet, so there is no snapshot to protect. (The SAVED-expense rung of
   * the same ladder is F-T4's one-confirm cancel + re-create,
   * `applyCurrencyChange` — proven in `e2e/chat-edit.spec.ts`.)
   */
  test('Task 3: a worded edit naming a currency changes the open card’s currency too, and saves as that currency', async ({
    page,
  }) => {
    await signUpKo(page, 'Alice E2E', uniqueEmail('alice-curedit'))
    await createGroupKo(page, 'Assistant Currency Edit E2E', 'Alice')
    await seedTodaysRate('JPY', 'KRW', '9')

    // Opens in the group's own settlement currency: nothing to convert, so
    // the A2 funding section is not rendered at all.
    await send(page, '커피 4000원')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('₩4,000')
    await expect(page.getByTestId('chat-funding-section')).toHaveCount(0)

    // One message changes both: 엔 = JPY, and the card follows it.
    await send(page, '4000엔으로 바꿔줘')
    await expect(page.getByTestId('chat-confirm-card')).toBeVisible()
    await expect(page.getByTestId('chat-amount')).toHaveText('¥4,000')
    // The reply names the card's NEW currency — it used to be hardcoded to
    // the chat default, which would read back "₩4,000으로 고쳤어요" here.
    await expect(lastAnswer(page)).toContainText('¥4,000으로 고쳤어요')

    // Same card, now foreign: the existing funding section appears, reset to
    // the safe on-the-spot default.
    await expect(page.getByTestId('chat-funding-section')).toBeVisible()
    await expect(page.getByTestId('chat-funding-onspot')).toHaveAttribute(
      'data-state',
      'on',
    )

    // Fix round 1 (I2): the same edit written the way people actually write
    // it on a Japan trip — a Hangul place-value compound closed by 엔, not an
    // Arabic digit run. This used to read as no amount at all and answer
    // "뭘 바꿀까요?" instead of touching the card.
    await send(page, '5천엔으로')
    await expect(page.getByTestId('chat-amount')).toHaveText('¥5,000')
    await expect(page.getByTestId('chat-funding-section')).toBeVisible()

    // The edits touched the amount and the currency, nothing else — the
    // description typed in the first sentence is still the one that saves.
    await page.getByTestId('chat-confirm-save').click()
    await expect(
      page.getByTestId('chat-saved-summary').filter({ hasText: '커피' }),
    ).toBeVisible()

    // What actually landed in the database: JPY, not the KRW the card opened
    // in — the save payload reads the card's own currency, so this is the
    // assertion that proves the edit reached it and not just the rendering.
    await goVia(page, 'history')
    await page.getByTestId('feed-row').filter({ hasText: '커피' }).click()
    await page.getByTestId('feed-open').click()
    await expect(page).toHaveURL(/\/expenses\/[^/]+$/)
    await expect(page.getByTestId('expense-amount')).toContainText('¥5,000')
  })
})

test.describe('English happy path', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('"what do I owe" answers in English', async ({ page }) => {
    await signUpEn(page, 'Alice E2E', uniqueEmail('alice-en'))
    await createGroupEn(page, 'Assistant English E2E', 'Alice')

    await send(page, 'what do I owe')
    await expect(lastAnswer(page)).toContainText(
      "Add one expense and I'll tell you what you owe.",
    )
  })
})
