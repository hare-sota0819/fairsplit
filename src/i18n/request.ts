import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { auth } from '@/auth'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  localeFromAcceptLanguage,
} from './locale'

export default getRequestConfig(async () => {
  // 1. An explicit choice on this device. The cookie is never the OS
  //    language — it is only ever written by the account screen or seeded
  //    from the account itself — so letting it win first is safe, and it is
  //    what makes switching take effect on the very next render instead of
  //    waiting for the token to be reissued.
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (isLocale(stored)) {
    return {
      locale: stored,
      messages: (await import(`../messages/${stored}.json`)).default,
    }
  }

  // 2. No cookie means a device this account has not been used on yet, so the
  //    account decides. A JWT decode, not a query: the locale goes into the
  //    token at sign-in.
  const session = await auth()
  const account = session?.user?.locale

  // 3. Only a browser with no cookie and nobody signed in reaches the header,
  //    which is why three devices with three OS languages cannot pull one
  //    person's app in three directions.
  const locale = isLocale(account)
    ? account
    : (localeFromAcceptLanguage((await headers()).get('accept-language')) ??
      DEFAULT_LOCALE)

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
