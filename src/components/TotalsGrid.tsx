import { HandCoins, ShoppingBag } from 'lucide-react'
import { TotalCard } from '@/components/TotalCard'
import type { TotalCardData } from '@/lib/total-cards'

/**
 * The two headline totals ("you fronted" / "your share"), laid out as a grid
 * so both cards match height whatever a translation does to the label
 * lengths. Shared by home and status — `total-cards.ts` builds the props,
 * this renders them — so the two screens can never drift on markup.
 */
export function TotalsGrid({
  fronted,
  consumed,
}: {
  fronted: TotalCardData
  consumed: TotalCardData
}) {
  return (
    <div className="grid grid-cols-2 items-stretch gap-3">
      <TotalCard
        testId="total-fronted"
        icon={<HandCoins className="size-4" />}
        {...fronted}
      />
      <TotalCard
        testId="total-consumed"
        icon={<ShoppingBag className="size-4" />}
        {...consumed}
      />
    </div>
  )
}
