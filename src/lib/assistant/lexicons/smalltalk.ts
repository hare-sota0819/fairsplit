/**
 * SMALL_TALK tokens — social acts the chat must answer IN KIND
 * (docs/PROMPT.md 2026-08-14, owner screenshot: "안녕" answered with the
 * confused-ack menu). Whole-input equality matching, same rule as
 * CONFIRM_TOKENS: a greeting INSIDE a task sentence ("안녕 커피 5000원")
 * must not swallow the task.
 */
export type SmallTalkAct = 'greeting' | 'thanks' | 'farewell'

export const SMALL_TALK_TOKENS: ReadonlyArray<{
  locale: 'ko' | 'en'
  token: string
  act: SmallTalkAct
}> = [
  // greetings
  { locale: 'ko', token: '안녕', act: 'greeting' },
  { locale: 'ko', token: '안녕하세요', act: 'greeting' },
  { locale: 'ko', token: '안녕하십니까', act: 'greeting' },
  { locale: 'ko', token: '안뇽', act: 'greeting' },
  { locale: 'ko', token: '하이', act: 'greeting' },
  { locale: 'ko', token: '헬로', act: 'greeting' },
  { locale: 'ko', token: 'ㅎㅇ', act: 'greeting' },
  { locale: 'ko', token: '셈아', act: 'greeting' },
  { locale: 'ko', token: '셈아 안녕', act: 'greeting' },
  { locale: 'en', token: 'hi', act: 'greeting' },
  { locale: 'en', token: 'hello', act: 'greeting' },
  { locale: 'en', token: 'hey', act: 'greeting' },
  { locale: 'en', token: 'yo', act: 'greeting' },
  // thanks
  { locale: 'ko', token: '고마워', act: 'thanks' },
  { locale: 'ko', token: '고맙습니다', act: 'thanks' },
  { locale: 'ko', token: '감사', act: 'thanks' },
  { locale: 'ko', token: '감사합니다', act: 'thanks' },
  { locale: 'ko', token: '땡큐', act: 'thanks' },
  { locale: 'ko', token: 'ㄳ', act: 'thanks' },
  { locale: 'ko', token: 'ㄱㅅ', act: 'thanks' },
  { locale: 'en', token: 'thanks', act: 'thanks' },
  { locale: 'en', token: 'thank you', act: 'thanks' },
  { locale: 'en', token: 'ty', act: 'thanks' },
  // farewell
  { locale: 'ko', token: '잘가', act: 'farewell' },
  { locale: 'ko', token: '잘자', act: 'farewell' },
  { locale: 'ko', token: '바이', act: 'farewell' },
  { locale: 'ko', token: '수고', act: 'farewell' },
  { locale: 'ko', token: '수고했어', act: 'farewell' },
  { locale: 'en', token: 'bye', act: 'farewell' },
  { locale: 'en', token: 'goodbye', act: 'farewell' },
  { locale: 'en', token: 'good night', act: 'farewell' },
]

/**
 * Topic words that mark an UNDER-SPECIFIED domain intent — the user
 * named the domain ("정산할래") without saying what they want done. The
 * guided reply must ENGAGE with the topic ("정산이요! 어떤 걸
 * 도와드릴까요?"), never open with the confused ack (owner screenshot,
 * same date). Substring match on the normalized input is correct here —
 * these mark the TOPIC of the reply, they don't claim the whole input.
 */
export const GUIDED_TOPICS: ReadonlyArray<{
  locale: 'ko' | 'en'
  pattern: string
  topic: 'settle'
}> = [
  { locale: 'ko', pattern: '정산', topic: 'settle' },
  { locale: 'ko', pattern: '얼마씩', topic: 'settle' },
  { locale: 'en', pattern: 'settle', topic: 'settle' },
  { locale: 'en', pattern: 'split the bill', topic: 'settle' },
]

/**
 * Social-act STEMS for the normalized matcher (2026-08-16, '안녕안녕' fix):
 * the input is stripped of punctuation/emoji/whitespace and of leading
 * vocatives/interjections (셈아/야/아/어), then a stem may repeat any
 * number of times, optionally followed by a polite/cute tail (하세요/
 * 하세욥/요/용/웡). Whole-input match on that normalized form — a greeting
 * FUSED to a task ('안녕 커피 5000원') never matches whole-input and the
 * task wins downstream. Longest stems listed first per act so 안녕하세요
 * consumes before 안녕.
 */
export const SMALL_TALK_STEMS: ReadonlyArray<{ stem: string; act: SmallTalkAct }> = [
  { stem: '안녕하십니까', act: 'greeting' },
  { stem: '안녕하세요', act: 'greeting' },
  { stem: '안녕', act: 'greeting' },
  { stem: '안뇽', act: 'greeting' },
  { stem: '헬로우', act: 'greeting' },
  { stem: '헬로', act: 'greeting' },
  { stem: '하이', act: 'greeting' },
  { stem: 'ㅎㅇ', act: 'greeting' },
  { stem: 'ㅎ2', act: 'greeting' },
  { stem: 'hello', act: 'greeting' },
  { stem: 'hey there', act: 'greeting' },
  { stem: 'hey', act: 'greeting' },
  { stem: 'hi', act: 'greeting' },
  { stem: 'yo', act: 'greeting' },
  { stem: '고맙습니다', act: 'thanks' },
  { stem: '감사합니다', act: 'thanks' },
  { stem: '고마워', act: 'thanks' },
  { stem: '고마웡', act: 'thanks' },
  { stem: '고맙다', act: 'thanks' },
  { stem: '감사', act: 'thanks' },
  { stem: '땡큐', act: 'thanks' },
  { stem: 'ㄳ', act: 'thanks' },
  { stem: 'ㄱㅅ', act: 'thanks' },
  { stem: 'thank you', act: 'thanks' },
  { stem: 'thanks', act: 'thanks' },
  { stem: 'ty', act: 'thanks' },
  { stem: '수고했어', act: 'farewell' },
  { stem: '수고', act: 'farewell' },
  { stem: '잘가', act: 'farewell' },
  { stem: '잘자', act: 'farewell' },
  { stem: '바이', act: 'farewell' },
  { stem: 'goodbye', act: 'farewell' },
  { stem: 'good night', act: 'farewell' },
  { stem: 'bye', act: 'farewell' },
]

/** Leading vocatives/interjections that decorate a social act. */
export const SMALL_TALK_LEADS = ['셈아', '셈', '야', '아', '어', '오'] as const
/** Trailing politeness/cuteness the stem may carry. */
export const SMALL_TALK_TAILS = ['하세욥', '하세요', '하세용', '요', '용', '욥', '웡', '~'] as const
