'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Camera, ImageIcon, Plus, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { formatMinor, minorToDecimalInput, parseAmountToMinor } from '@/lib/format'
import { RECEIPT_PARSE_TIMEOUT_MS } from '@/lib/receipts/config'
import { checkTotal } from '@/lib/receipts/invariant'
import { resizeReceiptImage } from '@/lib/receipts/resize'
import { parsedReceiptSchema, type ParsedReceipt } from '@/lib/receipts/schema'
import { LedgerLeader } from '@/components/motion/rules'
import { NumberField, QtyStepper } from './NumberField'

/** One editable row on the confirm screen. Amounts are text, as typed. */
interface Row {
  key: number
  name: string
  unitAmount: string
  quantity: number
}

interface Draft {
  rows: Row[]
  nextKey: number
  total: string
  tax: string
  serviceCharge: string
  taxIncluded: boolean | null
}

type Phase =
  | { k: 'reading' }
  | { k: 'ready'; draft: Draft; imagePath: string | null }
  | { k: 'error'; code: string; limit?: number }

const ERROR_KEYS: Record<string, string> = {
  PARSE_FAILED: 'errorParse',
  TIMEOUT: 'errorTimeout',
  RATE_LIMITED: 'errorRateLimited',
  DAILY_LIMIT_REACHED: 'errorDailyLimit',
  IMAGE_TOO_LARGE: 'errorTooLarge',
  NOT_CONFIGURED: 'errorNotConfigured',
  OFFLINE: 'errorOffline',
}

function receiptToDraft(receipt: ParsedReceipt, currency: string): Draft {
  const rows = receipt.items.map((item, index) => {
    // Modifiers fold into the line before it is priced; a line whose folded
    // amount will not divide by its quantity collapses to a single unit so
    // the money stays exact (see src/lib/receipts/handoff.ts).
    const amount = item.amountMinor + item.modifiers.reduce((s, m) => s + m.amountMinor, 0)
    const divisible = item.quantity > 0 && amount % item.quantity === 0
    return {
      key: index,
      name: item.name,
      unitAmount: minorToDecimalInput(BigInt(divisible ? amount / item.quantity : amount), currency),
      quantity: divisible ? item.quantity : 1,
    }
  })
  return {
    rows,
    nextKey: rows.length,
    total: receipt.totalMinor === null ? '' : minorToDecimalInput(BigInt(receipt.totalMinor), currency),
    tax: receipt.taxMinor === null ? '' : minorToDecimalInput(BigInt(receipt.taxMinor), currency),
    serviceCharge:
      receipt.serviceChargeMinor === null
        ? ''
        : minorToDecimalInput(BigInt(receipt.serviceChargeMinor), currency),
    taxIncluded: receipt.taxIncludedInItems,
  }
}

/**
 * Rebuild a parsed receipt from what is currently in the fields, so the
 * total-match invariant runs against the EDITED numbers rather than the
 * originally parsed ones (brief §152 — the check runs live as the user types).
 */
function draftToReceipt(draft: Draft, currency: string): ParsedReceipt {
  const minor = (text: string): number | null => {
    const parsed = parseAmountToMinor(text, currency)
    return parsed === null ? null : Number(parsed)
  }
  return parsedReceiptSchema.parse({
    items: draft.rows.map((row) => {
      const unit = minor(row.unitAmount) ?? 0
      return {
        name: row.name,
        quantity: row.quantity,
        unitPriceMinor: unit,
        amountMinor: unit * row.quantity,
        modifiers: [],
      }
    }),
    taxMinor: minor(draft.tax),
    serviceChargeMinor: minor(draft.serviceCharge),
    totalMinor: minor(draft.total),
    taxIncludedInItems: draft.taxIncluded,
    currency,
  })
}

/**
 * Photograph a receipt, check what came back, hand the lines to the wizard.
 *
 * The confirm screen is mandatory and there is no auto-save path (brief §148):
 * nothing reaches the expense until someone has looked at the numbers and the
 * total-match invariant is satisfied.
 */
