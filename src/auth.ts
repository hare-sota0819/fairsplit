import { PrismaAdapter } from '@auth/prisma-adapter'
import { verify } from 'argon2'
import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/locale'
import { reportAuthEnv } from '@/lib/auth-env'
import { stampEmailVerified } from '@/lib/auth-verified'
import { prisma } from '@/lib/prisma'

reportAuthEnv()

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  // JWT strategy is REQUIRED: the Credentials provider cannot create
  // database sessions (Auth.js constraint).
  session: { strategy: 'jwt' },
  // `newUser` is Auth.js's own first-login redirect: the OAuth callback
  // branch (`isNewUser && pages.newUser`) sends a brand-new Google account
  // here instead of `callbackUrl`, carrying that original destination as
  // `?callbackUrl=`. The Credentials branch hardcodes `isNewUser: false`, so
  // the existing `signUp` action's own `/guide?next=` redirect is untouched.
  pages: { signIn: '/signin', newUser: '/guide' },
  // Minified production builds mangle `error.name`; AuthError.type is a plain
  // string literal, so it is the only reliable label in Vercel Runtime Logs.
  logger: {
    error(error) {
      const err = error as Error & { type?: string; cause?: unknown }
      const cause =
        err.cause instanceof Error
          ? { name: err.cause.name, message: err.cause.message }
          : undefined
      console.error(
        JSON.stringify({
          tag: 'auth-error',
          type: err.type ?? err.name,
          message: err.message,
          cause,
        }),
      )
    },
  },
  providers: [
    // Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET from the environment.
    Google,
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        const email = credentials.email
        const password = credentials.password
        if (typeof email !== 'string' || typeof password !== 'string') {
          return null
        }
        const user = await prisma.user.findUnique({
          where: { email: email.trim().toLowerCase() },
        })
        if (!user?.passwordHash) return null
        const ok = await verify(user.passwordHash, password)
        if (!ok) return null
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        }
      },
    }),
  ],
  // The producer for `User.emailVerified` (DECISIONS D2-17). Nothing in this
  // app wrote the column before, which is why the dev role gate had to carry
  // an "… or a linked OAuth account" clause; it now tests the column alone
  // (src/app/dev/role-policy.ts) because this event keeps the column true.
  // The rule itself lives in `stampEmailVerified` so it is unit-tested with
  // no database; see there for why `signIn` and not `linkAccount`.
  events: {
    signIn: async ({ user, account }) => {
      await stampEmailVerified(prisma, { user, account })
    },
  },
  callbacks: {
    /**
     * The account's language rides in the token.
     *
     * `user` is only set on the sign-in pass, so the database is read once per
     * sign-in rather than once per request — which matters because
     * `src/i18n/request.ts` needs this on every single render. `trigger`
     * fires again when the account screen updates the session after the
     * language is changed, so the token does not go stale.
     */
    async jwt({ token, user, trigger, session }) {
      if (trigger === 'update' && isLocale(session?.locale)) {
        token.locale = session.locale
        return token
      }
      if (user?.id) {
        const record = await prisma.user.findUnique({
          where: { id: user.id },
          select: { locale: true },
        })
        token.locale = isLocale(record?.locale) ? record.locale : DEFAULT_LOCALE
      }
      return token
    },
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub
      }
      session.user.locale = isLocale(token.locale)
        ? token.locale
        : DEFAULT_LOCALE
      return session
    },
  },
})
