import type { ArcadeCatalog } from './catalog'

export const CORE_BUILD = 'fbalpha2012-retroarch-1.22.2-a19485f4'
interface CachedCatalog { url: string; catalog: ArcadeCatalog }
export type ArchiveKind = 'game' | 'support'
export interface Archive {
  id: string
  name: string
  hash: string
  file: Blob
  size: number
  kind: ArchiveKind
  importedAt: number
  dependencies: string[]
}
export interface Snapshot {
  key: string
  gameName: string
  gameHash: string
  dependencies: {name:string;hash:string}[]
  coreBuild: string
  state: Blob
  savedAt: number
}
let connection: Promise<IDBDatabase> | null = null
function db(): Promise<IDBDatabase> {
  if(connection)return connection
  connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open('arcade-library',2)
    request.onupgradeneeded=()=>{
      const d=request.result
      if(!d.objectStoreNames.contains('archives'))d.createObjectStore('archives',{keyPath:'id'})
      if(!d.objectStoreNames.contains('saves'))d.createObjectStore('saves',{keyPath:'key'})
      if(!d.objectStoreNames.contains('catalogs'))d.createObjectStore('catalogs',{keyPath:'url'})
    }
    request.onsuccess=()=>{
      const d=request.result
      d.onversionchange=()=>{d.close();connection=null}
      d.onclose=()=>{connection=null}
      resolve(d)
    }
    request.onerror=()=>reject(request.error??new Error('无法打开街机游戏库'))
  })
  connection.catch(()=>{connection=null})
  return connection
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error??new Error('保存街机数据失败'))})
}
async function read<T>(store: string, key?: string): Promise<T> {
  const d=await db(), tx=d.transaction(store,'readonly'), completion=done(tx)
  const request=key===undefined?tx.objectStore(store).getAll():tx.objectStore(store).get(key)
  const result=await new Promise<T>((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  await completion
  return result
}
async function write(store: string, value: Archive | Snapshot | CachedCatalog | string, remove=false) {
  const d=await db(),tx=d.transaction(store,'readwrite'), completion=done(tx)
  if(remove)tx.objectStore(store).delete(value as string)
  else tx.objectStore(store).put(value)
  await completion
}
export const listArchives=()=>read<Archive[]>('archives')
export async function listSnapshots(): Promise<Snapshot[]> {
  const snapshots = await read<Snapshot[]>('saves')
  const latest = new Map<string, Snapshot>()
  for (const snapshot of snapshots.sort((a,b)=>b.savedAt-a.savedAt)) {
    if (!latest.has(snapshot.gameHash)) latest.set(snapshot.gameHash, snapshot)
  }
  return [...latest.values()]
}
export const removeArchive=(id:string)=>write('archives',id,true)
export async function removeSnapshot(key: string): Promise<void> {
  const d=await db(),tx=d.transaction('saves','readwrite'),completion=done(tx)
  const store=tx.objectStore('saves'),request=store.getAll()
  request.onsuccess=()=>{
    const snapshots=request.result as Snapshot[]
    const selected=snapshots.find(snapshot=>snapshot.key===key)
    for(const snapshot of snapshots) {
      if(snapshot.key===key||selected&&snapshot.gameHash===selected.gameHash)store.delete(snapshot.key)
    }
  }
  await completion
}
export const putArchive=(archive:Archive)=>write('archives',archive)
export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  const d=await db(),tx=d.transaction('saves','readwrite'),completion=done(tx)
  const store=tx.objectStore('saves')
  const request=store.getAll()
  request.onsuccess=()=>{
    for(const previous of request.result as Snapshot[]) {
      if(previous.gameHash===snapshot.gameHash)store.delete(previous.key)
    }
    store.put(snapshot)
  }
  await completion
}
export const getSnapshot=(key:string)=>read<Snapshot|undefined>('saves',key)
export const getCachedCatalog=(url:string)=>read<CachedCatalog|undefined>('catalogs',url)
export const putCachedCatalog=(value:CachedCatalog)=>write('catalogs',value)
export async function hashBlob(file: Blob): Promise<string> {
  if(!crypto.subtle)throw new Error('当前环境不支持文件校验')
  const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer())
  return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')
}
export async function validateZip(file: File): Promise<void> {
  if(!/^[a-z0-9_+\-]+\.zip$/i.test(file.name))throw new Error(`${file.name}：请选择原名 ZIP 游戏包，不要解压或重命名`)
  if(file.size>128*1024*1024)throw new Error(`${file.name} 超过 128 MB`)
  const tail=new DataView(await file.slice(Math.max(0,file.size-65557)).arrayBuffer())
  let end=-1
  for(let i=tail.byteLength-22;i>=0;i--)if(tail.getUint32(i,true)===0x06054b50 && i+22+tail.getUint16(i+20,true)===tail.byteLength){end=i;break}
  if(end<0 || tail.getUint16(end+4,true)!==0 || tail.getUint16(end+6,true)!==0 || tail.getUint16(end+10,true)===0)throw new Error(`${file.name}：ZIP 文件无效、为空或不受支持`)
  const centralEnd=tail.getUint32(end+16,true)+tail.getUint32(end+12,true)
  if(centralEnd>file.size-tail.byteLength+end)throw new Error(`${file.name}：ZIP 文件已损坏`)
}
export async function importArchive(file: File, kind: ArchiveKind): Promise<Archive> {
  await validateZip(file)
  const name=file.name.toLowerCase(),id=`${kind}:${name}`
  const old=await read<Archive|undefined>('archives',id)
  const archive:Archive={id,name,kind,file,size:file.size,hash:await hashBlob(file),importedAt:Date.now(),dependencies:old?.dependencies??[]}
  await putArchive(archive)
  return archive
}
export function bundleKey(game: Archive, dependencies: Archive[]): string {
  return `${CORE_BUILD}:${game.hash}:${dependencies.map(d=>`${d.name}=${d.hash}`).sort().join(',')}`
}
export async function pickArchives(): Promise<File[]> {
  return new Promise(resolve=>{
    const input=document.createElement('input')
    input.type='file';input.accept='.zip';input.multiple=true
    input.onchange=()=>resolve(Array.from(input.files??[]))
    input.oncancel=()=>resolve([])
    input.click()
  })
}
