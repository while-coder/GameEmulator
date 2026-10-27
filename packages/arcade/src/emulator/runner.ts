/// <reference path="../env.d.ts" />
import { Nostalgist } from 'nostalgist'
import coreJs from '../assets/cores/fbalpha2012_libretro.js?url'
import coreWasm from '../assets/cores/fbalpha2012_libretro.wasm?url'
import { ACTIONS, type Action } from './settings'
import type { Archive } from '../store/library'
type Instance = Awaited<ReturnType<typeof Nostalgist.prepare>>
// These private virtual keys are separate from the application's real keymaps.
const virtualKeys=['i','k','j','l','q','w','e','a','s','d','z','x','t','g','f','h','u','o','p','v','b','n','m','c']
const inputConfig=Object.fromEntries([0,1].flatMap(player=>ACTIONS.map((action,i)=>[`input_player${player+1}_${action.id}`,virtualKeys[player*ACTIONS.length+i]])))
export class ArcadeRunner {
  private instance: Instance | null = null
  private readonly css: string
  private readonly removeProperty: (name:string)=>string
  private abort: AbortController | null = null
  private generation=0
  private muted=false
  private desiredMute=false
  private paused=false
  private rotation=0
  private geometryAspect=4/3
  constructor(private canvas: HTMLCanvasElement) {
    this.css=canvas.style.cssText
    this.removeProperty=canvas.style.removeProperty.bind(canvas.style)
  }
  get loaded() { return this.instance!==null }
  get aspectRatio() { return this.rotation%2 ? 1/this.geometryAspect : this.geometryAspect }
  resize(width:number,height:number){
    if(this.instance&&(this.canvas.width!==width||this.canvas.height!==height))this.instance.resize({width,height})
  }
  async load(game: Archive, dependencies: Archive[]): Promise<void> {
    this.dispose()
    const generation=++this.generation
    const abort=new AbortController();this.abort=abort
    let diagnostic=''
    let failed=false
    const emscriptenModule = {
      printErr:(message:string)=>{
        // The pinned RetroArch build reports core rotation/geometry here.
        const rotation=message.match(/SET_ROTATION:\s*"([0-3])"/)
        if(rotation)this.rotation=Number(rotation[1])
        const aspect=message.match(/SET_(?:GEOMETRY|SYSTEM_AV_INFO):.*?Aspect:\s*([0-9.]+)/)
        if(aspect&&Number(aspect[1])>0)this.geometryAspect=Number(aspect[1])
        if(/error|cannot load|not found|required/i.test(message))diagnostic=message
        if(/cannot load this game|failed to load content|content loading failed|failed initializing content/i.test(message))failed=true
        if(/error|warn/i.test(message))console.warn('[Arcade]',message)
      },
      onExit:(status:number)=>{if(status!==0)failed=true},
      quit:(status:number)=>{if(status!==0)failed=true},
    }
    try {
      const instance=await Nostalgist.prepare({
        element:this.canvas,core:'fbalpha2012',signal:abort.signal,
        rom:[game,...dependencies].map(file=>({fileName:file.name,fileContent:file.file})),
        bios:dependencies.map(file=>({fileName:file.name,fileContent:file.file})),
        resolveCoreJs:()=>coreJs,resolveCoreWasm:()=>coreWasm,
        respondToGlobalEvents:false,
        retroarchConfig:{...inputConfig,video_aspect_ratio_auto:true,video_scale_integer:false,log_verbosity:true,frontend_log_level:0,libretro_log_level:2},
        retroarchCoreConfig:{fbalpha2012_neogeo_mode:'MVS',fbalpha2012_aspect:'DAR'},
        emscriptenModule,
      })
      if(generation!==this.generation){instance.exit({removeCanvas:false});return}
      this.instance=instance
      await instance.start()
      if(failed)throw new Error(diagnostic||'核心拒绝此游戏包')
      if(generation!==this.generation)return
      this.paused=false;this.muted=false;this.setMuted(this.desiredMute)
      // The view controls sizing. Emscripten may write fixed inline dimensions.
      this.canvas.style.removeProperty=this.removeProperty
      this.canvas.style.width='100%';this.canvas.style.height='100%'
    } catch(error) {
      if(generation!==this.generation)return
      this.dispose()
      const detail=error instanceof Error?error.message:String(error)
      console.error('[Arcade] 核心启动失败',diagnostic,error)
      throw new Error(`无法启动 ${game.name}。请确认游戏包为目录对应的 FBA 0.2.97.29 版本。${detail?` (${detail.slice(0,180)})`:''}`)
    }
  }
  press(player:number,action:Action){this.instance?.pressDown({button:action,player:player+1})}
  release(player:number,action:Action){this.instance?.pressUp({button:action,player:player+1})}
  pause(){if(this.instance&&!this.paused){this.instance.pause();this.paused=true}}
  resume(){if(this.instance&&this.paused){this.instance.resume();this.paused=false}}
  reset(){this.instance?.restart()}
  setMuted(value:boolean){
    this.desiredMute=value
    if(this.instance&&this.muted!==value){this.instance.sendCommand('MUTE');this.muted=value}
  }
  async save(): Promise<Blob> {
    if(!this.instance)throw new Error('请先启动游戏')
    const {state}=await this.instance.saveState()
    return state
  }
  async restore(state:Blob){
    if(!this.instance)throw new Error('请先启动游戏')
    await this.instance.loadState(state)
  }
  dispose(){
    this.generation++
    const instance=this.instance,abort=this.abort
    this.instance=null;this.abort=null
    abort?.abort()
    try{if(instance&&instance.getStatus()!=='terminated')instance.exit({removeCanvas:false})}catch(e){console.warn('[Arcade] 退出核心失败',e)}
    this.canvas.style.removeProperty=this.removeProperty
    this.canvas.style.cssText=this.css
    this.paused=false;this.muted=false;this.rotation=0;this.geometryAspect=4/3
  }
}
