// Live sync with the Studio Wall API (worker/index.ts). Local IndexedDB stays the working copy; this pushes
// changed records + images and pulls other devices' changes, merged through action('library.merge').
import {database,action,file,changes,type Board} from './data';
type Status={state:'off'|'syncing'|'on'|'error';email?:string;message?:string};
const KEY='studio-wall-sync';
const kinds=['boards','pins','feedback'] as const;
let status:Status={state:'off'};let running:Promise<void>|null=null,again=false,timer:any;
const listeners=new Set<(s:Status)=>void>();
const set=(s:Status)=>{status=s;listeners.forEach(f=>f(s));};
export const syncStatus=()=>status;
export const onSyncStatus=(f:(s:Status)=>void)=>{listeners.add(f);};
function cursors():{cursor:number;pushedAt:string;owner?:string}{try{return JSON.parse(localStorage.getItem(KEY)||'')}catch{return {cursor:0,pushedAt:''};}}
function save(c:{cursor:number;pushedAt:string;owner?:string}){try{localStorage.setItem(KEY,JSON.stringify(c));}catch{}}
async function api(path:string,init?:RequestInit){const r=await fetch(path,{credentials:'same-origin',...init});if(!r.ok&&r.status!==404)throw Object.assign(Error((await r.json().catch(()=>({}))).error||'Sync failed ('+r.status+')'),{status:r.status});return r;}
async function push(c:ReturnType<typeof cursors>){
 const started=new Date().toISOString();const db=await database;const out:{kind:string;data:any}[]=[];
 for(const kind of kinds)for(const r of await db.getAll(kind))if(!c.pushedAt||r.updated_at>c.pushedAt)out.push({kind,data:r});
 for(const {kind,data} of out)if(kind==='pins'&&data.file_ref){const head=await api('/api/files/'+data.file_ref,{method:'HEAD'});if(head.status===404){const blob=await file(data.file_ref);if(blob)await api('/api/files/'+data.file_ref,{method:'PUT',headers:{'content-type':blob.type||'image/webp'},body:blob});}}
 for(let i=0;i<out.length;i+=200)await api('/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({records:out.slice(i,i+200)})});
 c.pushedAt=started;save(c);
}
async function pull(c:ReturnType<typeof cursors>){
 let changed=false;
 for(let more=true;more;){
  const page=await (await api('/api/sync?since='+c.cursor)).json();if(!page.records.length){c.cursor=page.cursor;break;}
  // Every board travels with each page so another device's Inbox always maps onto this device's Inbox.
  const boards:Board[]=(await (await api('/api/boards')).json()).boards;
  const pins=page.records.filter((r:any)=>r.kind==='pins').map((r:any)=>r.data),feedback=page.records.filter((r:any)=>r.kind==='feedback').map((r:any)=>r.data);
  const blobs:Record<string,Blob>={};for(const p of pins)if(p.file_ref&&!(await file(p.file_ref))){const r=await api('/api/files/'+p.file_ref);if(r.ok)blobs[p.file_ref]=await r.blob();}
  const res=await action({type:'library.merge',payload:{boards,pins,feedback,fromSync:true},blobs,recordHistory:false});
  changed||=Object.values(res.counts as Record<string,number>).some(n=>n>0);c.cursor=page.cursor;save(c);more=page.more;
 }
 return changed;
}
export function syncNow(onRemote:()=>void){
 if(running){again=true;return running;}
 running=(async()=>{try{
  if(status.state==='off'){const me=await api('/api/me').catch(()=>null);if(!me?.ok)return;set({state:'syncing',email:(await me.json()).email});}
  else set({...status,state:'syncing'});
  let c=cursors();if(c.owner!==status.email){c={cursor:0,pushedAt:'',owner:status.email};save(c);}
  await push(c);if(await pull(c))onRemote();set({state:'on',email:status.email});
 }catch(e){set({state:status.email?'error':'off',email:status.email,message:(e as Error).message});}
 finally{running=null;if(again){again=false;syncNow(onRemote);}}})();
 return running;
}
export function startSync(onRemote:()=>void){
 const soon=()=>{clearTimeout(timer);timer=setTimeout(()=>syncNow(onRemote),1500);};
 changes.addEventListener('change',()=>{if(status.state!=='off')soon();});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')syncNow(onRemote);});
 setInterval(()=>{if(document.visibilityState==='visible'&&status.state!=='off')syncNow(onRemote);},20000);
 return syncNow(onRemote);
}
