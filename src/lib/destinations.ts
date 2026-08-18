/**
 * Product-curated list of travel destinations for the "Where are you going?"
 * trip picker.
 *
 * This is NOT an exhaustive country list — it is a hand-picked selection of
 * roughly the world's 50 most-visited tourist destinations (UNWTO top
 * arrivals plus the obvious bucket-list countries), spanning Europe, the
 * Americas, Asia-Pacific, the Middle East and Africa. It is judged globally,
 * not weighted toward any single country's outbound-travel patterns.
 *
 * `code` and `name` mirror the `countries-list` package's alpha-2 keys and
 * English names. `currency` is the FIRST entry of that country's
 * `countries-list` `currency` array (some countries list several, e.g.
 * Switzerland's `["CHF","CHE","CHW"]" — the first is the everyday one).
 * These are literals, not computed at runtime: `countries-list` is ~396KB
 * and must never ship to the browser from this module. The values are
 * pinned and cross-checked against `countries-list` by
 * `destinations.test.ts`, which is what makes them trustworthy without
 * hand-maintaining an ISO table ourselves.
 *
 * `cities` are 5-8 real, well-known cities per country (most prominent /
 * most-visited first), given as the plain English exonym a traveller would
 * recognise.
 *
 * To add a destination: add one entry here (keeping `DESTINATIONS` sorted
 * by `name`), then make sure the expense-currency picker offers its
 * `currency`.
 */

export interface Destination {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string
  /** English country name, as `countries-list` spells it. */
  name: string
  /** ISO 4217 code. The FIRST entry of the country's `currency` array. */
  currency: string
  /** Major/tourist cities, most prominent first. 5-8 each. */
  cities: readonly string[]
}

