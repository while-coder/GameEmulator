<script setup lang="ts">
import { finishTextEditing } from '../../player-ui/remoteNavigation'
import { useSettingsTab } from '../../player-ui/useSettingsTab'
import PlayerSaveList from '../../player-ui/PlayerSaveList.vue'
import type { SaveListItem } from '../../player-ui/saveList'
import PauseMenu from '../../player-ui/PauseMenu.vue'
import LibraryLoading from '../../player-ui/LibraryLoading.vue'
import PlayerEntryError from '../../player-ui/PlayerEntryError.vue'
import { useLibraryOperation } from '../../player-ui/useLibraryOperation'
import { usePlaySession } from '../../player-ui/usePlayHistory'
import type { PlayerEntry } from '../../player-ui/playerEntry'
import { nextSaveLabel, type SaveKind } from '../../shared/saveSlots'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import fbaLicense from './assets/cores/FBA-LICENSE.txt?raw'
import retroarchLicense from './assets/cores/RETROARCH-COPYING.txt?raw'
import SModal from '@qingfeng346/ui-kit/components/SModal.vue'
import SButton from '@qingfeng346/ui-kit/components/button/SButton.vue'
import SHint from '@qingfeng346/ui-kit/components/SHint.vue'
import SSwitch from '@qingfeng346/ui-kit/components/SSwitch.vue'
import TouchControls from './components/TouchControls.vue'
import RemoteSelect from '../../player-ui/RemoteSelect.vue'
import { findCachedCatalogGame, findCatalogGame } from './store/catalog'
import { createArcadeRunner, type ArcadeRunnerApi } from './emulator/runner'
import { ACTIONS, bindKey, defaultKeymap, keyLabel, settings, type Action, type TouchLayout } from './emulator/settings'
import { CORE_BUILD, bundleKey, getSnapshot, listArchives, listSnapshots, putSnapshot, createSnapshot, renameSnapshot, saveKindOf, snapshotBundleKey, removeSnapshot, type Archive, type Snapshot } from './store/library'
import { prepareCatalogGame, type DependencyProgress } from './store/dependencies'
import { useArcadeInput } from './composables/useArcadeInput'
import { useFullscreen } from './composables/useFullscreen'
import { navEnabled, useRemoteNav } from './composables/useRemoteNav'
import '../../player-ui/player.css'
import '../../player-ui/settings.css'
import '../../player-ui/library.css'

