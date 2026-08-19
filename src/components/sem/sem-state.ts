/** Sem's choreography states (docs/BRAND.md v2 §4d). */
export const SEM_STATES = [
  'idle',
  'listening',
  'thinking',
  'speaking',
  'settled',
] as const

export type SemState = (typeof SEM_STATES)[number]
