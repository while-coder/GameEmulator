import { deleteSaveStateByKey, listSaveStates, renameSaveState } from '../../../nes/src/store/saveState'
import { listSnapshots, removeSnapshot, renameSnapshot } from '../../../arcade/src/store/library'
import { listStates, removeState, renameState } from '../../../console/src/store'
import { nativeSaveBuilds, wasmSaveBuilds } from '../../../shared/saveBuilds'
import { saveKindOf } from '../../../shared/saveSlots'
import type { GameSystem } from '../../../shared/playHistory'
import type { SaveListItem } from '../../../player-ui/saveList'

export async function loadLobbySaves(system: GameSystem, gameKey: string, native: boolean, play: (saveKey: string) => Promise<void>): Promise<SaveListItem[]> {
  const build = native && system !== 'psp' ? nativeSaveBuilds[system] : wasmSaveBuilds[system]
  if (system === 'nes') {
    return (await listSaveStates(gameKey)).map(record => ({
      ...record,
      label: record.label?.trim() || (saveKindOf(record) === 'quick' ? '快速存档' : record.name),
      kind: saveKindOf(record),
      compatible: record.coreBuild === build,
      restore: () => play(record.slot),
      rename: label => renameSaveState(record.key, label),
      remove: () => deleteSaveStateByKey(record.key),
    }))
  }
  if (system === 'arcade') {
    return (await listSnapshots()).filter(record => record.gameHash === gameKey.toLowerCase()).map(record => ({
      ...record,
      label: record.label?.trim() || (saveKindOf(record) === 'quick' ? '快速存档' : record.gameName),
      kind: saveKindOf(record),
      compatible: record.coreBuild === build,
      restore: () => play(record.key),
      rename: label => renameSnapshot(record.key, label),
      remove: () => removeSnapshot(record.key),
    }))
  }
  return (await listStates(system, gameKey)).map(record => ({
    ...record,
    compatible: record.build === build,
    restore: () => play(record.key),
    rename: label => renameState(record.key, label),
    remove: () => removeState(record),
  }))
}
