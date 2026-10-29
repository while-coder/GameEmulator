<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import fbaLicense from './assets/cores/FBA-LICENSE.txt?raw'
import retroarchLicense from './assets/cores/RETROARCH-COPYING.txt?raw'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import TouchControls from './components/TouchControls.vue'
import RomStorePanel from './components/RomStorePanel.vue'
import type { ArcadeCatalog, CatalogGame } from './store/catalog'
import { ArcadeRunner } from './emulator/runner'
import { ACTIONS, bindKey, defaultKeymap, keyLabel, settings, type Action } from './emulator/settings'
import { CORE_BUILD, bundleKey, getSnapshot, importArchive, listArchives, listSnapshots, pickArchives, putSnapshot, removeArchive, removeSnapshot, type Archive, type Snapshot } from './store/library'
import { prepareCatalogGame, prepareGame, type DependencyProgress } from './store/dependencies'
import { useArcadeInput } from './composables/useArcadeInput'
import { useFullscreen } from './composables/useFullscreen'
import { navEnabled, useRemoteNav } from './composables/useRemoteNav'

const props=defineProps<{onLeave:()=>void|Promise<void>}>()
const canvas=ref<HTMLCanvasElement|null>(null)
const display=ref<HTMLElement|null>(null)
const root=ref<HTMLElement|null>(null)
const fullscreenRoot=computed(()=>root.value?.ownerDocument.documentElement??null)
const fullscreen=useFullscreen(fullscreenRoot)
const runner=shallowRef<ArcadeRunner|null>(null)
const menuOpen=ref(true),busy=ref(false),leaving=ref(false)
const tab=ref<'library'|'saves'|'keys'|'display'>('library')
const tabs=[{id:'library',label:'游戏库'},{id:'saves',label:'存档'},{id:'keys',label:'按键'},{id:'display',label:'显示与声音'}] as const
const archives=ref<Archive[]>([]),snapshots=ref<Snapshot[]>([])
const games=computed(()=>archives.value.filter(a=>a.kind==='game').sort((a,b)=>b.importedAt-a.importedAt))
const current=shallowRef<Archive|null>(null)
const currentDependencies=shallowRef<Archive[]>([])
const loaded=computed(()=>!!current.value&&!!runner.value?.loaded)
const enabled=computed(()=>loaded.value&&!menuOpen.value&&!busy.value&&!leaving.value)
const input=useArcadeInput(runner,enabled)
const player=ref(0)
const capturing=ref<Action|null>(null)
const error=ref(''),message=ref('')
const progress=ref<DependencyProgress|null>(null)
const retryAction=shallowRef<(()=>Promise<void>)|null>(null)
const downloads=new AbortController()
const progressText=computed(()=>progress.value?`正在下载 ${progress.value.name} · ${Math.floor(progress.value.received/progress.value.total*100)}%`:'正在处理，请稍候…')
let messageTimer: ReturnType<typeof setTimeout>|undefined
function notify(text:string){message.value=text;clearTimeout(messageTimer);messageTimer=setTimeout(()=>{message.value=''},2200)}
async function task(action:()=>Promise<void>){
  if(busy.value||leaving.value)return
  busy.value=true;error.value='';retryAction.value=null
  try{await action()}catch(err){if(!downloads.signal.aborted){error.value=err instanceof Error?err.message:String(err);retryAction.value=action;menuOpen.value=true}}
  finally{busy.value=false;progress.value=null}
}
async function refresh(){[archives.value,snapshots.value]=await Promise.all([listArchives(),listSnapshots()])}
async function importFiles(){
  const files=await pickArchives()
  if(!files.length)return
  await task(async()=>{
    let count=0
    try{for(const file of files){await importArchive(file,'game');count++}}
    finally{await refresh()}
    notify(`已导入 ${count} 个文件`)
  })
}
async function startGame(source:Archive,snapshot?:Snapshot){
  const {game,dependencies}=await prepareGame(source,{signal:downloads.signal,onProgress:value=>{progress.value=value}})
  await loadPreparedGame(game,dependencies,snapshot)
}
async function loadPreparedGame(game:Archive,dependencies:Archive[],snapshot?:Snapshot){
  if(snapshot&&bundleKey(game,dependencies)!==snapshot.key)throw new Error('存档所需的依赖版本与当前目录不一致，无法读取此存档')
  progress.value=null
  await refresh()
  current.value=null;input.releaseAll()
  await runner.value!.load(game,dependencies)
  current.value=game;currentDependencies.value=dependencies
  await nextTick();measure()
}
async function play(game:Archive){await task(async()=>{await startGame(game);menuOpen.value=false})}
async function remoteGame(entry:CatalogGame,catalog:ArcadeCatalog,launch:boolean){
  await task(async()=>{
    try{
      const {game,dependencies}=await prepareCatalogGame(entry,catalog,{signal:downloads.signal,onProgress:value=>{progress.value=value}})
      if(launch){await loadPreparedGame(game,dependencies);menuOpen.value=false}
      else notify('游戏及依赖已下载')
    }finally{await refresh()}
  })
}
async function deleteGame(game:Archive){await task(async()=>{await removeArchive(game.id);await refresh()})}
async function save(){
  const game=current.value
  if(!game||!runner.value?.loaded)throw new Error('请先启动游戏')
  const dependencies=currentDependencies.value
  const state=await runner.value.save()
  await putSnapshot({key:bundleKey(game,dependencies),gameName:game.name,gameHash:game.hash,dependencies:dependencies.map(d=>({name:d.name,hash:d.hash})),coreBuild:CORE_BUILD,state,savedAt:Date.now()})
  snapshots.value=await listSnapshots()
  notify('已快速存档')
}
async function restore(snapshot:Snapshot){
  if(snapshot.coreBuild!==CORE_BUILD)throw new Error('此存档不属于当前街机核心版本')
  const game=games.value.find(g=>g.hash===snapshot.gameHash)
  if(!game)throw new Error(`请先导入存档对应的原始游戏包 ${snapshot.gameName}`)
  if(!current.value||bundleKey(current.value,currentDependencies.value)!==snapshot.key){await startGame(game,snapshot)}
  await runner.value!.restore(snapshot.state)
  menuOpen.value=false;notify('已读取存档')
}
async function quickRestore(){
  if(!current.value)throw new Error('请先启动游戏')
  const snapshot=await getSnapshot(bundleKey(current.value,currentDependencies.value))
  if(!snapshot)throw new Error('当前游戏还没有快速存档')
  await restore(snapshot)
}
function stop(){input.releaseAll();runner.value?.dispose();current.value=null;currentDependencies.value=[];menuOpen.value=true;tab.value='library'}
async function leave(){
  if(busy.value||leaving.value)return
  leaving.value=true;stop()
  try{await props.onLeave()}catch(err){error.value=String(err)}finally{leaving.value=false}
}
function nativeBack(): 'handled'{
  if(busy.value||leaving.value)return 'handled'
  if(menuOpen.value)menuOpen.value=false
  else if(loaded.value)stop()
  else void leave()
  return 'handled'
}
function shellKey(event:KeyboardEvent){
  const saveKey=event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.metaKey&&event.code==='KeyS'
  if(event.code==='Escape'||event.code==='F11'||saveKey){
    event.preventDefault();event.stopImmediatePropagation()
    if(event.repeat||busy.value||leaving.value)return
    if(event.code==='F11'){void fullscreen.toggle();return}
    if(event.code==='Escape'){capturing.value=null;menuOpen.value=!menuOpen.value;return}
    if(!menuOpen.value)void task(save)
    return
  }
  if(capturing.value&&menuOpen.value){
    event.preventDefault();event.stopImmediatePropagation()
    if(!event.repeat&&!event.ctrlKey&&!event.altKey&&!event.metaKey){bindKey(player.value,capturing.value,event.code);capturing.value=null}
  }
}
// The shell owns these keys before menu navigation or the game sees them.
if(typeof window!=='undefined')window.addEventListener('keydown',shellKey,true)
const panel=ref<HTMLElement|null>(null)
useRemoteNav({container:panel,active:computed(()=>navEnabled.value&&menuOpen.value&&!capturing.value),onBack:()=>{menuOpen.value=false},autoFocus:true,priority:10})
watch([menuOpen,busy,current],()=>{
  if(menuOpen.value||busy.value)runner.value?.pause()
  else runner.value?.resume()
},{flush:'sync'})
watch(()=>settings.muted,value=>runner.value?.setMuted(value))
watch([menuOpen,tab,player],()=>{capturing.value=null})

