/**
 * Shortest-unique-prefix avatar labels for a roster of member names.
 *
 * A single first character is ambiguous the moment two names share it
 * (수이수이 and 수탉 both rendered "수"), so each name gets the shortest
 * prefix no other name in the roster also starts with — the full name when
 * nothing shorter disambiguates (identical names, or a name that is a
 * prefix of another). Prefixes count code points, not UTF-16 units, so an
 * astral character is never split.
 */
export function uniqueInitials(names: string[]): Map<string, string> {
  const labels = new Map<string, string>()
  names.forEach((name, index) => {
    if (labels.has(name)) return
    const chars = Array.from(name)
    const others = names.filter((_, at) => at !== index)
    let length = 1
    while (
      length < chars.length &&
      others.some((other) => other.startsWith(chars.slice(0, length).join('')))
    ) {
      length += 1
    }
    labels.set(name, chars.slice(0, length).join(''))
  })
  return labels
}
