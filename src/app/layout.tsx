import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getTranslations } from 'next-intl/server'
import { Newsreader } from 'next/font/google'
import { Header } from '@/components/Header'
import { NavigationWatchdog } from '@/components/NavigationWatchdog'
import { ThemeScript } from '@/components/ThemeChoice'
import './globals.css'

/*
 * Statement type system (handoff SPEC.md §3):
 * - Newsreader = display + money figures ONLY (Latin subset; Hangul falls
 *   through to Pretendard via --font-heading's stack — Korean must never
 *   render in a serif).
 * - Pretendard Variable = all UI/body text, loaded as a CDN stylesheet
 *   below (it is not on Google Fonts; the variable woff2 is dynamically
 *   subset per script, so Hangul + ₩ always render).
 * Geist is retired; --font-mono now resolves to system mono in globals.
 */
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: ['400', '500'],
})

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('app')
  return {
    title: t('name'),
    description: t('tagline'),
  }
}

// Unchanged: standalone PWA display needs viewportFit for real
// safe-area-inset-* values (see git history for the full derivation).
export const viewport: Viewport = {
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${newsreader.variable} h-full antialiased`}>
      <head>
        <ThemeScript />
        <link
          rel="preconnect"
          href="https://cdn.jsdelivr.net"
          crossOrigin="anonymous"
        />
        {/* eslint-disable-next-line @next/next/no-css-tags -- third-party CDN stylesheet, not a local asset */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col pb-[env(safe-area-inset-bottom)]">
        <NavigationWatchdog />
        <NextIntlClientProvider>
          <Header />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
