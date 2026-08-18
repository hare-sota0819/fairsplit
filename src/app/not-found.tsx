import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'

/**
 * Also the landing spot for a group URL you are not a member of:
 * requireGroupMember calls notFound() from the group layout, and a layout's
 * notFound is caught one level up. Deliberately says nothing about whether
 * the group exists.
 */
export default async function NotFound() {
  const t = await getTranslations('errors.notFound')
  return (
    <main
      className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="not-found"
    >
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      <Link href="/groups" className={buttonVariants({ size: 'touch' })}>
        {t('back')}
      </Link>
    </main>
  )
}
