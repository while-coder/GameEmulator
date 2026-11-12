export type SaveKind = 'quick' | 'normal'
type SaveSlot = { kind?: SaveKind; slot?: string; label?: string }

/** Legacy arcade snapshots have no kind; legacy NES quick slots may carry a core suffix. */
export function saveKindOf(record: SaveSlot): SaveKind {
  return record.kind ?? (!record.slot || record.slot === 'quick' || record.slot.startsWith('quick:') ? 'quick' : 'normal')
}

let slotSequence = 0
export function newSaveSlot(): string {
  return `s-${Date.now()}-${(slotSequence++).toString(36)}`
}

export function nextSaveLabel(records: SaveSlot[]): string {
  const normal = records.filter(record => saveKindOf(record) === 'normal')
  const highest = normal.reduce((value, record) => Math.max(value, Number(/^存档 (\d+)$/.exec(record.label ?? '')?.[1] ?? 0)), normal.length)
  return `存档 ${highest + 1}`
}
