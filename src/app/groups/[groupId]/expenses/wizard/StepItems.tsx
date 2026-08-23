'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, X } from 'lucide-react'
import { formatMinor, parseAmountToMinor } from '@/lib/format'
import { lineTotal } from '@/lib/settlement'
import { Odometer } from '@/components/motion/Odometer'
import { NumberField, QtyStepper } from './NumberField'
import { ReceiptScan } from './ReceiptScan'
import type { ItemState } from './math'
import type { StepProps } from './StepProps'

/**
 * Step 3 — the receipt lines.
 *
 * Fields are Name / Unit price / Qty, and the line total is shown as it is
 * typed. Both details matter: the old form called the price field "Amount"
 * and then ignored the quantity in every sum, so "1,500 x 3" quietly meant
 * 1,500 and the receipt check reported a difference that was not there.
 *
 * Removing a line is undoable rather than confirmed — a confirm on every
 * mis-tap while typing a receipt would be worse than the mistake.
 */
/** Index of the assignment step in STEP_KEYS (amount, payment, items, assign, review). */
const ASSIGN_STEP = 3

export function StepItems({ groupId, state, patch, math }: StepProps) {
  const t = useTranslations('expenses.form')
  const [removed, setRemoved] = useState<{
    item: ItemState
    index: number
  } | null>(null)

  const patchItem = (key: number, change: Partial<ItemState>) =>
    patch({
      items: state.items.map((item) =>
        item.key === key ? { ...item, ...change } : item,
      ),
    })

  const addItem = () => {
    patch({
      items: [
        ...state.items,
        {
          key: state.nextKey,
          name: '',
          unitAmount: '',
          quantity: 1,
          splitMode: 'BY_QUANTITY',
          assignees: [],
        },
      ],
      nextKey: state.nextKey + 1,
    })
    setRemoved(null)
  }

  const removeItem = (key: number) => {
    const index = state.items.findIndex((item) => item.key === key)
    if (index < 0) return
    setRemoved({ item: state.items[index], index })
    patch({ items: state.items.filter((item) => item.key !== key) })
  }

  const undoRemove = () => {
    if (!removed) return
    const restored = [...state.items]
    restored.splice(removed.index, 0, removed.item)
    patch({ items: restored })
    setRemoved(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="touch"
          onClick={addItem}
          className="h-auto flex-col gap-1 py-3"
          data-testid="enter-manually"
        >
          <span className="flex items-center gap-2 font-medium">
            <Plus aria-hidden="true" className="size-4" />
            {t('enterManually')}
          </span>
        </Button>
        <ReceiptScan
          groupId={groupId}
          currency={state.currency}
          startKey={state.nextKey}
          onConfirm={({ rows, nextKey, amount, imagePath }) =>
            // Straight to assignment (brief §156): the lines are known, who
            // had what is not, and that screen already exists.
            patch({
              items: rows.map((row) => ({ ...row, splitMode: 'BY_QUANTITY', assignees: [] })),
              nextKey,
              amount,
              receiptImagePath: imagePath,
              step: ASSIGN_STEP,
              maxStep: Math.max(state.maxStep, ASSIGN_STEP),
            })
          }
          onManualEntry={(imagePath) => {
            // The photo still attaches even though parsing failed (brief §163).
            patch({ receiptImagePath: imagePath })
            addItem()
          }}
        />
      </div>

      {state.items.length === 0 ? (
        <p
          className="px-5 py-10 text-center text-sm text-muted-foreground"
          data-testid="items-optional"
        >
          {t('itemsOptional')}
        </p>
      ) : null}

      <ul className="-mx-5 divide-y divide-border">
        {state.items.map((item) => {
          const unit = parseAmountToMinor(item.unitAmount, state.currency)
          const total =
            unit === null
              ? null
              : lineTotal({ unitAmount: unit, quantity: item.quantity })
          return (
            <li
              key={item.key}
              className="min-h-14 px-5 py-3"
              data-testid="item-row"
            >
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t('itemName')}
                  aria-label={t('itemName')}
                  value={item.name}
                  onChange={(e) =>
                    patchItem(item.key, { name: e.target.value })
                  }
                  className="h-11 min-w-0 flex-1"
                  data-testid="item-name"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-lg"
                  aria-label={t('removeItem')}
                  onClick={() => removeItem(item.key)}
                  data-testid="remove-item"
                >
                  <X />
                </Button>
              </div>
              <div className="mt-2 flex items-end gap-3">
                <NumberField
                  label={t('itemUnitPrice')}
                  value={item.unitAmount}
                  onChange={(unitAmount) => patchItem(item.key, { unitAmount })}
                  unit={state.currency}
                  className="min-w-0 flex-1"
                  inputClassName="h-11"
                  testId="item-unit-price"
                />
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t('itemQty')}</span>
                  <QtyStepper
                    value={item.quantity}
                    onChange={(quantity) =>
                      patchItem(item.key, {
                        quantity,
                        // Nobody can have taken more units than exist.
                        assignees: item.assignees.map((a) => ({
                          ...a,
                          quantity: Math.min(a.quantity, quantity),
                        })),
                      })
                    }
                    ariaLabel={t('itemQty')}
                    testId="item-qty"
                  />
                </div>
              </div>
              {/* §8 — the computed total rolls per digit column rather than
                  swapping: the line reads as a till adding up, and the
                  static glyphs are height-matched to the strips so nothing
                  shifts off the baseline.
                  A rolling column IS ten digits of real text, so the figure
                  is drawn aria-hidden and the sentence is stated once, in
                  full, for anything that reads rather than looks — screen
                  readers and the e2e suite alike. */}
              {total === null ? null : (
                <p className="mt-2 text-sm font-medium tabular-nums">
                  <span className="sr-only" data-testid="line-math">
                    {t.rich('lineMath', {
                      unit: formatMinor(unit!, state.currency),
                      qty: item.quantity,
                      total: () => formatMinor(total, state.currency),
                    })}
                  </span>
                  <span aria-hidden="true">
                    {t.rich('lineMath', {
                      unit: formatMinor(unit!, state.currency),
                      qty: item.quantity,
                      total: () => (
                        <Odometer value={formatMinor(total, state.currency)} />
                      ),
                    })}
                  </span>
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {removed ? (
        <div
          className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm"
          role="status"
          data-testid="item-removed"
        >
          <span>{t('itemRemoved', { name: removed.item.name || '—' })}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={undoRemove}
          >
            {t('undo')}
          </Button>
        </div>
      ) : null}

      {state.items.length > 0 ? (
        <>
          {/* What is still unaccounted for, live, right where the last price
              was typed and directly above "add another".
              This is the whole point of entering items by hand: with a
              ¥1,500 bill between two people, typing your own ¥780 drink
              leaves ¥720 on screen — which IS your friend's drink. Nobody
              has to read the receipt, and nobody has to do the subtraction.
              The review step has always known this number; it was just
              shown two screens too late to help anyone type. */}
          {math.remaining !== null ? (
            <p
              className={`text-sm font-medium tabular-nums ${
                math.remaining < 0n ? 'text-notice' : 'text-muted-foreground'
              }`}
              role="status"
              data-testid="items-remaining"
            >
              {math.remaining === 0n
                ? t('itemsExact')
                : math.remaining > 0n
                  ? t('itemsLeft', {
                      amount: formatMinor(math.remaining, state.currency),
                    })
                  : t('itemsOver', {
                      amount: formatMinor(-math.remaining, state.currency),
                    })}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="touch"
            onClick={addItem}
            className="w-full justify-center gap-2"
            data-testid="add-item"
          >
            <Plus aria-hidden="true" className="size-4" />
            {t('addItem')}
          </Button>
          <p className="flex justify-between text-sm font-medium tabular-nums">
            <span>{t('itemsTotal')}</span>
            <span data-testid="items-total">
              {math.itemsSum === null
                ? '—'
                : formatMinor(math.itemsSum, state.currency)}
            </span>
          </p>
        </>
      ) : null}
    </div>
  )
}
