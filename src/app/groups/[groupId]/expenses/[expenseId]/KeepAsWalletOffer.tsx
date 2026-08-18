'use client'

import { useTranslations } from 'next-intl'
import { useActionState, useState } from 'react'
import { createWalletForCurrency, type KeepAsWalletState } from './actions'
import { SubmitButton } from '@/components/SubmitButton'
import { Button } from '@/components/ui/button'

/**
 * Post-save nudge: "keep this currency as a wallet?" — offered once, right
 * after saving an expense that used the payer's own (unlogged) rate. Purely
 * an offer: dismissing is local state only, nothing is created until the
 * member presses Create.
 */
export function KeepAsWalletOffer({
  groupId,
  currency,
}: {
  groupId: string
  currency: string
}) {
  const t = useTranslations('expenses.detail.keepAsWallet')
  const [dismissed, setDismissed] = useState(false)
  const [state, formAction] = useActionState<KeepAsWalletState, FormData>(
    createWalletForCurrency,
    {},
  )

  if (dismissed || state.created) {
    return null
  }

  return (
    <div
      className="rounded-xl bg-card p-4 text-sm shadow-sm"
      data-testid="keep-as-wallet"
    >
      <p>{t('question', { currency })}</p>
      <div className="mt-2 flex items-center gap-3">
        <form action={formAction}>
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="currency" value={currency} />
          <SubmitButton size="sm" testId="keep-as-wallet-create">
            {t('create')}
          </SubmitButton>
        </form>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setDismissed(true)}
          data-testid="keep-as-wallet-dismiss"
        >
          {t('dismiss')}
        </Button>
      </div>
    </div>
  )
}
