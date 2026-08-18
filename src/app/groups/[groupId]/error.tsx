'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'

export default function GroupError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.unexpected')
  return (
    <main
      className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center"
      data-testid="error-boundary"
    >
      <h1 className="text-xl font-bold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="touch" onClick={reset}>
          {t('retry')}
        </Button>
        <Link
          href="/groups"
          className={buttonVariants({ variant: 'outline', size: 'touch' })}
        >
          {t('back')}
        </Link>
      </div>
    </main>
  )
}
