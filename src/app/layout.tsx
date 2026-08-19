import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Newsreader } from 'next/font/google'
import { Header } from '@/components/Header'
import { NavigationWatchdog } from '@/components/NavigationWatchdog'
import { SidebarProvider } from '@/components/sidebar/SidebarProvider'
import { ThemeScript } from '@/components/ThemeChoice'
// Pretendard Variable — the UI/body face (SPEC §3). The dynamic-subset
// stylesheet declares one @font-face per unicode range, so a page fetches
// only the glyph ranges it renders (a few KB for Latin, the Hangul ranges
// only when Korean copy is on screen). Referenced by name in globals.css's
// `--font-sans` stack.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './globals.css'

// Newsreader — display type and every money figure (SPEC §3). Variable
// font from Google Fonts with the optical-size axis, roman + italic; weight
// defaults to the full variable range (400/500 are the ones the statement
// uses). Latin-only by design: globals.css puts it first in the display
// stack with Pretendard second, so Hangul always falls through to sans.
const newsreader = Newsreader({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-newsreader',
  display: 'swap',
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app')
  return {
    title: t('name'),
    description: t('tagline'),
  }
}

// `manifest.ts` declares `display: 'standalone'` — installed, this app has
// no browser chrome reserving the notch/status-bar or home-indicator areas
// for itself, unlike a page open in a Safari tab. Without `viewportFit:
// 'cover'`, every `env(safe-area-inset-*)` used across the app (the group
// layout's bottom padding, the chat dock, the sidebar drawer) resolves to a
// constant 0 — genuinely inert, not just usually 0. This is what makes them
// real.
// T7 intake (landscape/horizontal safe-area): only `inset-top`/`inset-bottom`
// are used anywhere in the app (here, the group layout, the chat dock, the
// sidebar drawer, ReceiptScan's fullscreen header). `inset-left`/
// `inset-right` — which matter once the device rotates and the notch/home
// indicator move to a long edge — are deliberately NOT wired up. Every
// design constraint in this overhaul (PITCH_TEARDOWN.md, the rev2 plan, the
// all-screens sweep) targets one fixed viewport, phone-portrait 390×844;
// there is no landscape mock, no landscape screenshot pass, and nothing to
// verify a horizontal inset against. Decision: accept portrait-only for this
// pass rather than add unverified CSS. Revisit if/when landscape becomes a
// real target — the fix is additive (`px-[max(1.25rem,env(safe-area-inset-
// left))]` etc.), not a redesign.
export const viewport: Viewport = {
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} h-full`}
    >
      <head>
        <ThemeScript />
      </head>
      {/* Top inset moved off <body> and into the sticky Header (2026-08-14):
          body padding only protected the header while it scrolled with the
          page; a stuck header needs to carry the inset itself, and it is
          the first visible child on every route, so nothing else lost its
          protection. The bottom inset stays here — see the comment below. */}
      <body className="min-h-full flex flex-col pb-[env(safe-area-inset-bottom)]">
        {/* Standalone display (no browser chrome) plus `viewportFit: 'cover'`
            above means the notch/status-bar and home-indicator areas are
            exposed to page content on EVERY route, not just group ones — a
            review round first put the bottom inset only on the group
            layout's own wrapper, which left every non-group route
            (/groups, /account, /guide, the landing page, auth forms) with
            no bottom protection at all once `cover` removed the browser's
            automatic one. `body` is the one place both insets belong: it is
            the outermost flex container reached by every route, `Header`
            (top) and every route's own content (bottom) are its normal-flow
            children with nothing else between, and every `position: fixed`
            element in the app (loading overlay, sidebar drawer, dialogs) is
            portalled straight to `document.body` and positions against the
            viewport regardless of this padding either way. The group
            layout's own wrapper does NOT also add the bottom inset — see
            its comment for why that would double-count it again. */}
        {/* Re-dispatches a navigation whose commit this Next version's React
            silently dropped (docs/SOLVED.md 2026-08-10). Renders nothing. */}
        <NavigationWatchdog />
        <NextIntlClientProvider>
          <SidebarProvider>
            <Header />
            {children}
          </SidebarProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