export function ReceiptScan({
  groupId,
  currency,
  startKey,
  onConfirm,
  onManualEntry,
}: {
  groupId: string
  currency: string
  startKey: number
  /** Hand the confirmed rows to the wizard and advance to assignment. */
  onConfirm: (result: {
    rows: Array<{ key: number; name: string; unitAmount: string; quantity: number }>
    nextKey: number
    amount: string
    imagePath: string | null
  }) => void
  /** Fall back to typing, keeping whatever was photographed. */
  onManualEntry: (imagePath: string | null) => void
}) {
  const t = useTranslations('expenses.scan')
  const tf = useTranslations('expenses.form')
  const fileRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const lastImagePath = useRef<string | null>(null)

  // An object URL per scan; revoked when it is replaced or the screen closes.
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
    }
  }, [photoUrl])

  const startScan = useCallback(
    async (file: File) => {
      setPhase({ k: 'reading' })
      // Shown from the ORIGINAL file straight away, before the resize has even
      // run: the brief wants the photo on screen the moment the reading state
      // appears (§137), and decoding + canvas re-encoding takes long enough
      // that waiting for it leaves a blank screen for the first frames.
      setPhotoUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return URL.createObjectURL(file)
      })

      let resized
      try {
        resized = await resizeReceiptImage(file)
      } catch {
        setPhase({ k: 'error', code: 'PARSE_FAILED' })
        return
      }
      // Swap to the resized bytes — the same picture, a fraction of the
      // memory, and exactly what was uploaded.
      setPhotoUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return URL.createObjectURL(resized.blob)
      })

      const form = new FormData()
      form.set('groupId', groupId)
      form.set('image', resized.blob, 'receipt.jpg')

      // Hard client timeout (brief §161). AbortController rather than a race,
      // so the request is actually cancelled and stops costing anything.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), RECEIPT_PARSE_TIMEOUT_MS)
      try {
        const response = await fetch('/api/receipts/parse', {
          method: 'POST',
          body: form,
          signal: controller.signal,
        })
        const json = await response.json()
        if (!response.ok || !json.ok) {
          // The server uploads the photo even when the parse fails, so the
          // manual-entry exit can still attach it (brief §163).
          lastImagePath.current = json?.imagePath ?? null
          setPhase({ k: 'error', code: json?.error ?? 'PARSE_FAILED', limit: json?.limit })
          return
        }
        lastImagePath.current = json.imagePath ?? null
        setPhase({
          k: 'ready',
          imagePath: json.imagePath ?? null,
          draft: receiptToDraft(parsedReceiptSchema.parse(json.receipt), currency),
        })
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        setPhase({ k: 'error', code: aborted ? 'TIMEOUT' : 'OFFLINE' })
      } finally {
        clearTimeout(timer)
      }
    },
    [groupId, currency],
  )

  const draft = phase?.k === 'ready' ? phase.draft : null
  const imagePath = phase?.k === 'ready' ? phase.imagePath : null
  const patchDraft = (change: Partial<Draft>) =>
    setPhase((current) =>
      current?.k === 'ready' ? { ...current, draft: { ...current.draft, ...change } } : current,
    )

  const check = useMemo(
    () => (draft ? checkTotal(draftToReceipt(draft, currency)) : null),
    [draft, currency],
  )

  const close = () => {
    setPhase(null)
    setPhotoOpen(false)
  }

  if (!phase) {
    return (
      <>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          data-testid="scan-receipt-input"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so picking the same photo twice still fires a change.
            event.target.value = ''
            if (file) void startScan(file)
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="touch"
          className="h-auto flex-col gap-1 py-3"
          data-testid="scan-receipt"
          onClick={() => fileRef.current?.click()}
        >
          <span className="flex items-center gap-2 font-medium">
            <Camera aria-hidden="true" className="size-4" />
            {tf('scanReceipt')}
          </span>
        </Button>
      </>
    )
  }

  return (
    <div
      // z-50: sits above everything else this screen can show. (The app's
      // former fixed bottom Tabs bar, z-40, is what this comment used to be
      // about — that bar is gone as of Task 6, but z-50 is still the right
      // value: nothing else on this route is fixed higher.)
      //
      // `inset-0` runs this screen edge-to-edge, so with `viewportFit:
      // 'cover'` (root layout) the header below sits under the status
      // bar/notch and `pb-16` at the bottom sits over the home indicator
      // unless both account for the device inset — same reasoning as the
      // sidebar drawer (Sidebar.tsx).
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background pb-[calc(4rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]"
      data-testid="receipt-confirm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Button type="button" variant="ghost" size="sm" onClick={close} data-testid="scan-discard">
          {t('cancel')}
        </Button>
      </header>

      <div className="flex flex-col gap-4 px-5 py-4">
        {/* The photo is present from the first moment, so the screen is never
            receipt-less content (brief §137, §146). */}
        {photoUrl ? (
          <button
            type="button"
            onClick={() => setPhotoOpen(true)}
            className="flex items-center gap-3 self-start rounded-lg border border-border p-2 text-left"
            data-testid="scan-thumbnail"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL from the camera, not an optimisable asset */}
            <img
              src={photoUrl}
              alt={t('photoAlt')}
              className={`h-20 w-16 rounded object-cover ${phase.k === 'reading' ? 'opacity-40' : ''}`}
            />
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <ImageIcon aria-hidden="true" className="size-3.5" />
              {t('viewPhoto')}
            </span>
          </button>
        ) : null}

        {phase.k === 'reading' ? (
          <div className="flex flex-col gap-3" data-testid="scan-reading" aria-live="polite">
            {/* SPEC-LOADERS: reading a receipt has no honest percentage to
                report, so it gets the contextual ledger — dotted leaders
                flowing, closed by the double rule — not a spinner. */}
            <LedgerLeader className="text-primary" />
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{t('reading')}</span>
              <span className="text-xs text-muted-foreground">{t('readingHint')}</span>
            </div>
          </div>
        ) : null}

        {phase.k === 'error' ? (
          <div className="flex flex-col gap-3" data-testid="scan-error" role="alert">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold">{t('errorTitle')}</span>
              <span className="text-sm text-muted-foreground">
                {t(ERROR_KEYS[phase.code] ?? 'errorParse', { limit: phase.limit ?? 0 })}
              </span>
              <span className="text-xs text-muted-foreground">{t('keepPhotoNote')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                size="touch"
                onClick={() => {
                  onManualEntry(lastImagePath.current)
                  // Closing here, not in the caller: leaving the overlay up
                  // after the user chose to type it in is the exact trap the
                  // brief forbids (§165).
                  close()
                }}
                data-testid="scan-manual-entry"
              >
                {t('manualEntry')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="touch"
                onClick={() => fileRef.current?.click()}
                data-testid="scan-retry"
              >
                {t('retry')}
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void startScan(file)
              }}
            />
          </div>
        ) : null}

        {draft && check ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t('itemsHeading')}</h3>
              <Badge variant="secondary" data-testid="scan-item-count">
                {draft.rows.length}
              </Badge>
            </div>

            <ul className="flex flex-col gap-3">
              {draft.rows.map((row) => {
                const unit = parseAmountToMinor(row.unitAmount, currency)
                return (
                  <li key={row.key} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        value={row.name}
                        aria-label={t('name')}
                        data-testid="scan-item-name"
                        onChange={(e) =>
                          patchDraft({
                            rows: draft.rows.map((r) =>
                              r.key === row.key ? { ...r, name: e.target.value } : r,
                            ),
                          })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('removeItem')}
                        data-testid="scan-item-remove"
                        onClick={() =>
                          patchDraft({ rows: draft.rows.filter((r) => r.key !== row.key) })
                        }
                      >
                        <X aria-hidden="true" className="size-4" />
                      </Button>
                    </div>
                    <div className="flex items-end gap-3">
                      <NumberField
                        label={t('unitPrice', { currency })}
                        value={row.unitAmount}
                        unit={currency}
                        testId="scan-item-price"
                        className="flex-1"
                        result={
                          unit === null
                            ? null
                            : formatMinor(unit * BigInt(row.quantity), currency)
                        }
                        onChange={(value) =>
                          patchDraft({
                            rows: draft.rows.map((r) =>
                              r.key === row.key ? { ...r, unitAmount: value } : r,
                            ),
                          })
                        }
                      />
                      <QtyStepper
                        value={row.quantity}
                        ariaLabel={t('qty')}
                        testId="scan-item-qty"
                        onChange={(value) =>
                          patchDraft({
                            rows: draft.rows.map((r) =>
                              r.key === row.key ? { ...r, quantity: value } : r,
                            ),
                          })
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>

            <Button
              type="button"
              variant="outline"
              size="touch"
              data-testid="scan-add-item"
              onClick={() =>
                patchDraft({
                  rows: [
                    ...draft.rows,
                    { key: draft.nextKey, name: '', unitAmount: '', quantity: 1 },
                  ],
                  nextKey: draft.nextKey + 1,
                })
              }
            >
              <Plus aria-hidden="true" className="size-4" />
              {t('addItem')}
            </Button>

            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <NumberField
                label={t('total', { currency })}
                value={draft.total}
                unit={currency}
                testId="scan-total"
                onChange={(value) => patchDraft({ total: value })}
              />
              <NumberField
                label={t('tax', { currency })}
                value={draft.tax}
                unit={currency}
                testId="scan-tax"
                onChange={(value) => patchDraft({ tax: value })}
              />
              <NumberField
                label={t('serviceCharge', { currency })}
                value={draft.serviceCharge}
                unit={currency}
                testId="scan-service"
                onChange={(value) => patchDraft({ serviceCharge: value })}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.taxIncluded !== false}
                  data-testid="scan-tax-included"
                  onChange={(e) => patchDraft({ taxIncluded: e.target.checked })}
                />
                {t('taxIncluded')}
              </label>
            </div>

            {/* The invariant, live. Blocking is the point: a wrong amount that
                saves quietly poisons settlement downstream (brief §126). */}
            <div
              className={`rounded-lg border p-3 text-sm ${
                check.canSave
                  ? 'border-border text-muted-foreground'
                  : 'border-destructive bg-destructive/5 text-destructive'
              }`}
              data-testid="scan-check"
              data-status={check.status}
              aria-live="polite"
            >
              {check.status === 'MATCH' ? (
                t('matchOk')
              ) : (
                <div className="flex flex-col gap-2">
                  <span className="font-medium">
                    {check.status === 'NO_TOTAL' ? t('matchNoTotal') : t('matchOff')}
                  </span>
                  {check.status === 'MISMATCH' ? (
                    <span data-testid="scan-check-detail">
                      {t('matchDetail', {
                        computed: formatMinor(BigInt(check.computedTotal), currency),
                        read: formatMinor(BigInt(check.readTotal ?? 0), currency),
                        difference: formatMinor(BigInt(check.difference ?? 0), currency),
                      })}
                    </span>
                  ) : null}
                  <span>{t('matchFix')}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    data-testid="scan-use-item-sum"
                    onClick={() =>
                      patchDraft({
                        total: minorToDecimalInput(BigInt(check.computedTotal), currency),
                      })
                    }
                  >
                    {t('useItemSum')}
                  </Button>
                </div>
              )}
            </div>

            <Button
              type="button"
              size="touch"
              disabled={!check.canSave}
              data-testid="scan-confirm"
              onClick={() => {
                const rows = draft.rows.map((row, index) => ({
                  key: startKey + index,
                  name: row.name,
                  unitAmount: row.unitAmount,
                  quantity: row.quantity,
                }))
                onConfirm({
                  rows,
                  nextKey: startKey + rows.length,
                  amount: minorToDecimalInput(BigInt(check.computedTotal), currency),
                  imagePath,
                })
                close()
              }}
            >
              {check.canSave ? t('confirm') : t('blocked')}
            </Button>
          </>
        ) : null}
      </div>

      {photoUrl ? (
        <Dialog
          open={photoOpen}
          onOpenChange={setPhotoOpen}
          title={t('photoAlt')}
          closeLabel={t('closePhoto')}
          testId="scan-photo-dialog"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- blob: URL */}
          <img src={photoUrl} alt={t('photoAlt')} className="w-full rounded-lg" />
        </Dialog>
      ) : null}
    </div>
  )
}
