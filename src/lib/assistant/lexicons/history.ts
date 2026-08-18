/**
 * QUERY_HISTORY vocabulary — "show me the record" questions (사용내역 /
 * 내역 / 기록 / history), owner screenshot 2026-08-14: all of these fell
 * to the confused-ack menu because no intent covered "list the recent
 * expenses" at all.
 *
 * Two-part recognition, evaluated in classify.ts's tryQuery:
 *  - a HISTORY_NOUN plus a HISTORY_SHOW_VERB anywhere ("내 사용내역 좀
 *    보여줘"), OR
 *  - the input IS essentially the bare noun ("사용내역", "내 기록") —
 *    checked by stripping the noun, first-person words and particles and
 *    requiring (almost) nothing left, so "여행 기록 남기고 싶다" never
 *    fires.
 *
 * 기록 doubles as the VERB "to record" (기록해줘) — the caller must
 * reject a 기록 immediately followed by 하/해/했/중. The global
 * no-literal-amount gate at the top of tryQuery already keeps "커피
 * 5000원 기록해줘" out of the query ladder entirely.
 */
export const HISTORY_NOUNS: ReadonlyArray<{ locale: 'ko' | 'en'; marker: string }> = [
  { locale: 'ko', marker: '사용내역' },
  { locale: 'ko', marker: '사용 내역' },
  { locale: 'ko', marker: '지출내역' },
  { locale: 'ko', marker: '지출 내역' },
  { locale: 'ko', marker: '내역' },
  { locale: 'ko', marker: '기록' },
  { locale: 'ko', marker: '히스토리' },
  { locale: 'ko', marker: '지출 목록' },
  { locale: 'ko', marker: '지출목록' },
  { locale: 'en', marker: 'history' },
  { locale: 'en', marker: 'transactions' },
  { locale: 'en', marker: 'recent expenses' },
]

export const HISTORY_SHOW_VERBS: ReadonlyArray<{ locale: 'ko' | 'en'; marker: string }> = [
  { locale: 'ko', marker: '보여' },
  { locale: 'ko', marker: '볼래' },
  { locale: 'ko', marker: '보자' },
  { locale: 'ko', marker: '알려' },
  { locale: 'ko', marker: '뽑아' },
  { locale: 'ko', marker: '정리해' },
  { locale: 'ko', marker: '궁금' },
  { locale: 'en', marker: 'show' },
  { locale: 'en', marker: 'see' },
  { locale: 'en', marker: 'list' },
  { locale: 'en', marker: "what's" },
  { locale: 'en', marker: 'what is' },
]