export const DESTINATIONS: readonly Destination[] = [
  {
    code: 'AR',
    name: 'Argentina',
    currency: 'ARS',
    cities: [
      'Buenos Aires',
      'Mendoza',
      'Bariloche',
      'Córdoba',
      'Salta',
      'Ushuaia',
    ],
  },
  {
    code: 'AU',
    name: 'Australia',
    currency: 'AUD',
    cities: [
      'Sydney',
      'Melbourne',
      'Brisbane',
      'Perth',
      'Gold Coast',
      'Cairns',
      'Adelaide',
    ],
  },
  {
    code: 'AT',
    name: 'Austria',
    currency: 'EUR',
    cities: ['Vienna', 'Salzburg', 'Innsbruck', 'Graz', 'Hallstatt'],
  },
  {
    code: 'BR',
    name: 'Brazil',
    currency: 'BRL',
    cities: [
      'Rio de Janeiro',
      'São Paulo',
      'Salvador',
      'Brasília',
      'Florianópolis',
      'Fortaleza',
    ],
  },
  {
    code: 'CA',
    name: 'Canada',
    currency: 'CAD',
    cities: [
      'Toronto',
      'Vancouver',
      'Montreal',
      'Quebec City',
      'Banff',
      'Calgary',
      'Ottawa',
    ],
  },
  {
    code: 'CL',
    name: 'Chile',
    currency: 'CLP',
    cities: [
      'Santiago',
      'Valparaíso',
      'San Pedro de Atacama',
      'Puerto Varas',
      'Punta Arenas',
    ],
  },
  {
    code: 'CN',
    name: 'China',
    currency: 'CNY',
    cities: [
      'Beijing',
      'Shanghai',
      "Xi'an",
      'Guilin',
      'Chengdu',
      'Hong Kong',
      'Hangzhou',
    ],
  },
  {
    code: 'CO',
    name: 'Colombia',
    currency: 'COP',
    cities: ['Bogotá', 'Cartagena', 'Medellín', 'Cali', 'Santa Marta'],
  },
  {
    code: 'CR',
    name: 'Costa Rica',
    currency: 'CRC',
    cities: [
      'San José',
      'La Fortuna',
      'Manuel Antonio',
      'Monteverde',
      'Tamarindo',
    ],
  },
  {
    code: 'HR',
    name: 'Croatia',
    currency: 'EUR',
    cities: ['Dubrovnik', 'Split', 'Zagreb', 'Zadar', 'Hvar', 'Plitvice Lakes'],
  },
  {
    code: 'CU',
    name: 'Cuba',
    currency: 'CUP',
    cities: ['Havana', 'Varadero', 'Trinidad', 'Santiago de Cuba', 'Viñales'],
  },
  {
    code: 'CZ',
    name: 'Czechia',
    currency: 'CZK',
    cities: ['Prague', 'Český Krumlov', 'Brno', 'Karlovy Vary', 'Kutná Hora'],
  },
  {
    code: 'DK',
    name: 'Denmark',
    currency: 'DKK',
    cities: ['Copenhagen', 'Aarhus', 'Odense', 'Aalborg', 'Skagen'],
  },
  {
    code: 'DO',
    name: 'Dominican Republic',
    currency: 'DOP',
    cities: [
      'Punta Cana',
      'Santo Domingo',
      'Puerto Plata',
      'La Romana',
      'Samaná',
    ],
  },
  {
    code: 'EG',
    name: 'Egypt',
    currency: 'EGP',
    cities: [
      'Cairo',
      'Luxor',
      'Aswan',
      'Hurghada',
      'Sharm El Sheikh',
      'Alexandria',
    ],
  },
  {
    code: 'FR',
    name: 'France',
    currency: 'EUR',
    cities: [
      'Paris',
      'Nice',
      'Lyon',
      'Marseille',
      'Bordeaux',
      'Strasbourg',
      'Cannes',
    ],
  },
  {
    code: 'DE',
    name: 'Germany',
    currency: 'EUR',
    cities: [
      'Berlin',
      'Munich',
      'Hamburg',
      'Cologne',
      'Frankfurt',
      'Dresden',
      'Heidelberg',
    ],
  },
  {
    code: 'GR',
    name: 'Greece',
    currency: 'EUR',
    cities: [
      'Athens',
      'Santorini',
      'Mykonos',
      'Thessaloniki',
      'Rhodes',
      'Crete',
    ],
  },
  {
    code: 'HK',
    name: 'Hong Kong',
    currency: 'HKD',
    cities: [
      'Hong Kong Island',
      'Kowloon',
      'Tsim Sha Tsui',
      'Causeway Bay',
      'Mong Kok',
      'Lantau Island',
    ],
  },
  {
    code: 'HU',
    name: 'Hungary',
    currency: 'HUF',
    cities: ['Budapest', 'Debrecen', 'Szeged', 'Eger', 'Pécs'],
  },
  {
    code: 'IS',
    name: 'Iceland',
    currency: 'ISK',
    cities: ['Reykjavik', 'Akureyri', 'Vík', 'Húsavík', 'Selfoss'],
  },
  {
    code: 'IN',
    name: 'India',
    currency: 'INR',
    cities: [
      'New Delhi',
      'Mumbai',
      'Jaipur',
      'Agra',
      'Goa',
      'Varanasi',
      'Udaipur',
    ],
  },
  {
    code: 'ID',
    name: 'Indonesia',
    currency: 'IDR',
    cities: ['Bali', 'Jakarta', 'Yogyakarta', 'Lombok', 'Ubud', 'Surabaya'],
  },
  {
    code: 'IE',
    name: 'Ireland',
    currency: 'EUR',
    cities: ['Dublin', 'Galway', 'Cork', 'Killarney', 'Limerick'],
  },
  {
    code: 'IL',
    name: 'Israel',
    currency: 'ILS',
    cities: ['Jerusalem', 'Tel Aviv', 'Haifa', 'Eilat', 'Nazareth'],
  },
  {
    code: 'IT',
    name: 'Italy',
    currency: 'EUR',
    cities: [
      'Rome',
      'Florence',
      'Venice',
      'Milan',
      'Naples',
      'Verona',
      'Bologna',
    ],
  },
  {
    code: 'JP',
    name: 'Japan',
    currency: 'JPY',
    cities: [
      'Tokyo',
      'Osaka',
      'Kyoto',
      'Sapporo',
      'Yokohama',
      'Fukuoka',
      'Nagoya',
    ],
  },
  {
    code: 'MY',
    name: 'Malaysia',
    currency: 'MYR',
    cities: ['Kuala Lumpur', 'Penang', 'Langkawi', 'Malacca', 'Johor Bahru'],
  },
  {
    code: 'MX',
    name: 'Mexico',
    currency: 'MXN',
    cities: [
      'Mexico City',
      'Cancún',
      'Playa del Carmen',
      'Tulum',
      'Guadalajara',
      'Puerto Vallarta',
    ],
  },
  {
    code: 'MA',
    name: 'Morocco',
    currency: 'MAD',
    cities: [
      'Marrakech',
      'Casablanca',
      'Fez',
      'Chefchaouen',
      'Rabat',
      'Tangier',
    ],
  },
  {
    code: 'NL',
    name: 'Netherlands',
    currency: 'EUR',
    cities: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Maastricht'],
  },
  {
    code: 'NZ',
    name: 'New Zealand',
    currency: 'NZD',
    cities: ['Auckland', 'Queenstown', 'Wellington', 'Christchurch', 'Rotorua'],
  },
  {
    code: 'NO',
    name: 'Norway',
    currency: 'NOK',
    cities: ['Oslo', 'Bergen', 'Tromsø', 'Ålesund', 'Stavanger'],
  },
  {
    code: 'PE',
    name: 'Peru',
    currency: 'PEN',
    cities: ['Lima', 'Cusco', 'Arequipa', 'Machu Picchu', 'Puno'],
  },
  {
    code: 'PH',
    name: 'Philippines',
    currency: 'PHP',
    cities: ['Manila', 'Cebu', 'Boracay', 'Palawan', 'Davao'],
  },
  {
    code: 'PL',
    name: 'Poland',
    currency: 'PLN',
    cities: ['Warsaw', 'Kraków', 'Gdańsk', 'Wrocław', 'Poznań'],
  },
  {
    code: 'PT',
    name: 'Portugal',
    currency: 'EUR',
    cities: ['Lisbon', 'Porto', 'Faro', 'Sintra', 'Madeira', 'Coimbra'],
  },
  {
    code: 'SA',
    name: 'Saudi Arabia',
    currency: 'SAR',
    cities: ['Riyadh', 'Jeddah', 'Mecca', 'Medina', 'AlUla'],
  },
  {
    code: 'SG',
    name: 'Singapore',
    currency: 'SGD',
    cities: [
      'Marina Bay',
      'Sentosa',
      'Orchard Road',
      'Chinatown',
      'Little India',
      'Bugis',
      'Changi',
    ],
  },
  {
    code: 'ZA',
    name: 'South Africa',
    currency: 'ZAR',
    cities: [
      'Cape Town',
      'Johannesburg',
      'Durban',
      'Pretoria',
      'Port Elizabeth',
      'Stellenbosch',
    ],
  },
  {
    code: 'KR',
    name: 'South Korea',
    currency: 'KRW',
    cities: ['Seoul', 'Busan', 'Jeju', 'Incheon', 'Gyeongju', 'Daegu'],
  },
  {
    code: 'ES',
    name: 'Spain',
    currency: 'EUR',
    cities: [
      'Madrid',
      'Barcelona',
      'Seville',
      'Valencia',
      'Granada',
      'Málaga',
      'Ibiza',
    ],
  },
  {
    code: 'LK',
    name: 'Sri Lanka',
    currency: 'LKR',
    cities: ['Colombo', 'Kandy', 'Galle', 'Ella', 'Sigiriya', 'Negombo'],
  },
  {
    code: 'SE',
    name: 'Sweden',
    currency: 'SEK',
    cities: ['Stockholm', 'Gothenburg', 'Malmö', 'Uppsala', 'Kiruna'],
  },
  {
    code: 'CH',
    name: 'Switzerland',
    currency: 'CHF',
    cities: ['Zurich', 'Geneva', 'Lucerne', 'Interlaken', 'Bern', 'Zermatt'],
  },
  {
    code: 'TW',
    name: 'Taiwan',
    currency: 'TWD',
    cities: ['Taipei', 'Kaohsiung', 'Taichung', 'Tainan', 'Hualien', 'Jiufen'],
  },
  {
    code: 'TH',
    name: 'Thailand',
    currency: 'THB',
    cities: [
      'Bangkok',
      'Phuket',
      'Chiang Mai',
      'Pattaya',
      'Krabi',
      'Koh Samui',
    ],
  },
  {
    code: 'TR',
    name: 'Türkiye',
    currency: 'TRY',
    cities: ['Istanbul', 'Antalya', 'Cappadocia', 'Izmir', 'Bodrum', 'Ankara'],
  },
  {
    code: 'AE',
    name: 'United Arab Emirates',
    currency: 'AED',
    cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah', 'Fujairah'],
  },
  {
    code: 'GB',
    name: 'United Kingdom',
    currency: 'GBP',
    cities: [
      'London',
      'Edinburgh',
      'Manchester',
      'Liverpool',
      'Glasgow',
      'Oxford',
      'Bath',
    ],
  },
  {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    cities: [
      'New York',
      'Los Angeles',
      'Las Vegas',
      'San Francisco',
      'Miami',
      'Chicago',
      'Orlando',
    ],
  },
  {
    code: 'VN',
    name: 'Vietnam',
    currency: 'VND',
    cities: [
      'Hanoi',
      'Ho Chi Minh City',
      'Da Nang',
      'Hoi An',
      'Ha Long Bay',
      'Nha Trang',
    ],
  },
]

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0)

/** ISO 3166-1 alpha-2 -> regional-indicator flag emoji ("JP" -> 🇯🇵). */
export function flagEmoji(code: string): string {
  if (!/^[a-zA-Z]{2}$/.test(code)) return ''
  return code
    .toUpperCase()
    .split('')
    .map((letter) =>
      String.fromCodePoint(letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET),
    )
    .join('')
}

const DESTINATIONS_BY_CODE = new Map(DESTINATIONS.map((d) => [d.code, d]))

/** Look up one destination by alpha-2 code. */
export function destinationFor(code: string): Destination | undefined {
  return DESTINATIONS_BY_CODE.get(code)
}

/** Every distinct currency the list implies, sorted. */
export function destinationCurrencies(): string[] {
  return [...new Set(DESTINATIONS.map((d) => d.currency))].sort()
}
