const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..'), children = [], pending = new Map(), errors = []
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'console-browser-'))
let socket, sessionId, sequence = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
function send(method, params={}, session=sessionId) { const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params,...(session?{sessionId:session}:{})}))}) }
async function evaluate(expression) { const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value }
async function until(expression,label,timeout=30000) { const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(expression))return;await delay(100)}throw new Error(label+': '+await evaluate('document.body.innerText')) }
// Original, generated test cartridges; no commercial ROMs or BIOS required.
const gba = Buffer.alloc(32768)
gba.writeUInt32LE(0xeafffffe, 0) // ARM: branch to self.
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
for(const games of Object.values(fixtures))for(const game of games){const bytes=Buffer.from(game.data,'base64');game.sha256=crypto.createHash('sha256').update(bytes).digest('hex');game.file_size=bytes.length;game.download_url='https://console.test/'+game.file_name}
function inject(fixtures){
 window.__consoleFixtures=fixtures
 const system=location.pathname.includes('sfc')?'sfc':'gba';localStorage.setItem(`console:${system}:source`,'https://console.test/catalog.json')
 const original=window.fetch;window.fetch=async function(input,options){const url=String(input instanceof Request?input.url:input);if(url.startsWith('https://console.test/')){const games=fixtures[system];if(url.endsWith('catalog.json'))return new Response(JSON.stringify({games:games.map(({data,...game})=>game)}));const game=games.find(game=>game.download_url===url);if(game&&window.__slowConsoleDownload)await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,2000);options?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'))},{once:true})});if(game)return new Response(Uint8Array.from(atob(game.data),c=>c.charCodeAt(0)))}return original.apply(this,arguments)}
}
async function click(text){await evaluate(`Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()===${JSON.stringify(text)} && el.getBoundingClientRect().width)?.click()`)}
async function main(){
 const vite=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','18124','--strictPort'],{cwd:path.join(root,'apps/pwa'),stdio:['ignore','pipe','pipe']});children.push(vite)
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:18124/')).ok)break}catch{}await delay(100)}
 const chrome=spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required','about:blank'],{stdio:['ignore','ignore','pipe']});children.push(chrome)
 const browserUrl=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Chrome startup timed out')),15000);chrome.stderr.on('data',data=>{const match=data.toString().match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1])}})})
 socket=new WebSocket(browserUrl);await new Promise(resolve=>socket.addEventListener('open',resolve,{once:true}));socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result)}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails)})
 const {targetId}=await send('Target.createTarget',{url:'about:blank'},null);({sessionId}=await send('Target.attachToTarget',{targetId,flatten:true},null));await send('Page.enable');await send('Runtime.enable');await send('Page.addScriptToEvaluateOnNewDocument',{source:`(${inject})(${JSON.stringify(fixtures)})`})
 for(const system of ['gba','sfc']){
  await send('Page.navigate',{url:`http://127.0.0.1:18124/${system}.html`});await until(`document.querySelectorAll('.console-game').length === ${fixtures[system].length}`,'catalog '+system)
  for(const [width,height] of [[390,844],[844,390]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});await delay(100);assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,system+' viewport overflow')}
  await send('Emulation.clearDeviceMetricsOverride')
  if(system==='gba'){
   await evaluate("window.__slowConsoleDownload=true;document.querySelector('.console-game .game-launch').click()");await until("document.querySelector('.library-loading')",'cancellable loading');await evaluate("document.querySelector('.library-loading button').click()");await until("!document.querySelector('.library-loading')",'cancel loading');assert.equal(await evaluate("!!document.querySelector('.console-player.in-game')"),false);await evaluate('window.__slowConsoleDownload=false')
  }
  assert.ok((await evaluate("document.querySelector('.console-game').innerText")).includes(fixtures[system][0].name))
  await evaluate("document.querySelector('.console-game .game-launch').click()")
  await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'launch '+system,60000)
  await delay(600);console.log(system,'launched',await evaluate("({w:document.querySelector('canvas').width,h:document.querySelector('canvas').height,notice:document.querySelector('.console-notice')?.textContent})"))
  await evaluate("document.querySelector('.console-pause').click()")
  await until("document.querySelector('.console-pause-overlay')",'pause')
  await click('保存进度');await until("document.querySelector('.console-notice')?.textContent.includes('进度已保存')",'save')
  await click('读取进度');await until("document.querySelector('dialog[open] .console-state')",'states')
  assert.equal(await evaluate("document.querySelectorAll('.console-state').length"),1)
  await click('读取');await until("document.querySelector('.console-notice')?.textContent.includes('进度已读取')",'restore')
  await click('继续游戏');await until("!document.querySelector('.console-pause-overlay')",'resume')
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'F8',code:'F8',windowsVirtualKeyCode:119});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'F8',code:'F8',windowsVirtualKeyCode:119})
  await until("document.querySelector('.console-notice')?.textContent.includes('进度已保存')",'quick save')
  await evaluate("document.querySelector('.console-pause').click()");await click('读取进度');await until("document.querySelectorAll('.console-state').length === 2",'quick state')
  await evaluate("document.querySelector('dialog[open] header button').click()");await click('返回游戏库');await until("!document.querySelector('.console-player.in-game')",'return library')
  await evaluate("document.querySelector('.console-game .game-launch').click()");await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'relaunch '+system,60000)
  await evaluate("document.querySelector('.console-pause').click()");await click('返回游戏库');await until("!document.querySelector('.console-player.in-game')",'return again')
  if(system==='gba'){
   await evaluate("document.querySelectorAll('.console-game .game-launch')[1].click()");await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'GB launch',60000)
   await evaluate("document.querySelector('.console-pause').click()");await click('保存进度');await until("document.querySelector('.console-notice')?.textContent.includes('进度已保存')",'GB save')
  }
  if(system==='sfc'){
   await evaluate("document.querySelectorAll('.console-game .game-launch')[1].click()");await until("document.querySelector('.console-player.in-game') && !document.querySelector('.library-loading')",'battery launch');await delay(500)
   await evaluate("document.querySelector('.console-pause').click()");await click('返回游戏库');await until("!document.querySelector('.console-player.in-game')",'battery return')
   const battery=await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('console-library');r.onsuccess=()=>{const q=r.result.transaction('battery').objectStore('battery').getAll();q.onsuccess=()=>resolve(q.result.map(entry=>({key:entry.key,size:entry.data.size})));q.onerror=()=>reject(q.error)}})`)
   assert.ok(battery.some(entry=>entry.key.startsWith('sfc:')&&entry.size>0),'SFC battery persistence')
   await evaluate("const input=document.querySelector('input[type=file]'),data=new DataTransfer(),fixture=window.__consoleFixtures.sfc[0];const bytes=Uint8Array.from(atob(fixture.data),c=>c.charCodeAt(0));bytes[0x7fc0]^=1;data.items.add(new File([bytes],'imported.sfc'));input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}))")
   await until("document.querySelector('.console-notice')?.textContent.includes('已导入')",'local import')
   assert.ok(await evaluate("document.body.innerText.includes('imported')"),'imported ROM visible')
   await evaluate("document.querySelector('.console-game .game-launch').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2}))");await until("document.querySelector('.game-card-menu[open]')",'game actions');await click('收藏游戏');await until("document.querySelector('.game-favorite-mark')",'favorite')
  }
  console.log(system,'save/load, quick save and relaunch passed')
 }
 const screenshot=await send('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(root,'.tmp'),{recursive:true});fs.writeFileSync(path.join(root,'.tmp/console-library-check.png'),Buffer.from(screenshot.data,'base64'))
 assert.deepEqual(errors,[]);console.log('PASS real WASM browser smoke tests')
}
main().catch(error=>{console.error(error);console.error('Runtime errors:',JSON.stringify(errors));process.exitCode=1}).finally(async()=>{socket?.close();for(const child of children)child.kill();await delay(200);fs.rmSync(profile,{recursive:true,force:true})})
