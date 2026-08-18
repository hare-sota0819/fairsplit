export interface ParseHit<T extends string, V> {
  type: T
  start: number
  end: number
  value: V
  /** 0..1; refiners drop lower-confidence overlaps. */
  confidence: number
}