const frameSize=ref({width:'100%',height:'100%'})
function measure(){
  const container=display.value
  if(!container)return
  const nativeAspect=runner.value?.aspectRatio??4/3
  const aspect=settings.aspect==='auto'?nativeAspect:settings.aspect==='4:3'?4/3:3/4
  let width=container.clientWidth,height=width/aspect
  if(height>container.clientHeight){height=container.clientHeight;width=height*aspect}
  frameSize.value={width:`${Math.floor(width)}px`,height:`${Math.floor(height)}px`}
  if(width>0&&height>0)runner.value?.resize(Math.floor(width),Math.floor(height))
}
watch(()=>settings.aspect,()=>nextTick(measure))
const touchVisible=computed(()=>settings.touch!=='never')
let resize:ResizeObserver|null=null,mutation:MutationObserver|null=null
const blurCanvas=()=>canvas.value?.blur()
function pageHide(){downloads.abort();input.releaseAll();runner.value?.dispose()}
onMounted(()=>{
  runner.value=new ArcadeRunner(canvas.value!)
  runner.value.setMuted(settings.muted)
  canvas.value!.addEventListener('focus',blurCanvas)
  resize=new ResizeObserver(measure);resize.observe(display.value!)
  mutation=new MutationObserver(measure);mutation.observe(canvas.value!,{attributes:true,attributeFilter:['width','height']})
  window.addEventListener('pagehide',pageHide)
  ;(window as Window&{__handleAndroidBack?:()=>string}).__handleAndroidBack=nativeBack
  measure();void task(refresh)
})
onBeforeUnmount(()=>{
  downloads.abort()
  clearTimeout(messageTimer);resize?.disconnect();mutation?.disconnect()
  window.removeEventListener('keydown',shellKey,true);window.removeEventListener('pagehide',pageHide)
  canvas.value?.removeEventListener('focus',blurCanvas)
  delete (window as Window&{__handleAndroidBack?:()=>string}).__handleAndroidBack
  runner.value?.dispose()
})
const PAD_LABELS:Record<number,string>={0:'A / ×',1:'B / ○',2:'X / □',3:'Y / △',4:'LB / L1',5:'RB / R1',8:'Select / Back',9:'Start',12:'↑',13:'↓',14:'←',15:'→'}
const time=(value:number)=>new Date(value).toLocaleString()
</script>

