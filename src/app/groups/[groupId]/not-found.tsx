import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'

/**
 * Unknown expense id and friends: the group layout still renders, so the
 * sidebar stays put and this only has to explain itself.
 */
export default async function GroupNotFound() {
  const t = await getTranslations('errors.notFound')
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="not-found"
    >
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('groupBody')}</p>
      <Link href="/groups" className={buttonVariants({ size: 'touch' })}>
        {t('back')}
      </Link>
    </main>
  )
}