const props=defineProps<{onLeave:()=>void|Promise<void>;entry?:PlayerEntry}>()
const canvas=ref<HTMLCanvasElement|null>(null)
const display=ref<HTMLElement|null>(null)
const root=ref<HTMLElement|null>(null)
const fullscreenRoot=computed(()=>root.value?.ownerDocument.documentElement??null)
const fullscreen=useFullscreen(fullscreenRoot)
const runner=shallowRef<ArcadeRunnerApi|null>(null)
const coreBuild=()=>runner.value?.coreBuild??CORE_BUILD
const currentBundle=(game:Archive, dependencies:Archive[])=>bundleKey(game,dependencies,coreBuild())
const menuOpen=ref(false),busy=ref(false),leaving=ref(false)
const playbackFailed=ref(false)
const {operation,cancelling,cancelOperation,runOperation}=useLibraryOperation()
const layoutEditing=ref(false)
const touchLayoutDraft=ref<TouchLayout>()
const tab=useSettingsTab('arcade')
const tabs=[{id:'keys',label:'按键'},{id:'display',label:'显示'},{id:'audio',label:'音频'},{id:'misc',label:'其他'}] as const
const pauseOpen=ref(false)
const savesOpen=ref(false)
const savePanel=ref<InstanceType<typeof PlayerSaveList>|null>(null)
const pauseMenu=ref<InstanceType<typeof PauseMenu>|null>(null)
function resumeGame(){if(!busy.value&&!leaving.value)pauseOpen.value=false}
function showSettings(){menuOpen.value=true;pauseOpen.value=false}
function openMenu(){if(loaded.value)pauseOpen.value=true;else menuOpen.value=true}
watch(fullscreen.isFullscreen,(value,previous)=>{if(previous&&!value&&loaded.value&&!menuOpen.value)openMenu()})
function editTouchLayout(){touchLayoutDraft.value=JSON.parse(JSON.stringify(settings.touchLayout));layoutEditing.value=true;menuOpen.value=false}
function finishTouchLayout(){tab.value='keys';menuOpen.value=true;layoutEditing.value=false;touchLayoutDraft.value=undefined}
function saveTouchLayout(){if(touchLayoutDraft.value)settings.touchLayout=touchLayoutDraft.value;finishTouchLayout()}
function resetTouchLayout(){if(touchLayoutDraft.value)touchLayoutDraft.value[window.matchMedia('(orientation: portrait)').matches?'portrait':'landscape']={}}
function closeMenu(){
  if(busy.value||leaving.value)return
  if(playbackFailed.value)void leave()
  else menuOpen.value=false
}
const archives=ref<Archive[]>([]),snapshots=ref<Snapshot[]>([])
const currentGameName=computed(()=>current.value?(current.value.displayName||current.value.name.replace(/\.zip$/i,'')):'')
const snapshotGameName=(snapshot:Snapshot)=>archives.value.find(game=>game.hash.toLowerCase()===snapshot.gameHash.toLowerCase())?.displayName||snapshot.gameName.replace(/\.zip$/i,'')
const snapshotName=(snapshot:Snapshot)=>snapshot.label?.trim()||snapshotGameName(snapshot)
const current=shallowRef<Archive|null>(null)
const currentDependencies=shallowRef<Archive[]>([])
const loaded=computed(()=>!!current.value&&!!runner.value?.loaded)
const enabled=computed(()=>loaded.value&&!playbackFailed.value&&!menuOpen.value&&!pauseOpen.value&&!savesOpen.value&&!layoutEditing.value&&!busy.value&&!leaving.value)
usePlaySession('arcade',computed(()=>loaded.value?current.value!.hash:null),enabled)
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
  busy.value=true;error.value=''
  if(retryAction.value!==action)retryAction.value=null
  try{await action();retryAction.value=null}catch(err){if(!downloads.signal.aborted){error.value=err instanceof Error?err.message:String(err);retryAction.value=action;menuOpen.value=true;pauseOpen.value=false}}
  finally{busy.value=false;progress.value=null}
}
async function refresh(){[archives.value,snapshots.value]=await Promise.all([listArchives(),listSnapshots()])}
function checkSnapshot(snapshot: Snapshot, game: Archive, dependencies: Archive[]) {
  if (snapshot.coreBuild !== coreBuild()) throw new Error('此存档不属于当前街机核心版本，原存档已保留')
  if (snapshotBundleKey(snapshot) !== currentBundle(game, dependencies)) {
    throw new Error('存档所需的依赖版本与当前游戏不一致')
  }
}
async function applySnapshot(snapshot: Snapshot, game: Archive, dependencies: Archive[], signal?: AbortSignal) {
  signal?.throwIfAborted()
  checkSnapshot(snapshot, game, dependencies)
  const active = runner.value!
  active.pause()
  await active.restore(snapshot.state, signal)
}
async function loadPreparedGame(game:Archive,dependencies:Archive[],snapshot?:Snapshot,signal=downloads.signal){
  signal.throwIfAborted()
  if(snapshot)checkSnapshot(snapshot,game,dependencies)
  progress.value=null
  await refresh()
  signal.throwIfAborted()
  current.value=null;playbackFailed.value=false;input.releaseAll()
  let stopping:Promise<void>|undefined
  const cancel=()=>{
    stopping=Promise.resolve(runner.value?.dispose())
    void stopping.catch(()=>{}) // Await cleanup below, including native backends.
  }
  signal.addEventListener('abort',cancel,{once:true})
  try{
    await runner.value!.load(game,dependencies)
    signal.throwIfAborted()
    if(snapshot){
      // A loaded ROM does not guarantee that the driver has run its startup frame.
      await runner.value!.waitForFirstFrame(signal)
      await applySnapshot(snapshot, game, dependencies, signal)
    }
    signal.throwIfAborted()
    await nextTick();measure()
    signal.throwIfAborted()
  }catch(error){
    if(!signal.aborted)await Promise.resolve(runner.value?.dispose()).catch(()=>{})
    throw error
  }finally{
    signal.removeEventListener('abort',cancel)
    await stopping
  }
  signal.throwIfAborted()
  current.value=game;currentDependencies.value=dependencies
  void nextTick(measure)
}
async function libraryTask(signal:AbortSignal,action:()=>Promise<void>){
  if(busy.value||leaving.value)return
  signal.throwIfAborted()
  busy.value=true;error.value='';retryAction.value=null
  try{await action()}
  catch(error){await refresh();throw error}
  finally{busy.value=false;progress.value=null}
}
async function launchGame(entry: Extract<PlayerEntry, { kind: 'play' }>) {
  try {
    const completed = await runOperation(entry.name, 'play', signal => libraryTask(signal, async () => {
      const key = entry.key.toLowerCase()
      const snapshot = entry.saveKey ? await getSnapshot(entry.saveKey) : undefined
      if (entry.saveKey && (!snapshot || snapshot.gameHash !== key)) throw new Error('找不到此游戏的指定存档')
      if (snapshot && snapshot.coreBuild !== coreBuild()) throw new Error('此存档属于其他内核版本，已保留原存档')
      const match = await findCachedCatalogGame(key) ?? await findCatalogGame(key, signal)
      signal.throwIfAborted()
      if (!match) throw new Error('找不到游戏目录和依赖，请回大厅刷新后重试')
      const { game, dependencies } = await prepareCatalogGame(match.game, match.catalog, {
        signal,
        onProgress: value => { progress.value = value },
      })
      await loadPreparedGame(game, dependencies, snapshot, signal)
    }))
    if (!completed) await leave()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
}
async function newSave(){await save('normal')}
async function save(kind:SaveKind='quick'){
  const game=current.value
  if(!game||!runner.value?.loaded)throw new Error('请先启动游戏')
  const dependencies=currentDependencies.value
  let preview: Blob | undefined
  const state=await runner.value.save(image => { preview = image })
  const snapshot:Snapshot={key:currentBundle(game,dependencies),kind:'quick',gameName:currentGameName.value,gameHash:game.hash,dependencies:dependencies.map(d=>({name:d.name,hash:d.hash})),coreBuild:coreBuild(),state,preview,savedAt:Date.now()}
  if(kind==='normal'){
    const label=nextSaveLabel(snapshots.value.filter(item=>item.gameHash===game.hash&&item.coreBuild===coreBuild()))
    await createSnapshot(snapshot,label)
  }else await putSnapshot(snapshot)
  snapshots.value=await listSnapshots()
  notify(kind==='normal'?'已新建存档':'已快速存档')
}
async function restore(snapshot:Snapshot){
  if(!current.value)throw new Error('请先启动游戏')
  await applySnapshot(snapshot,current.value,currentDependencies.value)
  menuOpen.value=false;notify('已读取存档')
}
async function quickRestore(){
  if(!current.value)throw new Error('请先启动游戏')
  const snapshot=(await listSnapshots()).find(snapshot=>saveKindOf(snapshot)==='quick'&&snapshot.gameHash===current.value!.hash&&snapshot.coreBuild===coreBuild())
  if(!snapshot)throw new Error('当前游戏还没有快速存档')
  await restore(snapshot)
}
async function loadSaves(): Promise<SaveListItem[]> {
  const key = current.value?.hash
  if (!key) return []
  snapshots.value = await listSnapshots()
  return snapshots.value.filter(snapshot => snapshot.gameHash === key).map(snapshot => ({
    ...snapshot,
    label: snapshot.label?.trim() || (saveKindOf(snapshot) === 'quick' ? '快速存档' : snapshotName(snapshot)),
    kind: saveKindOf(snapshot),
    compatible: snapshot.coreBuild === coreBuild(),
    rename: label => renameSnapshot(snapshot.key, label),
    remove: () => removeSnapshot(snapshot.key),
    restore: async () => {
      await restore(snapshot)
      savesOpen.value = false
      resumeGame()
    },
  }))
}
async function stop(){layoutEditing.value=false;touchLayoutDraft.value=undefined;input.releaseAll();current.value=null;currentDependencies.value=[];playbackFailed.value=false;menuOpen.value=false;pauseOpen.value=false;await runner.value?.dispose();await fullscreen.exit()}
async function leave(){
  if(busy.value||leaving.value)return
  leaving.value=true
  try{await stop();await props.onLeave()}catch(err){error.value=String(err)}finally{leaving.value=false}
}
function nativeBack(): 'handled'{
  if(operation.value){cancelOperation();return 'handled'}
  if(savesOpen.value){savePanel.value?.back();return 'handled'}
  if(busy.value||leaving.value)return 'handled'
  const filter=document.querySelector<HTMLElement>('.rs-backdrop')
  if(filter){filter.click();return 'handled'}
  if(layoutEditing.value)finishTouchLayout()
  else if(menuOpen.value)closeMenu()
  else if(pauseOpen.value)resumeGame()
  else if(loaded.value)openMenu()
  else void leave()
  return 'handled'
}
function shellKey(event:KeyboardEvent){
  if (event.code === 'Escape' && navEnabled.value && finishTextEditing()) {
    event.preventDefault()
    event.stopImmediatePropagation()
    return
  }
  if(event.code==='Escape'&&event.target instanceof Element&&event.target.closest('.rs-popup'))return
  const saveKey=!event.shiftKey&&!event.altKey&&!event.metaKey&&((event.ctrlKey&&event.code==='KeyS')||(!event.ctrlKey&&event.code==='F8'))
  const loadKey=!event.ctrlKey&&!event.shiftKey&&!event.altKey&&!event.metaKey&&event.code==='F9'
  if(event.code==='Escape'||event.code==='F11'||saveKey||loadKey){
    event.preventDefault();event.stopImmediatePropagation()
    if(event.repeat)return
    if(event.code==='Escape'){capturing.value=null;nativeBack();return}
    if(busy.value||leaving.value)return
    if(event.code==='F11'){void fullscreen.toggle();return}
    if(!menuOpen.value&&!pauseOpen.value&&!savesOpen.value&&!layoutEditing.value)void task(loadKey?quickRestore:save)
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
useRemoteNav({container:panel,active:computed(()=>navEnabled.value&&menuOpen.value&&!capturing.value),onBack:closeMenu,autoFocus:true,priority:10})
useRemoteNav({container:computed(()=>pauseMenu.value?.panel??null),active:computed(()=>navEnabled.value&&pauseOpen.value&&!savesOpen.value&&!busy.value&&!leaving.value),onBack:resumeGame,autoFocus:true,priority:10})
watch([menuOpen,pauseOpen,savesOpen,layoutEditing,busy,current,playbackFailed],()=>{
  if(!current.value||menuOpen.value||pauseOpen.value||savesOpen.value||layoutEditing.value||busy.value||playbackFailed.value)runner.value?.pause()
  else runner.value?.resume()
},{flush:'sync'})
watch(()=>settings.muted,value=>runner.value?.setMuted(value))
watch([menuOpen,tab,player],()=>{capturing.value=null})
watch(menuOpen, open => {
  if (!open && !loaded.value && !layoutEditing.value && !leaving.value) void leave()
})

const frameSize=ref({width:'100%',height:'100%'})
function measure(){
  const container=display.value
  if(!container)return
  const nativeAspect=runner.value?.aspectRatio??4/3
  const aspect=settings.aspect==='auto'?nativeAspect:settings.aspect==='4:3'?4/3:3/4
  let width=container.clientWidth,height=width/aspect
  if(height>container.clientHeight){height=container.clientHeight;width=height*aspect}
  frameSize.value={width:`${Math.floor(width)}px`,height:`${Math.floor(height)}px`}
  requestAnimationFrame(()=>runner.value?.syncDisplay?.(settings.smoothing))
  // The core observes the canvas CSS size and manages its backing buffer in
  // device pixels. Resizing it in CSS pixels here clips rendering on Retina.
}
watch(()=>settings.aspect,()=>nextTick(measure))
watch(()=>settings.smoothing,()=>runner.value?.syncDisplay?.(settings.smoothing))
const touchVisible=computed(()=>layoutEditing.value||settings.touch!=='never')
let resize:ResizeObserver|null=null
const blurCanvas=()=>canvas.value?.blur()
function pageHide(){downloads.abort();input.releaseAll();void Promise.resolve(runner.value?.dispose()).catch(err=>console.warn('[Arcade] 退出核心失败',err))}
onMounted(()=>{
  runner.value=createArcadeRunner(canvas.value!)
  runner.value.onError=(err,reason)=>{
    if(playbackFailed.value)return
    playbackFailed.value=loaded.value&&reason!=='native-pause'
    error.value=err.message
    if(loaded.value)menuOpen.value=true
  }
  runner.value.setMuted(settings.muted)
  canvas.value!.addEventListener('focus',blurCanvas)
  resize=new ResizeObserver(measure);resize.observe(display.value!)
  window.addEventListener('pagehide',pageHide)
  ;(window as Window&{__handleAndroidBack?:()=>string}).__handleAndroidBack=nativeBack
  measure()
  const entry=props.entry
  if(entry?.kind==='play')void launchGame(entry)
  else if(entry)showSettings()
  else void leave()
})
onBeforeUnmount(()=>{
  downloads.abort()
  clearTimeout(messageTimer);resize?.disconnect()
  window.removeEventListener('keydown',shellKey,true);window.removeEventListener('pagehide',pageHide)
  canvas.value?.removeEventListener('focus',blurCanvas)
  delete (window as Window&{__handleAndroidBack?:()=>string}).__handleAndroidBack
  void Promise.resolve(runner.value?.dispose()).catch(err=>console.warn('[Arcade] 退出核心失败',err))
})
const PAD_LABELS:Record<number,string>={0:'A / ×',1:'B / ○',2:'X / □',3:'Y / △',4:'LB / L1',5:'RB / R1',8:'Select / Back',9:'Start',12:'↑',13:'↓',14:'←',15:'→'}
</script>

<template>
  <div ref="root" class="arcade-app" :class="{'is-pseudo-fullscreen':fullscreen.isFullscreen.value&&fullscreen.usePseudo.value,'game-playing':loaded||layoutEditing}">
    <LibraryLoading v-if="operation" :name="operation.name" :action="operation.action"
      :message="progress ? '正在下载并校验游戏…' : undefined" :progress="progress ? { ...progress, label: progress.name } : null"
      :cancelling="cancelling" @cancel="cancelOperation" />
    <PlayerEntryError v-if="error && !menuOpen && !savesOpen && !loaded && !operation && !layoutEditing" :message="error" @back="leave" />
    <main class="arcade-stage player-stage" :class="{'player-preparing':!loaded&&!layoutEditing,'has-touch':touchVisible,'always-controls':settings.touch==='always'||layoutEditing}">
      <div v-if="layoutEditing" class="layout-edit-tools" data-layout-toolbar>
        <div class="layout-edit-header">
          <span>拖动调整位置 · 保存后生效</span>
          <SButton @click="resetTouchLayout">重置当前方向</SButton>
          <SButton @click="finishTouchLayout">返回</SButton>
          <SButton class="layout-done" @click="saveTouchLayout">保存</SButton>
        </div>
      </div>
      <div ref="display" class="arcade-display">
        <div class="arcade-frame" :style="frameSize"><canvas ref="canvas" :style="{imageRendering:settings.smoothing?'auto':'pixelated'}" tabindex="-1" /></div>
      </div>
      <TouchControls v-if="touchVisible" class="arcade-touch" :class="{'touch-always':settings.touch==='always'||layoutEditing}" :disabled="!enabled" :editing="layoutEditing" :layout="touchLayoutDraft" @menu="openMenu" @save="task(save)" @press="(action,source)=>input.press(0,action,source)" @release="(action,source)=>input.release(0,action,source)" />
    </main>
    <PlayerSaveList v-if="savesOpen" ref="savePanel" :game-name="currentGameName" :load="loadSaves" :create="loaded ? newSave : undefined" @close="savesOpen = false" />
    <SModal v-if="!savesOpen" v-model:show="pauseOpen" class="player-pause-modal" :title="currentGameName || '游戏已暂停'" subtitle="游戏已暂停" width="400px" :closable="false" :mask-closable="!busy && !leaving" :close-on-esc="false">
      <PauseMenu ref="pauseMenu" :busy="busy || leaving" :message="message" @resume="resumeGame" @save="task(newSave)" @load="savesOpen = true" @settings="showSettings()" @exit="leave" />
    </SModal>
    <button v-if="loaded && !layoutEditing" class="play-menu-button" @click="openMenu">暂停 · Esc / 返回</button>
    <div v-if="message" class="arcade-toast" role="status">{{message}}</div>

    <SModal :show="menuOpen" @update:show="show => { if (!show) closeMenu() }" title="设置" width="1040px" fill-height class="player-modal arcade-modal" :closable="!busy && !leaving" :mask-closable="!busy && !leaving" :close-on-esc="false" :body-scrollable="false">
      <div ref="panel" class="arcade-menu player-settings">
        <nav class="arcade-tabs player-settings-tabs" role="tablist" aria-label="街机设置分类"><SButton v-for="item in tabs" :key="item.id" :id="`arcade-tab-${item.id}`" class="arcade-tab" :class="{active:tab===item.id}" role="tab" :aria-selected="tab===item.id" :aria-controls="`arcade-panel-${item.id}`" :disabled="busy||leaving" @click="tab=item.id">{{item.label}}</SButton></nav>
        <div v-if="error||busy" class="player-settings-notices">
          <div v-if="error || retryAction" class="arcade-error">
            <span v-if="error" role="alert">{{error}}</span>
            <SButton v-if="retryAction" :aria-disabled="busy || leaving" @click="task(retryAction!)">{{ busy ? '正在重试…' : '重试' }}</SButton>
            <SButton v-if="playbackFailed" :disabled="busy || leaving" @click="task(stop)">返回游戏库</SButton>
          </div>
          <p v-if="busy" class="arcade-progress" role="status">{{progressText}}</p>
        </div>
        <fieldset :id="`arcade-panel-${tab}`" class="arcade-content player-settings-body" :disabled="busy||leaving" role="tabpanel" :aria-labelledby="`arcade-tab-${tab}`">
          <section v-if="tab==='keys'" class="keys-page">
            <section class="keyboard-help"><h3>快捷键</h3><dl><dt><kbd>Esc</kbd></dt><dd>游戏中打开暂停菜单，再按一次继续游戏。</dd><dt><kbd>Ctrl+S / F8</kbd></dt><dd>快速存档。</dd><dt><kbd>F9</kbd></dt><dd>读取本游戏快速存档。</dd><dt><kbd>F11</kbd></dt><dd>全屏 / 窗口切换。</dd></dl></section>
            <div class="touch-layout-setting"><span>触屏按键布局</span><SButton @click="editTouchLayout">编辑布局</SButton></div>
            <SHint class="layout-hint">摇杆可调整大小，每个动作按钮可独立移动、缩放或隐藏；横屏与竖屏分别保存。</SHint>
            <div class="arcade-actions player-switch"><SButton v-for="(_,i) in settings.players" :key="i" :class="{selected:player===i}" @click="player=i">玩家 {{i+1}}</SButton></div>
            <SHint>六键为 Y / X / L、B / A / R 两排布局，投币后按开始。手柄按连接顺序分配给两位玩家，左摇杆与十字键均可控制方向；游戏按核心默认布局映射。</SHint>
            <div class="arcade-key-row key-heading"><span>操作</span><span>键盘</span><span>手柄</span></div>
            <div v-for="action in ACTIONS" :key="action.id" class="arcade-key-row"><span>{{action.label}}</span><SButton :class="{selected:capturing===action.id}" @click="capturing=action.id">{{capturing===action.id?'按下新按键…':keyLabel(settings.players[player][action.id])}}</SButton><span>{{PAD_LABELS[action.pad]}}</span></div>
            <SButton @click="settings.players[player]=defaultKeymap(player)">恢复当前玩家默认按键</SButton>
          </section>

          <section v-else-if="tab==='display'" class="display-page">
            <label>画面平滑<SSwitch v-model:value="settings.smoothing" /></label>
            <label>宽高比<RemoteSelect v-model="settings.aspect" :options="[{value:'auto',label:'自动（跟随游戏方向）'},{value:'4:3',label:'4:3 横屏'},{value:'3:4',label:'3:4 竖屏'}]" /></label>
          </section>
          <section v-else-if="tab==='audio'" class="display-page">
            <label>静音<SSwitch v-model:value="settings.muted" /></label>
          </section>
          <section v-else class="display-page">
            <label>触屏手柄<RemoteSelect v-model="settings.touch" :options="[{value:'auto',label:'默认（桌面隐藏，移动端显示）'},{value:'always',label:'显示'},{value:'never',label:'隐藏'}]" /></label>
            <details class="core-licenses"><summary>开源许可</summary><h4>FB Alpha 2012</h4><pre>{{fbaLicense}}</pre><h4>RetroArch</h4><pre>{{retroarchLicense}}</pre></details>
          </section>
        </fieldset>
        <SHint v-if="tab==='keys'" class="player-settings-hint">点击「菜单」暂停游戏，可继续游戏或进入设置；点击「快存」快速存档。</SHint>
      </div>
    </SModal>
  </div>
</template>

<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#1a1a1a;color:#e8e8e8}*{box-sizing:border-box}html,body,#app{height:100%;margin:0}body{overflow:hidden}button,select,input{font:inherit}button{cursor:pointer}button:disabled{cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #82b1ff;outline-offset:3px}
</style>

<style scoped>
.arcade-app{height:100dvh;display:flex;flex-direction:column;background:#1a1a1a}.is-pseudo-fullscreen{position:fixed;inset:0;z-index:2000}
.arcade-stage{display:flex;flex-direction:column;position:relative;flex:1;min-height:0}.arcade-display{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative}.arcade-frame{background:#000;flex-shrink:0;overflow:hidden;border-radius:4px}.arcade-frame canvas{display:block;width:100%!important;height:100%!important;outline:none}
.arcade-status{display:flex;justify-content:space-between;gap:12px;padding:8px 16px;background:#242424;border-top:1px solid #343434;color:#aaa;font-size:12px}.arcade-touch{display:none}.arcade-touch.touch-always{display:block}.arcade-toast{position:fixed;z-index:3000;bottom:30px;left:50%;transform:translateX(-50%);padding:12px 20px;border-radius:10px;background:#101114eb;color:#eee;pointer-events:none}
.arcade-menu{display:flex;flex-direction:column;min-height:0;height:100%}.arcade-tabs{display:flex;gap:6px;padding:12px;overflow-x:auto;flex-shrink:0}.arcade-tabs :deep(button){flex-shrink:0}.selected{background:#383e4c!important;border-color:#82a4dc!important}
.arcade-error{margin:0 12px 10px;padding:12px;background:#482c30;border:1px solid #8d545a;border-radius:6px;color:#ffccd0;line-height:1.6;font-size:13px;overflow-wrap:anywhere}.arcade-progress{padding:0 16px;color:#bbb;font-size:13px}
.arcade-content{min-width:0;min-height:0;flex:1;border:0;padding:4px 16px 20px;margin:0;overflow:auto}.arcade-content section{max-width:760px;margin:0 auto}.arcade-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 14px}
.game-row{border:1px solid #414141;border-radius:8px;padding:14px;margin-top:12px;background:#282828}.game-summary{display:flex;justify-content:space-between;align-items:center;gap:12px}.game-summary>div:first-child{min-width:0}.game-row strong{font-size:15px;overflow-wrap:anywhere}.game-row small{display:block;margin-top:7px;color:#aaa;font-size:12px}.row-actions{display:flex;gap:8px;flex-shrink:0}
.keys-page h3{font-size:14px;margin:8px 0 14px}.keyboard-help{border-bottom:1px solid #414141;padding-bottom:16px;margin-bottom:20px!important}.keyboard-help dl{display:grid;grid-template-columns:80px minmax(0,1fr);gap:12px;margin:0;line-height:1.6;font-size:13px}.keyboard-help dd{margin:0;color:#bbb}.keyboard-help kbd{background:#333;border:1px solid #555;border-radius:4px;padding:3px 6px}.arcade-key-row{display:grid;grid-template-columns:60px minmax(110px,1fr) minmax(90px,1fr);gap:12px;align-items:center;margin:10px 0;font-size:13px}.key-heading{color:#aaa;margin-top:18px}
.core-licenses{margin-top:24px;color:#aaa;font-size:12px}.core-licenses summary{cursor:pointer;min-height:32px}.core-licenses pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;padding:12px;border:1px solid #444;line-height:1.5}
.display-page>label{display:flex;justify-content:space-between;align-items:center;gap:16px;min-height:60px;border-bottom:1px solid #343434}.display-page select{background:#292929;color:#eee;border:1px solid #555;border-radius:6px;padding:8px;max-width:65%}.display-page input{width:20px;height:20px}
@media(pointer:coarse){.desktop-only,.keyboard-help{display:none}.arcade-touch{display:block}.arcade-status{display:none}.arcade-tabs{gap:4px;padding:8px}.arcade-content{padding-inline:10px}.game-summary{flex-wrap:wrap}.row-actions{margin-left:auto}.arcade-key-row{gap:8px;grid-template-columns:46px minmax(105px,1fr) minmax(75px,1fr)}}
@media(pointer:coarse) and (orientation:landscape){.arcade-touch{position:absolute}.arcade-frame{border-radius:0}}
@media(orientation:portrait){
  .arcade-stage{grid-template-columns:minmax(0,1fr)}
  .arcade-stage.always-controls{display:grid;grid-template-rows:repeat(2,minmax(0,1fr))}
  .arcade-touch.touch-always{display:grid}
}
@media(pointer:coarse) and (orientation:portrait){
  .arcade-stage.has-touch{display:grid;grid-template-rows:repeat(2,minmax(0,1fr))}
  .arcade-touch{display:grid}
}
</style>

<style scoped>
.arcade-tabs { flex-wrap: wrap; gap: 4px; padding: 8px 12px; overflow: visible; border-bottom: 1px solid #3a3a3a; }
.arcade-tabs .arcade-tab { min-height: 44px; padding: 6px 12px; border: none; border-radius: 6px; background: transparent; color: #aaa; font-size: 14px; }
.arcade-tabs .arcade-tab.active { background: #3a3a3a; color: #fff; }
.arcade-tabs .arcade-tab:focus-visible { outline: 2px solid #4ea1ff; outline-offset: -2px; }
.arcade-content { padding: 16px; }
.arcade-content section { max-width: 640px; }
.touch-layout-setting { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
.layout-hint { display: block; margin-bottom: 12px; font-size: 12px; line-height: 1.4; }
.player-switch { gap: 8px; margin-bottom: 12px; }
.player-switch :deep(.s-button) { flex: 1; }
.arcade-key-row { grid-template-columns: minmax(0, 1fr) 110px 110px; gap: 8px; margin: 0; padding: 6px 0; }
.arcade-key-row :deep(.s-button) { min-height: 44px; }
.display-page > label { min-height: 0; padding: 8px 0; border: none; }
.display-page .remote-select { min-width: 160px; max-width: 65%; }
@media (max-width: 480px) {
  .arcade-tabs { gap: 2px; padding: 4px; }
  .arcade-tabs .arcade-tab { flex: 1; padding: 6px; font-size: 13px; }
  .arcade-key-row { grid-template-columns: minmax(0, 1fr) repeat(2, minmax(0, 100px)); gap: 4px; }
}
@media (pointer: coarse) {
  .arcade-tabs { gap: 4px; padding: 4px 8px; }
  .arcade-tabs .arcade-tab { min-height: var(--player-control-height); padding: 4px 8px; }
  .arcade-content { padding: 8px 12px; }
  .display-page > label { min-height: calc(var(--player-control-height) + 8px); padding-block: 4px; gap: 8px; }
  .display-page .remote-select { min-width: 0; width: 60%; max-width: 240px; }
  .arcade-key-row { padding-block: 3px; }
}
@media (orientation: landscape) and (max-height: 540px) {
  .arcade-menu { display: grid; grid-template-columns: 84px minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr); }
  .arcade-tabs { grid-column: 1; grid-row: 1 / -1; flex-direction: column; flex-wrap: nowrap; padding: 6px; overflow-y: auto; border-bottom: none; border-right: 1px solid #3a3a3a; }
  .arcade-tabs .arcade-tab { flex: 0 0 auto; width: 100%; padding: 6px; }
  .arcade-error { grid-column: 2; grid-row: 1; margin-right: 56px; }
  .arcade-progress { grid-column: 2; grid-row: 2; margin-right: 56px; }
  .arcade-content { grid-column: 2; grid-row: 3; }
  .arcade-content { padding: 8px 56px 8px 12px; }
}
</style>

<style>
.arcade-modal .s-modal-body { flex: 1; }
.arcade-modal .s-modal-header { flex-shrink: 0; }
@media (orientation: landscape) and (max-height: 540px) {
  .arcade-modal.s-modal-overlay { padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
  .arcade-modal .s-modal-box.fill-height { position: relative; width: 100% !important; height: 100%; max-height: 100%; border: none; border-radius: 0; }
  .arcade-modal .s-modal-header { position: absolute; top: 4px; right: 6px; z-index: 1; padding: 0; border: none; }
  .arcade-modal .s-modal-titles { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .arcade-modal .s-icon-close { width: 44px; height: 44px; }
}
</style>
