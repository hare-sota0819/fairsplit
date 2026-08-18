import type { ExpenseFormData } from '../form-props'
import type { ExpenseMath, MarketQuote, WizardState } from './math'

export interface StepProps {
  groupId: string
  /** Set when editing; the currency is then locked to the stored snapshot. */
  expenseId?: string
  state: WizardState
  patch: (patch: Partial<WizardState>) => void
  data: ExpenseFormData
  math: ExpenseMath
  market: MarketQuote | null
  marketLoading: boolean
  /** Save the in-progress expense before navigating away from the form. */
  parkDraft: () => void
}

/** Fill "{name} owes" style placeholders in a pre-templated string. */
export const fill = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
