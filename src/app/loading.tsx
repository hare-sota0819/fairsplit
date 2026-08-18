import { getTranslations } from 'next-intl/server'
import { RouteLoader } from '@/components/loaders'

export default async function RootLoading() {
  const t = await getTranslations('loading')
  return <RouteLoader caption={t('general')} />
}
