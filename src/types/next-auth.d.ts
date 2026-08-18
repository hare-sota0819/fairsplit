import type { DefaultSession } from 'next-auth'
import type { Locale } from '@/i18n/locale'

declare module 'next-auth' {
  interface Session {
    user: { id: string; locale: Locale } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    /**
     * The account's language, read from the database once at sign-in and
     * carried in the token afterwards, so resolving the locale on every
     * request costs a JWT decode rather than a query.
     */
    locale?: Locale
  }
}
