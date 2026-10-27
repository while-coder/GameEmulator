<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ACTION_BUTTONS, type Action } from '../emulator/settings'
const props=defineProps<{disabled:boolean}>()
const emit=defineEmits<{press:[action:Action,source:string];release:[action:Action,source:string];menu:[];save:[]}>()
const pointers=new Map<number,Set<Action>>()
const stick=ref({x:0,y:0})
let stickPointer:number|null=null
function update(id:number,actions:Set<Action>){
  const old=pointers.get(id)??new Set<Action>(),source=`touch:${id}`
  old.forEach(a=>{if(!actions.has(a))emit('release',a,source)})
  actions.forEach(a=>{if(!old.has(a))emit('press',a,source)})
  pointers.set(id,actions)
}
function buttonDown(event:PointerEvent,action:Action){
  if(props.disabled)return
  event.preventDefault();(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  update(event.pointerId,new Set([action]))
}
function stickMove(event:PointerEvent){
  if(props.disabled||stickPointer!==event.pointerId)return
  const rect=(event.currentTarget as HTMLElement).getBoundingClientRect()
  const x=Math.max(-1,Math.min(1,(event.clientX-rect.left-rect.width/2)/(rect.width/2))),y=Math.max(-1,Math.min(1,(event.clientY-rect.top-rect.height/2)/(rect.height/2)))
  const actions=new Set<Action>();if(x<-.25)actions.add('left');if(x>.25)actions.add('right');if(y<-.25)actions.add('up');if(y>.25)actions.add('down')
  stick.value={x:x*24,y:y*24};update(event.pointerId,actions)
}
function stickDown(event:PointerEvent){
  if(props.disabled||stickPointer!==null)return
  stickPointer=event.pointerId
  event.preventDefault();(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  pointers.set(event.pointerId,new Set());stickMove(event)
}
function up(event:PointerEvent){update(event.pointerId,new Set());pointers.delete(event.pointerId);if(stickPointer===event.pointerId){stickPointer=null;stick.value={x:0,y:0}}}
function releaseAll(){for(const id of pointers.keys())update(id,new Set());pointers.clear();stickPointer=null;stick.value={x:0,y:0}}
watch(()=>props.disabled,releaseAll)
onBeforeUnmount(releaseAll)
</script>
<template>
  <div class="touch-controls" @contextmenu.prevent>
    <div class="touch-functions">
      <button @click="emit('menu')">菜单</button><button :disabled="disabled" @click="emit('save')">快存</button>
      <button v-for="a in (['select','start'] as const)" :key="a" :disabled="disabled" @pointerdown="buttonDown($event,a)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{a==='select'?'投币':'开始'}}</button>
    </div>
    <div class="touch-play">
      <div class="stick" role="group" aria-label="八方向摇杆" @pointerdown="stickDown" @pointermove="stickMove" @pointerup="up" @pointercancel="up" @lostpointercapture="up">
        <span class="stick-cross"/><span class="stick-knob" :style="{transform:`translate(${stick.x}px,${stick.y}px)`}" />
      </div>
      <div class="six-buttons">
        <button v-for="action in ACTION_BUTTONS" :key="action.id" :disabled="disabled" @pointerdown="buttonDown($event,action.id)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{action.label}}</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.touch-controls{width:100%;padding:10px 8px max(10px,env(safe-area-inset-bottom));user-select:none;touch-action:none}
.touch-functions{display:flex;justify-content:center;gap:10px;margin-bottom:14px}
.touch-functions button{min-width:48px;min-height:44px;border-radius:8px;background:#303238;color:#eee;border:1px solid #51545c;font:inherit;touch-action:none}
.touch-play{display:flex;align-items:center;justify-content:space-between;gap:18px}
.stick{position:relative;display:grid;place-items:center;width:128px;height:128px;border-radius:50%;background:#292b30;border:1px solid #51545c;touch-action:none;flex-shrink:0}
.stick-cross{width:88px;height:88px;background:#3d4148;clip-path:polygon(33% 0,66% 0,66% 33%,100% 33%,100% 66%,66% 66%,66% 100%,33% 100%,33% 66%,0 66%,0 33%,33% 33%)}
.stick-knob{position:absolute;width:48px;height:48px;border-radius:50%;background:#737985;box-shadow:0 3px 8px #0008;pointer-events:none}
.six-buttons{display:grid;grid-template-columns:repeat(3,48px);gap:10px}
.six-buttons button{width:48px;height:48px;border-radius:50%;background:#9e4146;color:#fff;border:1px solid #d4777b;font-size:16px;font-weight:600;touch-action:none}
button:active{filter:brightness(1.25)}button:disabled{opacity:.4}
@media(orientation:landscape) and (pointer:coarse){.touch-controls{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none;padding-inline:16px}.touch-functions{position:absolute;top:8px;left:50%;transform:translateX(-50%);pointer-events:auto}.touch-play{width:100%}.stick,.six-buttons{pointer-events:auto}.stick{width:112px;height:112px}.six-buttons{grid-template-columns:repeat(3,44px);gap:8px}.six-buttons button{width:44px;height:44px}}
</style>