<template>
  <div ref="root" class="arcade-app" :class="{'is-pseudo-fullscreen':fullscreen.isFullscreen.value&&fullscreen.usePseudo.value}">
    <header class="arcade-toolbar">
      <SButton :disabled="busy||leaving" @click="leave">返回模拟器列表</SButton>
      <span class="arcade-title">街机</span>
      <SButton class="desktop-only" @click="fullscreen.toggle">{{fullscreen.isFullscreen.value?'退出全屏':'全屏'}}</SButton>
      <SButton @click="menuOpen=true">菜单</SButton>
    </header>
    <main class="arcade-stage" :class="{'has-touch':touchVisible,'always-controls':settings.touch==='always'}">
      <div ref="display" class="arcade-display">
        <div class="arcade-frame" :style="frameSize"><canvas ref="canvas" :style="{imageRendering:settings.smoothing?'auto':'pixelated'}" tabindex="-1" /></div>
        <div v-if="!loaded" class="arcade-empty"><strong>街机时光，随时开始</strong><span>在游戏库中选择游戏，自动下载后投币开始。</span><SButton @click="menuOpen=true">打开游戏库</SButton></div>
      </div>
      <TouchControls v-if="touchVisible" class="arcade-touch" :class="{'touch-always':settings.touch==='always'}" :disabled="!enabled" @menu="menuOpen=true" @save="task(save)" @press="(action,source)=>input.press(0,action,source)" @release="(action,source)=>input.release(0,action,source)" />
    </main>
    <footer class="arcade-status"><span>{{current?.name??'未载入游戏'}}</span><span v-if="busy">处理中…</span><span v-else>街机 · FB Alpha 2012</span></footer>
    <div v-if="message" class="arcade-toast" role="status">{{message}}</div>

    <SModal v-model:show="menuOpen" title="街机 · 设置" width="1040px" fill-height class="player-modal arcade-modal" :close-on-esc="false" :body-scrollable="false">
      <div ref="panel" class="arcade-menu">
        <nav class="arcade-tabs" aria-label="街机设置分类"><SButton v-for="item in tabs" :key="item.id" :class="{selected:tab===item.id}" @click="tab=item.id">{{item.label}}</SButton></nav>
        <div v-if="error" class="arcade-error" role="alert">{{error}} <SButton v-if="retryAction" :disabled="busy" @click="task(retryAction!)">重试</SButton></div>
        <p v-if="busy" class="arcade-progress" role="status">{{progressText}}</p>
        <fieldset class="arcade-content" :class="{'library-content':tab==='library'}" :disabled="busy||leaving">
          <RomStorePanel v-if="tab==='library'" :archives="archives" :busy="busy||leaving" :progress="progress"
            :play="(game,catalog)=>remoteGame(game,catalog,true)" :download="(game,catalog)=>remoteGame(game,catalog,false)"
            :play-cached="play" :remove="deleteGame" :import-files="importFiles" />

          <section v-else-if="tab==='saves'">
            <div class="arcade-actions"><SButton :disabled="!loaded" @click="task(save)">快速存档</SButton><SButton :disabled="!loaded" @click="task(quickRestore)">读取当前游戏存档</SButton></div>
            <SHint>每个游戏版本保留一个快速存档，保存时覆盖。读取时自动启动对应游戏并补齐缺失依赖；需保留原始游戏包。</SHint>
            <p v-if="!snapshots.length" class="library-empty">还没有存档。</p>
            <article v-for="snapshot in [...snapshots].sort((a,b)=>b.savedAt-a.savedAt)" :key="snapshot.key" class="game-row game-summary"><div><strong>{{snapshot.gameName}}</strong><small>{{time(snapshot.savedAt)}}</small></div><div class="row-actions"><SButton @click="task(()=>restore(snapshot))">读取</SButton><SButton @click="task(async()=>{await removeSnapshot(snapshot.key);await refresh()})">删除</SButton></div></article>
          </section>

          <section v-else-if="tab==='keys'" class="keys-page">
            <section class="keyboard-help"><h3>快捷键</h3><dl><dt><kbd>Esc</kbd></dt><dd>开启 / 关闭设置，自动暂停 / 继续游戏。</dd><dt><kbd>Ctrl+S</kbd></dt><dd>快速存档。</dd><dt><kbd>F11</kbd></dt><dd>全屏 / 窗口切换。</dd></dl></section>
            <div class="arcade-actions"><SButton v-for="(_,i) in settings.players" :key="i" :class="{selected:player===i}" @click="player=i">玩家 {{i+1}}</SButton></div>
            <SHint>六键为 Y / X / L、B / A / R 两排布局，投币后按开始。手柄按连接顺序分配给两位玩家，左摇杆与十字键均可控制方向；游戏按核心默认布局映射。</SHint>
            <div class="arcade-key-row key-heading"><span>操作</span><span>键盘（点击修改）</span><span>标准手柄</span></div>
            <div v-for="action in ACTIONS" :key="action.id" class="arcade-key-row"><span>{{action.label}}</span><SButton :class="{selected:capturing===action.id}" @click="capturing=action.id">{{capturing===action.id?'按下新按键…':keyLabel(settings.players[player][action.id])}}</SButton><span>{{PAD_LABELS[action.pad]}}</span></div>
            <SButton @click="settings.players[player]=defaultKeymap(player)">恢复当前玩家默认按键</SButton>
          </section>

          <section v-else class="display-page">
            <label>画面比例<select v-model="settings.aspect"><option value="auto">自动（跟随游戏方向）</option><option value="4:3">4:3 横屏</option><option value="3:4">3:4 竖屏</option></select></label>
            <label>画面平滑<input v-model="settings.smoothing" type="checkbox" /></label>
            <label>静音<input v-model="settings.muted" type="checkbox" /></label>
            <label>触屏手柄<select v-model="settings.touch"><option value="auto">自动</option><option value="always">始终显示</option><option value="never">不显示</option></select></label>
            <div class="arcade-actions"><SButton :disabled="!loaded" @click="runner?.reset()">复位游戏</SButton><SButton :disabled="!loaded" @click="stop">中止游戏</SButton><SButton @click="fullscreen.toggle">{{fullscreen.isFullscreen.value?'退出全屏':'全屏'}}</SButton></div>
            <details class="core-licenses"><summary>开源许可</summary><h4>FB Alpha 2012</h4><pre>{{fbaLicense}}</pre><h4>RetroArch</h4><pre>{{retroarchLicense}}</pre></details>
          </section>
        </fieldset>
      </div>
    </SModal>
  </div>
