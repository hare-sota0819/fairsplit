'use client'

import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'
import { NavLink } from './NavLoader'
import { Badge } from './ui/badge'
import { Card, CardContent } from './ui/card'
import { Money } from './Money'
import type { WalletType } from '@/lib/settlement'

export interface WalletCardView {
  id: string
  label: string
  type: WalletType
  currency: string
  loaded: string
  spent: string
  adjustments: string
  /** Always positive; `overdrawn` decides which template wraps it. */
  remainingAmount: string
  overdrawn: boolean
}

/**
 * Home-top wallet: one expandable row per WALLET (Phase 4A — a member can
 * hold several, including two of the same currency), with the breakdown of
 * where the balance came from.
 *
 * READ-ONLY BY DESIGN. It used to carry the "count this wallet" form, open
 * and pre-filled with the balance the card had just stated — an input whose
 * answer was already written in it, on a screen that never said what it was
 * for. Correcting a wallet is wallet admin and now lives with the top-ups,
 * on the wallets screen this links to.
 */
export function WalletCard({
  exchangeHref,
  wallets,
}: {
  exchangeHref: string
  wallets: WalletCardView[]
}) {
  const t = useTranslations('wallet')
  const tLoading = useTranslations('loading')
  return (
    <div className="flex flex-col gap-2" data-testid="cash-slot">
      {wallets.map((wallet) => (
        <Card key={wallet.id} data-testid="wallet-card">
          <CardContent>
            <details className="group">
              <summary
                className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 transition-colors hover:text-primary"
                data-testid={`wallet-remaining-${wallet.id}`}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="secondary">
                      {t(`type.${wallet.type}`)}
                    </Badge>
                    {wallet.label}
                  </span>
                  <Money size="lg">
                    {wallet.overdrawn
                      ? t('overdrawn', { amount: wallet.remainingAmount })
                      : t('remaining', { amount: wallet.remainingAmount })}
                  </Money>
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                />
              </summary>
              <div className="mt-4 flex flex-col gap-3 text-sm">
                <dl className="grid grid-cols-2 gap-y-1.5 text-muted-foreground [&_dd]:tabular-nums">
                  <dt>{t('loadedTotal')}</dt>
                  <dd className="text-right">{wallet.loaded}</dd>
                  <dt>{t('spentTotal')}</dt>
                  <dd className="text-right">{wallet.spent}</dd>
                  <dt>{t('adjustments')}</dt>
                  <dd className="text-right">{wallet.adjustments}</dd>
                </dl>
                <p className="text-xs text-muted-foreground">{t('basedOn')}</p>
                {/* An overdrawn wallet used to offer only an adjustment. Now
                    that a receipt can name several sources, the likelier
                    cause is an expense recorded as if all of it came off this
                    wallet — and that is fixed on the expense, not here. */}
                {wallet.overdrawn ? (
                  <p
                    className="text-xs text-notice"
                    data-testid="wallet-overdrawn-hint"
                  >
                    {t('overdrawnHint')}
                  </p>
                ) : null}
                <NavLink
                  href={exchangeHref}
                  caption={tLoading('exchange')}
                  className="w-fit text-xs font-medium text-primary underline"
                >
                  {t('manage')}
                </NavLink>
              </div>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
