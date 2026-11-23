import type { SaveKind } from '../shared/saveSlots'

export type SaveListItem = {
  key: string
  label: string
  kind: SaveKind
  savedAt: number
  preview?: Blob
  compatible?: boolean
  restore: () => Promise<void>
  rename: (label: string) => Promise<void>
  remove: () => Promise<void>
}
