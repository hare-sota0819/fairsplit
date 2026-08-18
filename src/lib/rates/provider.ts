/** A rate together with the date it is actually FOR. */
export interface RateQuote {
  /**
   * Storage form: settlement MAJOR units per 1 foreign MAJOR unit, as an
   * exact decimal string (never a float).
   */
  rate: string
  /**
   * The publication date the provider answered with (YYYY-MM-DD). This is
   * NOT always the date we asked for: a daily-fixing source such as the ECB
   * answers a weekend or holiday request with the previous business day. The
   * UI must say so rather than imply the rate is live.
   */
  asOf: string
  /**
   * The source's own timestamp, at whatever precision it publishes, as an
   * ISO 8601 instant (`2026-08-03T03:03:00.000Z`).
   *
   * ADDITIVE interface change, Phase 4D-A. `asOf` alone was enough while
   * every source published once a day; the live primary restamps every
   * minute, and a date throws that away — after a cache hit there would be
   * no way to tell whether a rate is a minute or twenty hours old. Optional
   * because a daily source genuinely has nothing finer to report:
   * Frankfurter leaves it undefined and every consumer treats that as "date
   * precision only".
   */
  asOfInstant?: string
}

export interface RateProvider {
  /** The rate for a specific date (may answer with an earlier business day). */
  getRate(date: string, base: string, quote: string): Promise<RateQuote | null>
  /** The most recent published rate, whatever date that is. */
  getLatest(base: string, quote: string): Promise<RateQuote | null>
}
