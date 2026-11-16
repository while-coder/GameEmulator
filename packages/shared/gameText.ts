import { match, pinyin } from 'pinyin-pro'

const alphabetical = new Intl.Collator('en', { numeric: true, sensitivity: 'base', ignorePunctuation: true })
const originalNames = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true })
const sortKeys = new Map<string, string>()
const han = /\p{Script=Han}/u

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-Hans-CN')
}

function sortKey(name: string): string {
  let key = sortKeys.get(name)
  if (key === undefined) {
    key = pinyin(normalize(name), { toneType: 'none', type: 'array', nonZh: 'consecutive', v: true }).join('')
    sortKeys.set(name, key)
  }
  return key
}

/** Compare the displayed name, mixing Chinese pinyin and Latin letters. */
export function compareGameNames(a: string, b: string): number {
  return alphabetical.compare(sortKey(a), sortKey(b)) || originalNames.compare(a, b)
}

/** Keep literal search and add full, initial and mixed pinyin within each field. */
export function createGameSearch(query: string): (fields: unknown[]) => boolean {
  const q = normalize(query)
  if (!q) return () => true
  return fields => {
    const text = fields.filter(value => value !== undefined && value !== null).map(value => normalize(String(value)))
    if (text.join(' ').includes(q)) return true
    return text.some(value => han.test(value) && match(value, q, { continuous: true, space: 'ignore', v: true }) !== null)
  }
}