</template>

<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#1a1a1a;color:#e8e8e8}*{box-sizing:border-box}html,body,#app{height:100%;margin:0}body{overflow:hidden}button,select,input{font:inherit}button{cursor:pointer}button:disabled{cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #82b1ff;outline-offset:3px}
</style>
<style scoped>
.arcade-app{height:100dvh;display:flex;flex-direction:column;background:#1a1a1a}.is-pseudo-fullscreen{position:fixed;inset:0;z-index:2000}
.arcade-toolbar{display:flex;align-items:center;gap:8px;padding:10px max(12px,env(safe-area-inset-right)) 10px max(12px,env(safe-area-inset-left));background:#242424;border-bottom:1px solid #343434;flex-shrink:0}.arcade-title{font-size:14px;color:#bbb;margin-right:auto}
.arcade-stage{display:flex;flex-direction:column;position:relative;flex:1;min-height:0;padding:12px}.arcade-display{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}.arcade-frame{background:#000;flex-shrink:0;overflow:hidden;border-radius:8px}.arcade-frame canvas{display:block;width:100%!important;height:100%!important;outline:none}
.arcade-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:16px;text-align:center;padding:24px;color:#bbb;font-size:14px}.arcade-empty strong{font-size:22px;color:#eee}
.arcade-status{display:flex;justify-content:space-between;gap:12px;padding:8px 16px;background:#242424;border-top:1px solid #343434;color:#aaa;font-size:12px}.arcade-touch{display:none}.arcade-touch.touch-always{display:block}.arcade-toast{position:fixed;z-index:3000;bottom:30px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;background:#101114eb;color:#eee;pointer-events:none}
.arcade-menu{display:flex;flex-direction:column;min-height:0;height:100%}.arcade-tabs{display:flex;gap:6px;padding:12px;overflow-x:auto;flex-shrink:0}.arcade-tabs :deep(button){flex-shrink:0}.selected{background:#383e4c!important;border-color:#82a4dc!important}
.arcade-error{margin:0 12px 10px;padding:12px;background:#482c30;border:1px solid #8d545a;border-radius:6px;color:#ffccd0;line-height:1.6;font-size:13px;overflow-wrap:anywhere}.arcade-progress{padding:0 16px;color:#bbb;font-size:13px}
.arcade-content{min-width:0;min-height:0;flex:1;border:0;padding:4px 16px 20px;margin:0;overflow:auto}.arcade-content section{max-width:760px;margin:0 auto}.arcade-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 14px}
.arcade-content.library-content{display:flex;flex-direction:column;padding:0;overflow:hidden}.library-content :deep(.store-panel){max-width:none;width:100%;margin:0}.library-empty{padding:36px 12px;text-align:center;color:#aaa;line-height:1.6}
.game-row{border:1px solid #414141;border-radius:8px;padding:14px;margin-top:12px;background:#282828}.game-summary{display:flex;justify-content:space-between;align-items:center;gap:12px}.game-summary>div:first-child{min-width:0}.game-row strong{font-size:15px;overflow-wrap:anywhere}.game-row small{display:block;margin-top:7px;color:#aaa;font-size:12px}.row-actions{display:flex;gap:8px;flex-shrink:0}
.keys-page h3{font-size:14px;margin:8px 0 14px}.keyboard-help{border-bottom:1px solid #414141;padding-bottom:16px;margin-bottom:20px!important}.keyboard-help dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;margin:0;line-height:1.6;font-size:13px}.keyboard-help dd{margin:0;color:#bbb}.keyboard-help kbd{background:#333;border:1px solid #555;border-radius:4px;padding:3px 6px}.arcade-key-row{display:grid;grid-template-columns:60px minmax(110px,1fr) minmax(90px,1fr);gap:12px;align-items:center;margin:10px 0;font-size:13px}.key-heading{color:#aaa;margin-top:18px}
.core-licenses{margin-top:24px;color:#aaa;font-size:12px}.core-licenses summary{cursor:pointer;min-height:32px}.core-licenses pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;padding:12px;border:1px solid #444;line-height:1.5}
.display-page>label{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:60px;border-bottom:1px solid #343434}.display-page select{background:#292929;color:#eee;border:1px solid #555;border-radius:6px;padding:8px;max-width:65%}.display-page input{width:20px;height:20px}
@media(pointer:coarse){.desktop-only,.keyboard-help{display:none}.arcade-touch{display:block}.arcade-stage{padding:8px}.arcade-toolbar{padding-top:max(8px,env(safe-area-inset-top));padding-bottom:8px}.arcade-toolbar :deep(button){min-height:44px}.arcade-status{display:none}.arcade-tabs{gap:4px;padding:8px}.arcade-content{padding-inline:10px}.game-summary{flex-wrap:wrap}.row-actions{margin-left:auto}.arcade-key-row{gap:8px;grid-template-columns:46px minmax(105px,1fr) minmax(75px,1fr)}}
@media(pointer:coarse) and (orientation:landscape){.arcade-stage{padding:0}.arcade-toolbar{padding-block:4px}.arcade-touch{position:absolute}.arcade-frame{border-radius:0}}
@media(orientation:portrait){
  .arcade-stage.always-controls{display:grid;grid-template-rows:repeat(2,minmax(0,1fr))}
  .arcade-touch.touch-always{display:grid}
}
@media(pointer:coarse) and (orientation:portrait){
  .arcade-stage.has-touch{display:grid;grid-template-rows:repeat(2,minmax(0,1fr))}
  .arcade-touch{display:grid}
}
</style>
