import { onBeforeUnmount, onMounted, watch, type Ref, type ShallowRef } from 'vue'
import { ACTIONS, GAMEPAD_AXIS_THRESHOLD, settings, type Action } from '../emulator/settings'
import type { ArcadeRunner } from '../emulator/runner'
export function useArcadeInput(runner: ShallowRef<ArcadeRunner|null>, enabled: Ref<boolean>) {
  const held=new Map<string,Set<string>>()
  const assignments=new Map<number,number>()
  const padHeld=[new Set<Action>(),new Set<Action>()]
  function press(player:number,action:Action,source:string){
    if(!enabled.value)return
    const key=`${player}:${action}`,sources=held.get(key)??new Set<string>()
    if(sources.has(source))return
    if(sources.size===0)runner.value?.press(player,action)
    sources.add(source);held.set(key,sources)
  }
  function release(player:number,action:Action,source:string){
    const key=`${player}:${action}`,sources=held.get(key)
    if(!sources?.delete(source))return
    if(sources.size===0){held.delete(key);runner.value?.release(player,action)}
  }
  function releaseAll(){
    for(let player=0;player<2;player++)for(const action of ACTIONS)runner.value?.release(player,action.id)
    held.clear();padHeld.forEach(set=>set.clear())
  }
  function typing(target:EventTarget|null){return target instanceof HTMLElement&&(target.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target.tagName))}
  function keydown(e:KeyboardEvent){
    if(!enabled.value||e.ctrlKey||e.metaKey||e.altKey||typing(e.target))return
    settings.players.forEach((map,player)=>ACTIONS.forEach(action=>{if(map[action.id]===e.code){e.preventDefault();press(player,action.id,`key:${e.code}`)}}))
  }
  function keyup(e:KeyboardEvent){
    // Always release even if focus/modifier state changed while the key was held.
    settings.players.forEach((map,player)=>ACTIONS.forEach(action=>{if(map[action.id]===e.code)release(player,action.id,`key:${e.code}`)}))
  }
  function visibility(){if(document.hidden)releaseAll()}
  let raf=0
  function poll(){
    const pads=Array.from(navigator.getGamepads?.()??[]).filter((p):p is Gamepad=>!!p)
    for(const index of assignments.keys())if(!pads.some(p=>p.index===index))assignments.delete(index)
    for(const pad of pads)if(!assignments.has(pad.index)){
      const player=[0,1].find(n=>!Array.from(assignments.values()).includes(n))
      if(player!==undefined)assignments.set(pad.index,player)
    }
    for(let player=0;player<2;player++){
      const pad=pads.find(p=>assignments.get(p.index)===player),now=new Set<Action>()
      if(enabled.value&&pad){
        ACTIONS.forEach(action=>{if(pad.buttons[action.pad]?.pressed)now.add(action.id)})
        const x=pad.axes[0]??0,y=pad.axes[1]??0
        if(x<-GAMEPAD_AXIS_THRESHOLD)now.add('left');if(x>GAMEPAD_AXIS_THRESHOLD)now.add('right')
        if(y<-GAMEPAD_AXIS_THRESHOLD)now.add('up');if(y>GAMEPAD_AXIS_THRESHOLD)now.add('down')
      }
      now.forEach(action=>{if(!padHeld[player].has(action))press(player,action,'gamepad')})
      padHeld[player].forEach(action=>{if(!now.has(action))release(player,action,'gamepad')})
      padHeld[player]=now
    }
    raf=requestAnimationFrame(poll)
  }
  watch(enabled,on=>{if(!on)releaseAll()},{flush:'sync'})
  watch(()=>settings.players,releaseAll,{deep:true,flush:'sync'})
  onMounted(()=>{
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup)
    window.addEventListener('blur',releaseAll);document.addEventListener('visibilitychange',visibility)
    raf=requestAnimationFrame(poll)
  })
  onBeforeUnmount(()=>{
    releaseAll();cancelAnimationFrame(raf)
    window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup)
    window.removeEventListener('blur',releaseAll);document.removeEventListener('visibilitychange',visibility)
  })
  return {press,release,releaseAll}
}
