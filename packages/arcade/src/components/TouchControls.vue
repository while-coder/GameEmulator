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
      <div class="function-group functions-left" aria-label="菜单和快存">
      <button @click="emit('menu')">菜单</button><button :disabled="disabled" @click="emit('save')">快存</button>
      </div>
      <div class="function-group functions-right" aria-label="投币和开始">
      <button v-for="a in (['select','start'] as const)" :key="a" :disabled="disabled" @pointerdown="buttonDown($event,a)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{a==='select'?'投币':'开始'}}</button>
      </div>
    </div>
    <div class="touch-play">
      <div class="stick" role="group" aria-label="八方向摇杆" @pointerdown="stickDown" @pointermove="stickMove" @pointerup="up" @pointercancel="up" @lostpointercapture="up">
        <span class="stick-guide" aria-hidden="true"/><span class="stick-knob" aria-hidden="true" :style="{transform:`translate(${stick.x}px,${stick.y}px)`}" />
      </div>
      <div class="six-buttons">
        <button v-for="action in ACTION_BUTTONS" :key="action.id" :disabled="disabled" @pointerdown="buttonDown($event,action.id)" @pointerup="up" @pointercancel="up" @lostpointercapture="up">{{action.label}}</button>
      </div>
    </div>
  </div>
</template>
<style scoped>
.touch-controls{
  position:absolute;inset:0;z-index:5;box-sizing:border-box;pointer-events:none;user-select:none;
  -webkit-user-select:none;-webkit-touch-callout:none;
  --pad-size:clamp(132px,20vw,168px);
  --action-size:clamp(44px,6vw,60px);
  --button-gap:clamp(8px,2vw,12px);
  --left-inset:max(8px,env(safe-area-inset-left));
  --right-inset:max(8px,env(safe-area-inset-right));
  --bottom-inset:max(56px,env(safe-area-inset-bottom));
}
.touch-functions,.touch-play{display:contents}
.function-group{position:absolute;display:flex;gap:8px}
.functions-left{left:var(--left-inset);bottom:calc(var(--bottom-inset) + var(--pad-size) + 32px);width:var(--pad-size)}
.functions-right{right:var(--right-inset);bottom:calc(var(--bottom-inset) + var(--action-size)*2 + var(--button-gap) + 32px);width:calc(var(--action-size)*3 + var(--button-gap)*2)}
.function-group button{flex:1;min-width:0;height:44px;border:0;border-radius:15px;background:rgba(58,58,58,.85);color:#eee;font:inherit;font-size:12px;pointer-events:auto;touch-action:none}
.functions-left button{background:rgba(47,107,216,.85);touch-action:manipulation}
.stick{position:absolute;left:var(--left-inset);bottom:var(--bottom-inset);display:grid;place-items:center;width:var(--pad-size);height:var(--pad-size);border-radius:50%;background:radial-gradient(circle,#343434 0 48%,#252525 49% 100%);border:2px solid #555;box-shadow:inset 0 2px 10px #0008;touch-action:none;pointer-events:auto}
.stick-guide{position:absolute;inset:12%;border:1px dashed #737373;border-radius:50%;pointer-events:none}
.stick-knob{position:absolute;width:44%;height:44%;border:1px solid #999;border-radius:50%;background:radial-gradient(circle at 35% 30%,#858585,#454545);box-shadow:0 4px 10px #0009;pointer-events:none}
.six-buttons{position:absolute;right:var(--right-inset);bottom:var(--bottom-inset);display:grid;grid-template-columns:repeat(3,var(--action-size));gap:var(--button-gap)}
.six-buttons button{width:var(--action-size);height:var(--action-size);border-radius:50%;background:#c0392b;color:#fff;border:0;font-size:clamp(16px,3vw,22px);font-weight:700;touch-action:none;pointer-events:auto}
button:active{filter:brightness(1.3)}button:disabled{opacity:.45}
button:focus-visible{outline:2px solid #4ea1ff;outline-offset:2px}
@media(orientation:portrait){
  .touch-controls{position:relative;inset:auto;width:100%;height:100%;min-height:0;padding:12px max(16px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));grid-template-columns:minmax(0,1fr) auto;grid-template-rows:44px max(var(--pad-size),calc(var(--action-size)*2 + var(--button-gap)));align-content:center;gap:16px;--pad-size:clamp(132px,36vw,180px);--action-size:clamp(44px,12vw,60px)}
  .function-group,.stick,.six-buttons{position:relative;inset:auto}
  .functions-left{grid-area:1 / 1;width:var(--pad-size);justify-self:start}
  .functions-right{grid-area:1 / 2;justify-self:end}
  .stick{grid-area:2 / 1;align-self:center;justify-self:start}
  .six-buttons{grid-area:2 / 2;align-self:center;justify-self:end}
}
</style>
