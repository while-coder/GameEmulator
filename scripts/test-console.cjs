const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..'), children = [], pending = new Map(), errors = []
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'console-browser-'))
let socket, sessionId, sequence = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function send(method, params={}, session=sessionId) { const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}))}) }
async function evaluate(expression) { const result=await send('Runtime.evaluate',{expression:'{\n'+expression+'\n}',awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value }
async function until(expression,label,timeout=30000) { const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(100)}throw new Error(label+': '+await evaluate('document.body.innerText')) }
// Original, generated test cartridges; no commercial ROMs or BIOS required.
const gba = Buffer.alloc(32768)
// Show a red backdrop at boot. A and B latch blue and green in palette RAM,
// so the rendered frame distinguishes the exact state restored after relaunch.
const gbaProgram = [
  0xe59f0034, 0xe3a01000, 0xe1c010b0, // Disable forced blank.
  0xe59f002c, 0xe59f102c, 0xe3a0201f, 0xe1c120b0, // Load input/palette addresses and set red.
  0xe1d020b0, 0xe3120001, 0x03a03c7c, 0x01c130b0, // A sets blue.
  0xe3120002, 0x059f3010, 0x01c130b0, 0xeafffff7, // B sets green, then poll again.
  0x04000000, 0x04000130, 0x05000000, 0x000003e0,
]
gba.writeUInt32LE(0xea00002e, 0) // Branch over the cartridge header.
gbaProgram.forEach((word, index) => gba.writeUInt32LE(word, 0xc0 + index * 4))
gba.write('GAMEEMU TEST', 0xa0, 'ascii'); gba[0xb2] = 0x96
let gbaCheck = 0
for (let offset = 0xa0; offset <= 0xbc; offset++) gbaCheck = (gbaCheck - gba[offset]) & 255
gba[0xbd] = (gbaCheck - 0x19) & 255
const gb = Buffer.alloc(32768)
gb.set([0xc3, 0x50, 1], 0x100) // Jump past cartridge header.
gb.set([0xce, 0xed, 0x66, 0x66], 0x104) // Cartridge detection signature.
gb.write('GAMEEMU TEST', 0x134, 'ascii')
gb.set([0xc3, 0x50, 1], 0x150) // LR35902: jump to self.
let gbCheck = 0
for (let offset = 0x134; offset <= 0x14c; offset++) gbCheck = (gbCheck - gb[offset] - 1) & 255
gb[0x14d] = gbCheck
const snes=Buffer.alloc(32768,0xea)
// Original minimal LoROM fixture: initialize 65816, disable display, then loop.
snes.set([0x78,0x18,0xfb,0xc2,0x10,0xa2,0xff,0x1f,0x9a,0xe2,0x20,0xa9,0x80,0x8d,0,0x21,0x80,0xfe])
snes.write('CONSOLE SMOKE TEST    ',0x7fc0,'ascii');snes[0x7fd5]=0x20;snes[0x7fd6]=0;snes[0x7fd7]=5;snes[0x7fd8]=0;snes[0x7fd9]=1;snes[0x7fda]=0x33;snes[0x7fdb]=0
snes.writeUInt16LE(0x8000,0x7ffc);snes.writeUInt16LE(0x8000,0x7ffa);snes.writeUInt16LE(0x8000,0x7ffe)
snes.writeUInt16LE(0xffff,0x7fdc);snes.writeUInt16LE(0,0x7fde)
let sum=0;for(const byte of snes)sum=(sum+byte)&65535;snes.writeUInt16LE(sum^65535,0x7fdc);snes.writeUInt16LE(sum,0x7fde)
const batterySnes=Buffer.from(snes);batterySnes[0x7fd6]=2;batterySnes[0x7fd8]=1
batterySnes.set([0x78,0x18,0xfb,0xe2,0x20,0xa9,0x55,0x8f,0,0,0x70,0x80,0xfe])
const fixtures={gba:[{name:'GBA Test',file_name:'test.gba',data:gba.toString('base64')} ,{name:'GB Test',file_name:'test.gb',data:gb.toString('base64')}],sfc:[{name:'SFC Test',file_name:'test.sfc',data:snes.toString('base64')},{name:'SFC Battery Test',file_name:'battery.sfc',data:batterySnes.toString('base64')}]}
for(let i=0;i<49;i++){const bytes=Buffer.from(gba);bytes[0x200]=i+1;fixtures.gba.push({name:`Library Game ${i}`,file_name:`library-${i}.gba`,data:bytes.toString('base64')})}
for(const games of Object.values(fixtures))for(const game of games){const bytes=Buffer.from(game.data,'base64');game.sha256=crypto.createHash('sha256').update(bytes).digest('hex');game.file_size=bytes.length;game.download_url='https://console.test/'+game.file_name;game.tags=[game.file_name.split('.').pop().toUpperCase(),'经典游戏','英语']}
function inject(fixtures, version) {
  window.__consoleFixtures = fixtures
  window.__consoleTestDocument = Math.random()
  window.__consoleCatalogRequests = []
  localStorage.setItem('game-emulator.version', version)
  const playerSystem = location.pathname.split('/').pop().replace('.html', '')
  if (fixtures[playerSystem] && location.search.includes('view=settings') && !sessionStorage.getItem('legacy-source-tested:' + playerSystem)) {
    localStorage.setItem('console:' + playerSystem + ':source', 'https://console.test/catalog.json')
    sessionStorage.setItem('legacy-source-tested:' + playerSystem, '1')
  }
  const original = window.fetch.bind(window)
  window.fetch = async (input, options) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.endsWith('/catalog.json')) {
      const system = Object.keys(fixtures).find(id => url.includes('/' + id + '-roms/'))
      if (!system) return Response.json({ games: [], dependency_files: [] })
      if (sessionStorage.getItem('console-test-hold-catalog') === system) {
        await new Promise(resolve => { window.__releaseCatalogRequest = resolve })
      }
      if (sessionStorage.getItem('console-test-catalog-failure') === system) throw new TypeError('Offline catalog fixture')
      if (sessionStorage.getItem('console-test-invalid-catalog') === system) return Response.json({ games: [null] })
      window.__consoleCatalogRequests.push(url)
      return Response.json({ games: fixtures[system].map(({ data, ...game }) => game) })
    }
    const game = Object.values(fixtures).flat().find(game => game.download_url === url)
    if (!game) return original(input, options)
    if (sessionStorage.getItem('console-test-slow-download')) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2500)
        options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal.reason) }, { once: true })
      })
    }
    return new Response(Uint8Array.from(atob(game.data), c => c.charCodeAt(0)))
  }
}
async function click(text){
 const target=`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)} && el.getBoundingClientRect().width && !el.disabled)`
 await until(`!!(${target})`,'button ready: '+text)
 await evaluate(`(${target}).click()`)
}
async function saveCardPointer(hold = false, index = 0) {
  await until("document.querySelector('.save-card-trigger:not(:disabled)')", 'save card ready')
  const { x, y } = await evaluate(`const rect=document.querySelectorAll('.save-card-trigger')[${index}].getBoundingClientRect();({x:rect.x+rect.width/2,y:rect.y+rect.height/2})`)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  if (hold) {
    await until("document.querySelector('.save-card-menu[open]')", 'long press opens save menu')
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
async function saveCardMenu() {
  await evaluate("document.querySelector('.save-card-trigger').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))")
  await until("document.querySelector('.save-card-menu[open]')", 'save card context menu')
}
async function clickSaveBackdrop() {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 })
  await until("!document.querySelector('.player-save-list')", 'click outside closes save modal')
}
async function pressGameKey(key, code, windowsVirtualKeyCode) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode })
  await delay(120)
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode })
}
async function assertGameColor(rgb, description) {
  const actual = await evaluate(`(async()=>{
    const point = document.querySelector('.console-frame canvas').getBoundingClientRect()
    return { x: Math.floor(point.x + point.width / 2), y: Math.floor(point.y + point.height / 2) }
  })()`)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const pixel = await evaluate(`(async()=>{
    const img = new Image()
    img.src = 'data:image/png;base64,${data}'
    await img.decode()
    const ctx = document.createElement('canvas').getContext('2d')
    ctx.drawImage(img, Math.round(${actual.x} * img.width / innerWidth), Math.round(${actual.y} * img.height / innerHeight), 1, 1, 0, 0, 1, 1)
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
  })()`)
  assert.deepEqual(pixel.map(value => Number(value >= 128)), rgb, description + ' (pixel ' + pixel + ')')
}
async function selectLobbyTab(system) {
  await until("document.querySelector('.game-lobby')", 'game lobby')
  if (await evaluate("document.querySelector('.game-lobby h1')?.textContent === '设置'")) await click('‹ 返回')
  await evaluate(`document.querySelector('#lobby-tab-${system}').click()`)
}
async function lobbyGame(system, index = 0) {
  await selectLobbyTab(system)
  const selector = `[data-lobby-focus="game:${system}:${fixtures[system][index].sha256}"] .game-launch`
  await until(`document.querySelector(${JSON.stringify(selector)})`, 'game in lobby')
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
}
async function lobbyGameSaves(system, index = 0) {
  await selectLobbyTab(system)
  const selector = `[data-lobby-focus="game:${system}:${fixtures[system][index].sha256}"] .game-launch`
  await until(`document.querySelector(${JSON.stringify(selector)})`, 'game card')
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))`)
  await until("document.querySelector('.game-card-menu[open]')", 'game menu')
  assert.equal(await evaluate("document.querySelector('.game-card-menu').textContent.includes('游戏详情')"), false)
  await click('查看存档')
  await until("document.querySelector('.player-save-list[open]')", 'standalone save list')
  assert.equal(await evaluate("!!document.querySelector('.console-settings-modal')"), false)
  assert.equal(await evaluate("location.pathname === '/index.html' && !!document.querySelector('.game-lobby')"), true, 'save modal stays in the lobby')
  assert.equal(await evaluate("document.querySelector('.player-save-list').getBoundingClientRect().width < innerWidth"), true, 'save modal leaves the lobby visible')
  assert.equal(await evaluate("!!document.querySelector('.save-list-header button')"), false, 'no back button in lobby save modal')
}
async function lobbyPlatformSettings(system) {
  await until("document.querySelector('.game-lobby')", 'game lobby')
  if (await evaluate("document.querySelector('.game-lobby h1')?.textContent !== '设置'")) await click('设置')
  await evaluate(`document.querySelector('[data-lobby-focus="settings:${system}"]').click()`)
  await until("document.querySelector('.console-settings-modal .player-settings')", 'platform settings')
  assert.equal(await evaluate("!!document.querySelector('.library-browser, .console-game, .player-toolbar')"), false, 'no legacy library beneath settings')
}
async function main(){
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','18124','--strictPort'],{cwd:path.join(root,'apps/pwa'),stdio:['ignore','pipe','pipe']});children.push(vite)
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:18124/')).ok)break}catch{}await delay(100)}
 const chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:['ignore','ignore','pipe']});children.push(chrome)
 const browserUrl=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);chrome.stderr.on('data',data=>{const match=data.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1])}})})
 socket=new WebSocket(browserUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result)}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails)})
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${inject})(${JSON.stringify(fixtures)}, ${JSON.stringify(require('../package.json').version)})`})
 for(const system of (process.argv[2] || 'gba,sfc').split(',')){
  await send('Page.navigate',{url:'http://127.0.0.1:18124/index.html'})
  await selectLobbyTab(system)
  const pageSize = 36
  await until(`document.querySelectorAll('.game-card').length === ${Math.min(pageSize, fixtures[system].length)}`, 'catalog ' + system)
  assert.ok(await evaluate(`window.__consoleCatalogRequests.includes('https://raw.githubusercontent.com/while-coder/${system}-roms/main/catalog.json')`), 'fixed catalog URL')
  if (system === 'gba') {
    await click('下一页 ›')
    await until(`document.querySelectorAll('.game-card').length === ${fixtures[system].length - pageSize}`, 'lobby pagination')
    await click('‹ 上一页')
    await click('搜索')
    await click('输入关键词')
    await evaluate("const search=document.querySelector('.search-keyword input');search.value='Library Game 48';search.dispatchEvent(new Event('input',{bubbles:true}))")
    await until("document.querySelectorAll('.game-card').length === 1 && document.querySelector('.game-card').innerText.includes('Library Game 48')", 'lobby search')
    await click('‹ 返回')
  }
  await lobbyPlatformSettings(system)
  assert.equal(await evaluate(`localStorage.getItem('console:${system}:source')`), null, 'legacy source override removed')
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.console-settings-modal [role=tab]'),el=>el.textContent.trim())"),['按键','显示','音频','其他'])
  for(const [width,height]of [[1280,800],[390,844],[844,390],[960,540]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<1000});await delay(120)
   if(width===960)await evaluate(`(async()=>{document.documentElement.classList.add('android-tv');await import('/@fs/'+${JSON.stringify(root)}+'/apps/android-tv/src/library.css')})()`)
   for(const tab of ['按键','显示','音频','其他']){
    await click(tab);await until(`document.querySelector('.console-settings-modal [role=tab][aria-selected=true]')?.textContent.trim()===${JSON.stringify(tab)}`,'settings tab '+tab)
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"),true,'settings viewport overflow')
    assert.equal(await evaluate("(()=>{const el=document.querySelector('.console-settings-modal [role=tabpanel]'),r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()"),true,'settings body geometry')
   }
   assert.equal(await evaluate("!!document.querySelector('.console-settings-modal input[type=url]')"),false,'source configuration removed')
   const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(root,`.tmp/console-settings-${system}-${width}.png`),Buffer.from(screenshot.data,'base64'))
  }
  await evaluate("document.documentElement.classList.remove('android-tv')")
  await send('Emulation.clearDeviceMetricsOverride')
  await click('按键');await evaluate("document.querySelector('.console-settings-modal .arcade-key-row button').click()")
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'n',code:'KeyN',windowsVirtualKeyCode:78});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'n',code:'KeyN',windowsVirtualKeyCode:78})
  await until(`JSON.parse(localStorage.getItem('console:${system}:settings')).keymaps[0].up==='KeyN'`,'keyboard rebinding')
  await click('恢复当前玩家默认按键')
  await evaluate("document.querySelector('.console-settings-modal .arcade-key-row button').click()")
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  assert.ok(await evaluate("!!document.querySelector('.console-settings-modal')"),'Esc cancels capture without closing settings')
  await click('编辑布局');await until("document.querySelector('.console-touch.editing')",'layout editor before game')
  await click('返回');await until("document.querySelector('.console-settings-modal .player-settings')",'return from layout editor')
  await click('显示');await evaluate("document.querySelector('.console-settings-modal .remote-select').click()");await until("document.querySelector('.rs-popup')",'display select popup')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await until("!document.querySelector('.rs-popup')",'Esc closes select first');assert.ok(await evaluate("!!document.querySelector('.console-settings-modal')"),'settings remains after select back')
  await evaluate("document.querySelector('.console-settings-modal .s-icon-close').click()")
  await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')", 'close settings returns directly to lobby')
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
    await delay(100)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, system + ' lobby viewport overflow')
  }
  await send('Emulation.clearDeviceMetricsOverride')
  if (system === 'gba') {
    await selectLobbyTab(system)
    await evaluate("sessionStorage.setItem('console-test-catalog-failure', 'gba'); sessionStorage.setItem('console-test-hold-catalog', 'gba')")
    const oldDocument = await evaluate('window.__consoleTestDocument')
    await send('Page.reload')
    await until(`window.__consoleTestDocument && window.__consoleTestDocument !== ${oldDocument} && document.querySelector('.game-lobby h1')`, 'reloaded lobby')
    await selectLobbyTab(system)
    await until("window.__releaseCatalogRequest && document.querySelectorAll('.game-card').length === 36", 'disk cache is visible before network settles')
    await evaluate("sessionStorage.removeItem('console-test-hold-catalog'); window.__releaseCatalogRequest()")
    await until("document.querySelector('.lobby-status')?.textContent.includes('正在显示上次的目录')", 'refresh failure status')
    assert.equal(await evaluate("document.querySelectorAll('.game-card').length"), pageSize, 'keep cached list on refresh failure')
    await evaluate("sessionStorage.removeItem('console-test-catalog-failure'); sessionStorage.setItem('console-test-invalid-catalog', 'gba')")
    await click('重试')
    await until("document.querySelector('.lobby-status')?.textContent.includes('正在显示上次的目录')", 'invalid response preserves catalog')
    await evaluate("sessionStorage.removeItem('console-test-invalid-catalog')")
    await click('重试')
    await until("!document.querySelector('.lobby-status')", 'refresh retry')
    await evaluate("sessionStorage.setItem('console-test-slow-download', '1')")
    await lobbyGame(system)
    await until("document.querySelector('.library-loading button')", 'cancellable loading')
    await click('取消')
    await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')", 'cancel load returns to lobby')
    await evaluate("sessionStorage.removeItem('console-test-slow-download')")
  }
  await lobbyGame(system)
  await until("document.querySelector('.console-player.in-game') || document.querySelector('.player-entry-error')",'first tagged-ROM launch '+system,60000)
  assert.equal(await evaluate("document.querySelector('.player-entry-error [role=alert]')?.textContent || ''"),'','tagged catalog ROM must persist before launch')
  await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'launch '+system,60000)
  const cached=await evaluate(`(async()=>{
   const { getGame, sha256 }=await import('/@fs/'+${JSON.stringify(root)}+'/packages/console/src/store.ts')
   const game=await getGame(${JSON.stringify(system)},${JSON.stringify(fixtures[system][0].sha256)})
   return {tags:game.tags,size:game.file.size,sha256:await sha256(await game.file.arrayBuffer())}
  })()`)
  assert.deepEqual(cached.tags,fixtures[system][0].tags,'tag metadata survives IndexedDB persistence')
  assert.equal(cached.size,fixtures[system][0].file_size,'cached ROM size is unchanged')
  assert.equal(cached.sha256,fixtures[system][0].sha256,'cached ROM bytes are unchanged')
  await delay(600);console.log(system,'launched',await evaluate("({w:document.querySelector('canvas').width,h:document.querySelector('canvas').height,notice:document.querySelector('.console-notice')?.textContent})"))
  if (system === 'gba') {
    await assertGameColor([1, 0, 0], 'cold boot renders red')
    await pressGameKey('x', 'KeyX', 88)
    await assertGameColor([0, 0, 1], 'manual save position renders blue')
  }
  await evaluate("document.querySelector('.console-pause').click()")
  await until("document.querySelector('.console-pause-overlay')",'pause')
  await click('保存进度');await until("document.body.innerText.includes('进度已保存')",'save')
  await click('读取进度')
  await until("document.querySelector('.player-save-list img')?.naturalWidth > 0", 'saved screenshot ' + system)
  assert.equal(await evaluate("document.querySelectorAll('.save-list-card').length"), 1)
  await saveCardPointer();await until("document.body.innerText.includes('进度已读取')",'restore')
  await until("!document.querySelector('.console-pause-overlay, .player-save-list')", 'in-game read restores and automatically resumes')
  if (system === 'gba') {
    await pressGameKey('z', 'KeyZ', 90)
    await assertGameColor([0, 1, 0], 'quick save position renders green')
  }
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'F8',code:'F8',windowsVirtualKeyCode:119});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'F8',code:'F8',windowsVirtualKeyCode:119})
  await until("document.body.innerText.includes('进度已保存')",'quick save')
  await evaluate("document.querySelector('.console-pause').click()")
  await click('读取进度')
  await until("Array.from(document.querySelectorAll('.player-save-list img')).filter(img=>img.naturalWidth>0).length === 2", 'quick save screenshot ' + system)
  await clickSaveBackdrop()
  await click('返回游戏库')
  await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')",'return library')
  await lobbyGameSaves(system)
  await until("Array.from(document.querySelectorAll('.player-save-list img')).filter(img=>img.naturalWidth>0).length === 2", 'persisted screenshots from lobby')
  const preview = await send('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(root,`.tmp/console-saves-${system}.png`),Buffer.from(preview.data,'base64'))
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27})
  await until(`!document.querySelector('.player-save-list') && document.activeElement.closest('.game-card')?.dataset.lobbyFocus === 'game:${system}:${fixtures[system][0].sha256}'`, 'Esc closes save modal and restores card focus')
  await lobbyGameSaves(system)
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'BrowserBack',code:'BrowserBack',bubbles:true,cancelable:true}))")
  await until("!document.querySelector('.player-save-list') && location.pathname === '/index.html'", 'Back closes save modal without navigation')
  await evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('console-library')
    request.onsuccess=()=>{
      const db=request.result, tx=db.transaction('states','readwrite'), store=tx.objectStore('states')
      const records=store.getAll()
      records.onsuccess=()=>{
        const oldSave=records.result.find(state=>state.system===${JSON.stringify(system)} && state.kind==='quick')
        delete oldSave.preview
        store.put(oldSave)
      }
      tx.oncomplete=()=>{db.close();resolve()}
      tx.onerror=()=>{db.close();reject(tx.error)}
    }
    request.onerror=()=>reject(request.error)
  })`)
  await lobbyGameSaves(system)
  await until("document.querySelector('.save-list-card .save-preview span:only-child')?.textContent === '暂无截图'", 'old save fallback')
  await saveCardPointer()
  await until("document.querySelector('.console-player.in-game')&&!document.querySelector('.library-loading')&&!document.querySelector('.player-save-list')",'load save from lobby',60000)
  if (system === 'gba') {
    await delay(300)
    await assertGameColor([0, 1, 0], 'lobby read restores the selected quick save position')
  }
  await evaluate("document.querySelector('.console-pause').click()")
  await click('返回游戏库')
  await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')",'return after lobby restore')
  if(system==='gba'){
   await lobbyGameSaves(system)
   await until("document.querySelectorAll('.save-card-trigger').length === 2", 'manual and quick save cards')
   await saveCardPointer(false, 1)
   await until("document.querySelector('.console-player.in-game')&&!document.querySelector('.library-loading')", 'load manual GBA save')
   await delay(300)
   await assertGameColor([0, 0, 1], 'lobby read restores the selected manual save position')
   await evaluate("document.querySelector('.console-pause').click()")
   await click('返回游戏库')
   await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')", 'return after manual restore')
   await evaluate(`(async()=>{
     const {listStates, putState} = await import('/@fs/'+${JSON.stringify(root)}+'/packages/console/src/store.ts')
     const key = ${JSON.stringify(fixtures.gba[0].sha256)}
     const [quick] = await listStates('gba', key)
     const unsupportedState = new Uint8Array([82, 65, 83, 84, 65, 84, 69, 255])
     await putState('gba', key, quick.build, 'quick', quick.label, unsupportedState, quick.gameName)
   })()`)
   await lobbyGameSaves(system)
   await saveCardPointer()
   await until("document.querySelector('.player-entry-error') || document.querySelector('.console-player.in-game')", 'incompatible snapshot result')
   assert.ok(await evaluate("document.querySelector('.player-entry-error [role=alert]')?.textContent.includes('存档')"), 'rejected save must show an error instead of booting from the beginning')
   await click('返回游戏大厅')
   await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')", 'return after restore error')
   await lobbyGameSaves(system, 1)
   await until("document.querySelector('.save-list-empty')?.textContent === '这个游戏还没有存档'", 'other games are excluded')
   const blank = await evaluate("const rect=document.querySelector('.player-save-list').getBoundingClientRect();({x:rect.right-10,y:rect.bottom-10})")
   await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...blank, button: 'left', clickCount: 1 })
   await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...blank, button: 'left', clickCount: 1 })
   await until("!document.querySelector('.player-save-list')", 'click inside blank area closes empty save modal')
   await lobbyGame(system, 1)
   await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'GB launch',60000)
   await evaluate("document.querySelector('.console-pause').click()")
   await click('读取进度')
   await click('新建存档')
   await until("document.querySelector('.player-save-list img')?.naturalWidth > 0", 'create with screenshot inside list')
   assert.equal(await evaluate("document.querySelector('.save-list-card button').textContent.trim()"), '', 'no visible card action button')
   await saveCardPointer(true)
   assert.equal(await evaluate("!!document.querySelector('.player-save-list[open]')"), true, 'long press release keeps save list open')
   assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.save-card-menu[open] button'),button=>button.textContent.trim())"), ['重命名', '删除'])
   await click('重命名')
   await evaluate("const input=document.querySelector('.save-card-menu[open] input');input.value='GB checkpoint';input.dispatchEvent(new Event('input',{bubbles:true}))")
   await click('保存名称')
   await until("document.querySelector('.save-list-card h2')?.textContent === 'GB checkpoint'", 'rename save')
   await saveCardMenu()
   await click('删除')
   await click('确认删除')
   await until("document.querySelector('.save-list-empty')?.textContent === '这个游戏还没有存档'", 'delete save')
  }
  if(system==='sfc'){
   await lobbyGame(system, 1);await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'battery launch');await delay(500)
   await evaluate("document.querySelector('.console-pause').click()");await click('返回游戏库');await until("location.pathname === '/index.html' && document.querySelector('.game-lobby')",'battery return')
   const battery=await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('console-library');r.onsuccess=()=>{const q=r.result.transaction('battery').objectStore('battery').getAll();q.onsuccess=()=>resolve(q.result.map(entry=>({key:entry.key,size:entry.data.size})));q.onerror=()=>reject(q.error)}})`)
   assert.ok(battery.some(entry=>entry.key.startsWith('sfc:')&&entry.size>0),'SFC battery persistence')
   await lobbyPlatformSettings(system);await click('其他')
   await evaluate("const input=document.querySelector('input[type=file]'),data=new DataTransfer(),fixture=window.__consoleFixtures.sfc[0];const bytes=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));bytes[0x7fc0]^=1;data.items.add(new File([bytes],'imported.sfc'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))")
   await until("document.querySelector('.console-settings-modal [role=status]')?.textContent.includes('已导入')",'local import')
   await evaluate("document.querySelector('.console-settings-modal .s-icon-close').click()")
   await selectLobbyTab('mine')
   await until("document.querySelector('.lobby-grid').innerText.includes('imported')", 'imported ROM visible in My Games')
   await evaluate("document.querySelector('.lobby-grid .game-launch').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))");await until("document.querySelector('.game-card-menu[open]')",'game actions');await click('收藏游戏');await until("document.querySelector('.favorite-mark')",'favorite')
  }
  console.log(system,'save/load, quick save and relaunch passed')
 }
 const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});fs.writeFileSync(path.join(root,'.tmp/console-library-check.png'),Buffer.from(screenshot.data,'base64'))
 assert.deepEqual(errors,[]);console.log('PASS real WASM browser smoke tests')
}
main().catch(error=>{console.error(error);console.error('Runtime errors:',JSON.stringify(errors));process.exitCode=1}).finally(async()=>{socket?.close();for(const child of children)child.kill();await delay(200);fs.rmSync(profile,{recursive:true,force:true})})
