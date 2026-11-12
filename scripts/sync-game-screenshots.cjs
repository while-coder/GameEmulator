// Match catalog entries to Libretro's real in-game snapshots. Never guess across sequels.
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const root = resolve(__dirname, '..')
const aliases = {
  '彩虹岛': 'Rainbow Islands', '彩虹岛2-遮阳伞之星': 'Parasol Stars - The Story of Bubble Bobble III',
  '摩艾君': 'Moai-kun', '玛丽医生': 'Dr. Mario', '超级玛丽': 'Super Mario Bros.',
  '超级玛丽2': 'Super Mario Bros. 2', '超级玛丽3': 'Super Mario Bros. 3',
  '邦尼兔趣味屋': 'Bugs Bunny Birthday Blowout, The', '鲁邦三世': 'Lupin Sansei - Pandora no Isan',
  '魂斗罗': 'Contra', '魂斗罗1': 'Contra', '魂斗罗2 中文': 'Super C',
  '赤影战士(水上魂斗罗)': 'Kage', '兔宝宝大冒险1': 'Tiny Toon Adventures',
  '兔宝宝大冒险2': 'Tiny Toon Adventures 2 - Trouble in Wackyland',
  '忍者龙剑传1': 'Ninja Gaiden', '忍者龙剑传2': 'Ninja Gaiden II - The Dark Sword of Chaos',
  '忍者龙剑传3': 'Ninja Gaiden III - The Ancient Ship of Doom',
  '双截龙2(中文)': 'Double Dragon II - The Revenge', '双截龙3(中文)': 'Double Dragon III - The Sacred Stones',
  '忍者蛙1战斗蛙': 'Battletoads', '忍者蛙和双截龙': 'Battletoads-Double Dragon',
  '机械战警': 'RoboCop', '机械战警2': 'RoboCop 2', '机械战警3': 'RoboCop 3',
  '高桥名人的冒险岛(中文)': 'Adventure Island', '冒险岛3中文版': 'Adventure Island 3',
  '高桥名人的冒险岛4': 'Takahashi Meijin no Bouken Jima IV',
  '热血足球': 'Kunio-kun no Nekketsu Soccer League', '热血篮球': 'Nekketsu! Street Basket - Ganbare Dunk Heroes',
  '热血物语': 'Downtown - Nekketsu Monogatari', '热血格斗': 'Nekketsu Kakutou Densetsu',
  '坦克大战': 'Battle City', '炸弹人': 'Bomberman', '雪人兄弟': 'Snow Brothers',
  '淘金者': 'Lode Runner', '松鼠大战': "Chip 'n Dale - Rescue Rangers", '松鼠大战2': "Chip 'n Dale - Rescue Rangers 2",
}
const systems = {
  nes: 'Nintendo - Nintendo Entertainment System',
  arcade: 'FBNeo - Arcade Games',
}
const normalize = name => name.normalize('NFKD').replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/gi, '').toLowerCase()
async function main() {
  const matches = {}
  for (const [system, playlist] of Object.entries(systems)) {
    const base = `https://thumbnails.libretro.com/${encodeURIComponent(playlist)}/Named_Snaps/`
    const localIndex = process.argv[system === 'nes' ? 2 : 3]
    let html
    if (localIndex) html = readFileSync(localIndex, 'utf8')
    else {
      const response = await fetch(base, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`Screenshot index: HTTP ${response.status} (${base})`)
      html = await response.text()
    }
    const files = [...html.matchAll(/href="([^"?]+\.png)"/gi)].map(match => decodeURIComponent(match[1].replace(/&amp;/g, '&')))
    if (!files.length) throw new Error(`Screenshot index is empty: ${base}`)
    const names = new Map()
    // Prefer standard releases over prototypes, bad dumps, hacks and compilations.
    for (const file of files.sort((a, b) => /\b(USA|World)\b/.test(b) - /\b(USA|World)\b/.test(a))) {
      if (/\b(Proto|Beta|Sample|Hack|Pirate|Aftermarket)\b/i.test(file)) continue
      const key = normalize(file.replace(/\.png$/i, ''))
      if (!names.has(key)) names.set(key, file)
    }
    let found = 0, total = 0
    for (const catalogName of system === 'nes' ? ['nes'] : ['arcade', 'neogeo']) {
      const catalog = JSON.parse(readFileSync(resolve(root, `games/${catalogName}/catalog.json`), 'utf8'))
      for (const game of catalog.games) {
        total++
        const candidates = [aliases[game.name], game.name_en, game.name, decodeURIComponent(game.download_url.split('/').pop()).replace(/\.(nes|zip)$/i, '')].filter(Boolean)
        const file = candidates.map(name => names.get(normalize(name))).find(Boolean)
        if (file) { matches[game.sha256.toLowerCase()] = `${system}/${file}`; found++ }
      }
    }
    console.log(`${system}: ${found}/${total} matched screenshots`)
  }
  writeFileSync(resolve(root, 'packages/player-ui/data/game-screenshots.json'), JSON.stringify(matches, null, 2) + '\n')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
