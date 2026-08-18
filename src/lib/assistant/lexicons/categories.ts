/**
 * Category-synonym groups for context-command reference matching.
 *
 * A user who says "아까 그 술값에 민수도 껴줘" is pointing at an expense whose
 * note says 이자카야, not 술값 — the reference keyword and the saved note are
 * two different words for the same THING. This table is the only place that
 * equivalence is written down.
 *
 * Shape rules (both locales in ONE table, deliberately):
 *  - A group is a flat list of surfaces that name the same category. Order
 *    inside a group carries no meaning.
 *  - Korean surfaces are matched as SUBSTRINGS of a note (Hangul has no word
 *    boundary), so every Korean entry has to be specific enough that a hit
 *    inside an unrelated word is not a realistic concern — the same judgement
 *    `SPLIT_ENTRIES_KO` documents. Latin surfaces are matched with a WORD
 *    boundary instead (`bar` would otherwise fire inside `barbecue`), which is
 *    why short, collision-prone English words like `bar` are absent and `pub`
 *    carries the same group instead.
 *  - Keyword → group lookup is prefix-based, not substring-based
 *    (`context-commands.ts`'s `expandKeyword`): Korean compounds put the
 *    category FIRST (술값 = 술 + 값, 택시비 = 택시 + 비), so `술값`.startsWith(`술`)
 *    finds the group while `기술` — which merely CONTAINS 술 — does not.
 *
 * This is a curated table, not a mined one: the categories a shared-expense
 * chat actually uses are a small, product-shaped set, and a general thesaurus
 * would pull in senses ("바" as a counter, "회" as a meeting) that make
 * matching worse, not better. Unknown keyword → no group → the keyword alone
 * is matched, which resolves to 'none' and makes the UI ask (the house rule:
 * never a confidently wrong edit).
 */
export const CATEGORY_SYNONYMS: ReadonlyArray<readonly string[]> = [
  [
    '술',
    '맥주',
    '소주',
    '막걸리',
    '와인',
    '하이볼',
    '이자카야',
    '호프',
    '포차',
    '술집',
    '회식',
    'drinks',
    'drink',
    'beer',
    'soju',
    'wine',
    'pub',
    'izakaya',
    'booze',
  ],
  [
    '밥',
    '점심',
    '저녁',
    '아침',
    '식당',
    '식사',
    '고기',
    '삼겹살',
    '치킨',
    '피자',
    '국밥',
    '분식',
    'lunch',
    'dinner',
    'breakfast',
    'brunch',
    'meal',
    'food',
    'restaurant',
    'chicken',
    'pizza',
  ],
  ['커피', '카페', '아메리카노', '라떼', 'coffee', 'cafe', 'latte', 'americano'],
  [
    '택시',
    '버스',
    '지하철',
    '교통',
    '기차',
    'ktx',
    'taxi',
    'uber',
    'bus',
    'subway',
    'train',
    'transit',
  ],
  [
    '숙소',
    '호텔',
    '게스트하우스',
    '에어비앤비',
    'hotel',
    'airbnb',
    'hostel',
    'lodging',
    'stay',
  ],
  [
    '마트',
    '편의점',
    '장보기',
    '슈퍼',
    'mart',
    'grocery',
    'groceries',
    'supermarket',
  ],
  ['간식', '디저트', '빵', '아이스크림', 'snack', 'snacks', 'dessert', 'bakery'],
  [
    '영화',
    '노래방',
    '공연',
    '티켓',
    '입장료',
    'movie',
    'karaoke',
    'ticket',
    'tickets',
    'concert',
  ],
  ['주유', '기름', '주차', 'gas', 'fuel', 'parking', 'toll'],
]
