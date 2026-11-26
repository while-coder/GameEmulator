import type { LobbyGame } from './useLobbyLibrary'

export type LobbyCard = {
  id: string
  name: string
  base: LobbyGame
  launch: LobbyGame
  versions: LobbyGame[]
  localCount: number
  lastPlayedAt: number
}

export function lobbyGameId(game: LobbyGame) {
  return game.groupId ? `${game.system}:group:${game.groupId}` : `${game.system}:${game.key}`
}

export function groupLobbyGames(games: LobbyGame[]) {
  const groups = new Map<string, LobbyGame[]>()
  for (const game of games) {
    const id = lobbyGameId(game)
    const group = groups.get(id)
    if (group) group.push(game)
    else groups.set(id, [game])
  }
  return groups
}

export function lobbyCard(id: string, group: LobbyGame[], matches: LobbyGame[], showAllVersions: boolean): LobbyCard {
  const base = group.find(game => game.groupDefault) ?? group[0]
  const versions = showAllVersions ? group : matches
  const launch = matches.reduce((best, game) => {
    if (game.lastPlayedAt !== best.lastPlayedAt) return game.lastPlayedAt > best.lastPlayedAt ? game : best
    return game.groupDefault ? game : best
  })
  return {
    id,
    name: base.groupName ?? base.name,
    base,
    launch,
    versions: versions.includes(base) ? [base, ...versions.filter(game => game !== base)] : versions,
    localCount: versions.filter(game => game.local).length,
    lastPlayedAt: launch.lastPlayedAt,
  }
}
