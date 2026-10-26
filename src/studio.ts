// Studio Wall in the studio: sign-in, and sync of boards, cards, comments and images through studio-api
// (docs/backend-and-ai-plan.md, stage 3). Loaded only once this browser signs in or opens Studio account
// (src/studio-session.ts); signed out, none of this runs.
//
// Local IndexedDB (src/data.ts) stays the working copy, as with old sync. The platform SDK keeps the device's
// copy of the studio's records and an outbox of ops. `plan()` is the one place the two meet: for each record it
// compares the local record, the SDK's copy and the last state the two agreed on (`base`, a hash per record):
//
//   same                  → they agree; remember it.
//   only the local moved  → queue the op that makes the studio match (create, update, delete, restore).
//   only the studio moved → merge the studio's copy into the device through action('library.merge').
//   both moved            → the studio keeps its copy and a review card offers this device's (Art-Talk-Back D-064).
//                           The SDK reports the same when the server finds the clash itself (a `conflict`).
//
// What goes up: the records the studio already has, records made on this device since studio sync was switched
// on, the Inbox, and whatever those need (a card's board, a comment's card). Everything older waits for stage 4's
// "Import my library". Each device's own Inbox maps onto the studio's (`alias`). Images go up after their card
// exists on the server, attached to it, and come down by signed link into the device's files.
import {ApiError,Studio} from './vendor/studio-sdk.js';
import {database,action,file,changes} from './data';
import {readSession,writeSession,type Session} from './studio-session';

export type Type='board'|'pin'|'feedback';
type Rec=Record<string,any>;
export type Conflict={type:Type;id:string;local:Rec;at:string};
export type SyncState={
 base:Record<string,string>; // `${type}:${studio id}` → hash of the last state device and studio agreed on
 alias:Record<string,string>; // this device's board id → the studio's (the Inbox)
 files:Record<string,string>; // local file_ref → studio file id
 tombs:Record<string,{v:number;d:string;by?:string|null}>; // records the studio has deleted, from pulls
 refused:Record<string,{h:string;why:string}>; // creates the studio refused, held until the record changes
 conflicts:Conflict[];
};
export const emptyState=():SyncState=>({base:{},alias:{},files:{},tombs:{},refused:{},conflicts:[]});
const TYPES:Type[]=['board','pin','feedback'];
const STORES={board:'boards',pin:'pins',feedback:'feedback'} as const;
const PATHS={board:'boards',pin:'pins',feedback:'feedback'};
const FIELDS:Record<Type,string[]>={
 board:['name','description','coverPinId','position','commentsEnabled'],
 pin:['boardId','fileId','sourceUrl','sourceCredit','isOwn','note','tags','palette','kind','title','linkedType','linkedId','contributorName','meta'],
 feedback:['boardId','pinId','text','starred','authorName'],
};
const DB_NAME='studio-wall.studio',STATE_KEY='studio-wall-studio-sync';
const key=(t:Type,id:string)=>`${t}:${id}`;

// ------------------------------------------------------------------ mapping (Art-Talk-Back D-083)
type Ctx={alias:Record<string,string>;files:Record<string,string>;scope:Set<string>};
const sid=(c:Ctx,id:string)=>c.alias[id]||id;
const lid=(c:Ctx,id:string)=>Object.keys(c.alias).find(k=>c.alias[k]===id)||id;
const text=(s:unknown,max=5000)=>typeof s==='string'&&s?s.slice(0,max):null;
/** A local record as the studio's fields (camelCase; empty text is null; annotations live in meta). */
export function toServer(type:Type,r:Rec,c:Ctx):Rec{
 if(type==='board')return {name:String(r.name||'').trim().slice(0,200),description:text(r.description),coverPinId:r.cover_pin_id&&c.scope.has(r.cover_pin_id)?r.cover_pin_id:null,position:Math.max(0,Math.min(1e6,Math.round(Number(r.position)||0))),commentsEnabled:r.comments_enabled!==false};
 if(type==='pin'){const linked=r.linked_type==='artwork'&&r.linked_id;return {boardId:sid(c,r.board_id),fileId:r.file_ref&&c.files[r.file_ref]||null,sourceUrl:/^https?:\/\/\S+$/i.test(r.source_url||'')?r.source_url:null,sourceCredit:text(r.source_credit,500),isOwn:!!r.is_own,note:text(r.note),tags:[...new Set((r.tags||[]).map((t:unknown)=>String(t).trim().slice(0,50)).filter(Boolean))].slice(0,50),palette:(r.palette||[]).slice(0,12),kind:['image','idea','link'].includes(r.meta?.kind)?r.meta.kind:'idea',title:text(r.meta?.title,500),linkedType:linked?'artwork':null,linkedId:linked?r.linked_id:null,contributorName:text(r.contributor_name,100),meta:{annotations:r.annotations||[]}};}
 return {boardId:sid(c,r.board_id),pinId:r.pin_id||null,text:String(r.text||'').trim(),starred:typeof r.starred==='boolean'?r.starred:null,authorName:text(r.author_name,100)};
}
/** The fields both sides are compared on; the studio's other meta keys are its own. */
export function fieldsOf(type:Type,s:Rec):Rec{const o:Rec={};for(const k of FIELDS[type])o[k]=k==='meta'?{annotations:s.meta?.annotations??[]}:s[k]??null;return o;}
export const hashOf=(type:Type,s:Rec)=>s.deletedAt?'deleted':JSON.stringify(fieldsOf(type,s));
/** The studio's record as a local one, keeping local-only fields (share settings) of the copy it replaces. */
export function toLocal(type:Type,s:Rec,old:Rec|undefined,c:Ctx):Rec{
 const now=new Date().toISOString();
 const base={...(old||{}),id:lid(c,s.id),studio_id:'local-studio',created_at:s.createdAt||old?.created_at||now,updated_at:s.updatedAt||now,created_by:old?.created_by||(s.authorName?'guest':'local-owner'),actor_type:old?.actor_type||'human',version:(old?.version||0)+1,deleted_at:s.deletedAt||null};
 if(type==='board')return {...base,name:s.name,description:s.description??'',cover_pin_id:s.coverPinId||null,position:s.position??0,comments_enabled:s.commentsEnabled!==false,visibility:old?.visibility||'private'};
 if(type==='pin'){const ref=s.fileId?Object.keys(c.files).find(r=>c.files[r]===s.fileId)||s.fileId:old?.file_ref&&!c.files[old.file_ref]?old.file_ref:null;
  return {...base,board_id:lid(c,s.boardId),file_ref:ref,source_url:s.sourceUrl??'',source_credit:s.sourceCredit??'',is_own:!!s.isOwn,note:s.note??'',tags:s.tags||[],palette:s.palette||[],linked_type:s.linkedType??null,linked_id:s.linkedId??null,annotations:s.meta?.annotations??[],meta:{kind:s.kind||'idea',title:s.title??''},contributor_name:s.contributorName??undefined,deleted_by:s.deletedBy??null};}
 return {...base,board_id:lid(c,s.boardId),pin_id:s.pinId||null,text:s.text??'',starred:typeof s.starred==='boolean'?s.starred:undefined,author_name:s.authorName??undefined};
}

// ------------------------------------------------------------------ the plan (pure, so it is unit-tested)
export type Local={board:Rec[];pin:Rec[];feedback:Rec[]};
/** The SDK's copy per type: live records by studio id. Deleted ones are in state.tombs. */
export type Server=Record<Type,Map<string,Rec>>;
export type Op={op:'create'|'update'|'remove'|'restore';type:Type;id:string;fields?:Rec;patch?:Rec;version?:number};
export type Plan={ops:Op[];apply:{boards:Rec[];pins:Rec[];feedback:Rec[]};conflicts:Conflict[];local:number};
/**
 * Compare device and studio. Mutates `st` (base, alias, files, refused) and returns the ops to queue, the
 * studio's records to merge into the device, and new review cards. `since`: when this device switched on.
 */
export function plan(local:Local,server:Server,st:SyncState,since:string,now=new Date().toISOString()):Plan{
 const out:Plan={ops:[],apply:{boards:[],pins:[],feedback:[]},conflicts:[],local:0};const removes:Op[]=[];
 // This device's Inbox is the studio's Inbox once the studio has one.
 const inbox=local.board.find(b=>b.name==='Inbox'&&!b.deleted_at);
 if(inbox&&!st.alias[inbox.id]&&!server.board.has(inbox.id)&&!st.base[key('board',inbox.id)]){
  const theirs=[...server.board.values()].find(b=>b.name==='Inbox');
  if(theirs)st.alias[inbox.id]=theirs.id;
 }
 const known=(t:Type,id:string)=>{const s=t==='board'?st.alias[id]||id:id;return server[t].has(s)||!!st.tombs[key(t,s)]||key(t,s) in st.base;};
 const scope=new Set<string>();if(inbox)scope.add(inbox.id);
 for(const t of TYPES)for(const r of local[t])if(known(t,r.id)||r.created_at>=since)scope.add(r.id);
 // A card or comment that goes up takes what it needs with it, or the studio would refuse it.
 for(const f of local.feedback)if(scope.has(f.id)){scope.add(f.board_id);if(f.pin_id)scope.add(f.pin_id);}
 for(const p of local.pin)if(scope.has(p.id))scope.add(p.board_id);
 const c:Ctx={alias:st.alias,files:st.files,scope};
 const byId:Record<Type,Map<string,Rec>>={board:new Map(),pin:new Map(),feedback:new Map()};
 for(const t of TYPES)for(const r of local[t])byId[t].set(t==='board'?sid(c,r.id):r.id,r);
 const localHash=(t:Type,r:Rec)=>r.deleted_at?'deleted':JSON.stringify(fieldsOf(t,toServer(t,r,c)));
 const tomb=(t:Type,id:string)=>st.tombs[key(t,id)];
 for(const t of TYPES){
  const ids=new Set([...server[t].keys()]);for(const [id,r] of byId[t])if(scope.has(r.id)||tomb(t,id))ids.add(id);
  for(const id of ids){
   const k=key(t,id),L=byId[t].get(id),inScope=!!L&&scope.has(L.id),S=server[t].get(id),T=S?undefined:tomb(t,id);
   const lh=L&&(inScope||S||T)?localHash(t,L):undefined,sh=S?hashOf(t,S):T?'deleted':undefined;
   if(!L&&T){delete st.base[k];continue;}
   // Held back after a refusal until the record changes: '?' is a refusal not yet matched to the record's state.
   if(st.refused[k]){if(st.refused[k].h==='?')st.refused[k].h=lh??'';if(st.refused[k].h===lh)continue;delete st.refused[k];}
   if(lh===sh){if(lh!==undefined)st.base[k]=lh;continue;}
   // A new alias (this device's Inbox meeting the studio's): the studio's copy wins, quietly.
   const b=t==='board'&&L&&st.alias[L.id]&&!(k in st.base)?lh:st.base[k];
   if(sh===b||(sh===undefined&&b===undefined)){
    if(!L)continue;
    if(L.deleted_at){
     if(!S){st.base[k]='deleted';continue;}
     // Cards deleted with their board go with the board's delete (the studio does the same).
     if(t==='pin'){const bid=sid(c,L.board_id);if(byId.board.get(bid)?.deleted_at===L.deleted_at&&server.board.has(bid))continue;}
     removes.push({op:'remove',type:t,id});out.local++;continue;
    }
    const fields=toServer(t,L,c);
    if(S){const patch:Rec={};const now=fieldsOf(t,fields),was=fieldsOf(t,S);for(const f of FIELDS[t])if(JSON.stringify(now[f])!==JSON.stringify(was[f]))patch[f]=fields[f];out.ops.push({op:'update',type:t,id,patch});}
    else if(T){
     // Cards the studio deleted together with their board come back with the board's restore.
     if(t==='pin'){const bt=tomb('board',fields.boardId);if(bt&&bt.d===T.d&&!byId.board.get(fields.boardId)?.deleted_at)continue;}
     // The restore brings back the studio's last copy; the patch then sends what changed here meanwhile.
     out.ops.push({op:'restore',type:t,id,fields,patch:fields,version:T.v});
    }
    else out.ops.push({op:'create',type:t,id,fields});
    out.local++;continue;
   }
   // The studio moved. Its copy wins; if the device moved too, the device's copy goes on a review card.
   if(L&&lh!==undefined&&lh!==b&&!L.deleted_at)out.conflicts.push({type:t,id:L.id,local:L,at:now});
   if(S){const rec=toLocal(t,S,L,c);if(t==='pin'&&S.fileId&&!Object.values(st.files).includes(S.fileId))st.files[S.fileId]=S.fileId;out.apply[STORES[t]].push(rec);st.base[k]=sh!;}
   else if(T){if(L&&!L.deleted_at)out.apply[STORES[t]].push({...L,deleted_at:T.d,deleted_by:T.by??null,updated_at:now,version:(L.version||0)+1});st.base[k]='deleted';}
   else delete st.base[k]; // gone from the studio without a trace (a refused create): it goes up again
  }
 }
 // Deletes last, cards before boards, so a card moved off a board leaves before the board's delete takes the rest.
 out.ops.push(...removes.reverse());
 return out;
}

// ------------------------------------------------------------------ the app side
export type Host={refresh():void;toast(text:string):void;show(html:string):HTMLDialogElement;setStatus(text:string,state:'off'|'syncing'|'on'|'error'):void};
const readState=():SyncState=>{try{return {...emptyState(),...JSON.parse(localStorage.getItem(STATE_KEY)||'{}')};}catch{return emptyState();}};
const writeState=(s:SyncState|null)=>{try{if(s)localStorage.setItem(STATE_KEY,JSON.stringify(s));else localStorage.removeItem(STATE_KEY);}catch{}};
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const plural=(n:number,w:string)=>`${n} ${w}${n===1?'':'s'}`;
const label=(t:Type,r:Rec)=>t==='board'?`Board “${r.name}”`:t==='pin'?`Card “${r.meta?.title||r.note||r.source_url||'untitled'}”`:`Comment “${r.text||'★'}”`;

let instance:ReturnType<typeof create>|null=null;
/** One studio bridge per page. */
export function connect(host:Host){return instance||=create(host);}

function create(host:Host){
 let studio:Promise<Studio>|null=null,online=true,running:Promise<void>|null=null,again=false,timer:any=null,soon:any=null;
 let status:{state:'off'|'syncing'|'on'|'error';text:string}={state:'off',text:'Studio · signed out'};
 const set=(state:typeof status.state,text:string)=>{status={state,text};host.setStatus(text,state);};
 const client=async()=>(await open()).api;
 function open(){
  if(!studio)studio=Studio.open({baseUrl:location.origin,dbName:DB_NAME}).then(st=>{
   // Pulls drop deleted records from the SDK's copy; keep what the plan needs of them (version, when, by whom).
   const pull=st.api.pull.bind(st.api);
   st.api.pull=async(since:string,limit?:number)=>{const page=await pull(since,limit);const s=readState();for(const ch of page.changes){const k=key(ch.entityType as Type,ch.entityId);if(ch.record.deletedAt)s.tombs[k]={v:ch.record.version,d:ch.record.deletedAt,by:ch.record.deletedBy??null};else delete s.tombs[k];}writeState(s);return page;};
   st.on('status',x=>{online=x.online;});
   st.on('conflict',e=>void noteConflict(e.entityType,e.entityId));
   st.on('rejected',e=>void rejected(e.entityType,e.entityId,e.action,e.message));
   return st;
  });
  return studio;
 }
 async function localRecord(t:Type,id:string){const s=readState();const localId=t==='board'?Object.keys(s.alias).find(k=>s.alias[k]===id)||id:id;return (await database).get(STORES[t],localId) as Promise<Rec|undefined>;}
 async function noteConflict(t:Type,id:string){const L=await localRecord(t,id);if(!L)return;const s=readState();s.conflicts=[...s.conflicts.filter(x=>!(x.type===t&&x.id===L.id)),{type:t,id:L.id,local:L,at:new Date().toISOString()}];writeState(s);host.toast(`${label(t,L)} changed on another device too. The studio kept its version: review it in Studio account.`);}
 async function rejected(t:Type,id:string,act:string,why:string){
  const st=await open(),s=readState(),k=key(t,id),L=await localRecord(t,id),held=!!s.refused[k];
  // A refused create or restore stays on this device until it changes (plan() matches '?' to its state).
  if(/\.(create|restore)$/.test(act)){s.refused[k]={h:'?',why};delete s.base[k];writeState(s);}
  // Anything else: the SDK's copy is read again from the studio, whose version then wins.
  else{try{await st.store.putFromServer(t,id,await st.api.request('GET',`/${PATHS[t]}/${id}`));}catch(e){if((e as ApiError).status===404)await st.store.putFromServer(t,id,null);}}
  if(!held)host.toast(`The studio didn't take a change${L?' to '+label(t,L).charAt(0).toLowerCase()+label(t,L).slice(1):''}: ${why}`);
 }
 /** Compare and queue; merge the studio's changes into the device. Returns how many ops were queued. */
 async function reconcile(){
  const session=readSession();if(!session?.on)return 0;
  const st=await open(),db=await database,s=readState();
  const local:Local={board:await db.getAll('boards'),pin:await db.getAll('pins'),feedback:await db.getAll('feedback')};
  const server={} as Server;for(const t of TYPES)server[t]=new Map((await st.list(t)).map(r=>[r.id,r]));
  const p=plan(local,server,s,session.on);
  for(const o of p.ops){
   if(o.op==='create')await st.create(o.type,{id:o.id,...o.fields});
   else if(o.op==='update')await st.update(o.type,o.id,o.patch!);
   else if(o.op==='remove')await st.remove(o.type,o.id);
   else{await st.restore(o.type,{...o.fields,id:o.id,version:o.version});await st.update(o.type,o.id,o.patch!);}
  }
  if(p.conflicts.length){s.conflicts=[...s.conflicts.filter(x=>!p.conflicts.some(y=>y.type===x.type&&y.id===x.id)),...p.conflicts];host.toast(p.conflicts.length>1?`${p.conflicts.length} things changed on two devices. The studio kept its versions: review them in Studio account.`:`${label(p.conflicts[0].type,p.conflicts[0].local)} changed on two devices. The studio kept its version: review it in Studio account.`);}
  writeState(s);
  if(p.apply.boards.length||p.apply.pins.length||p.apply.feedback.length){await action({type:'library.merge',payload:{...p.apply,fromSync:true,lenient:true,studio:true},recordHistory:false});host.refresh();}
  return p.ops.length;
 }
 /** Upload images of cards the studio has but whose picture it doesn't, one at a time, then attach each to its card. */
 async function uploads(){
  const st=await open(),db=await database,s=readState();let done=0;
  const todo=[] as Rec[];for(const p of await db.getAll('pins'))if(p.file_ref&&!p.deleted_at&&!s.files[p.file_ref]&&!todo.some(x=>x.file_ref===p.file_ref)&&(await st.get('pin',p.id))?.version)todo.push(p);
  for(const [i,p] of todo.entries()){
   const blob=await file(p.file_ref);if(!blob)continue;set('syncing',`Studio · uploading images ${i+1} of ${todo.length}`);
   const type=blob.type||'image/webp';
   const up=await st.api.request('POST','/files/upload-url',{json:{name:`${p.file_ref}.${type.split('/')[1]||'img'}`.slice(0,200),contentType:type,size:blob.size,kind:'photo'}});
   const put=await fetch(up.uploadUrl,{method:'PUT',body:blob,headers:{'content-type':type}});if(!put.ok)throw Error(`An image couldn't be uploaded (${put.status})`);
   await st.api.request('POST',`/files/${up.file.id}/attach`,{json:{entityType:'pin',entityId:p.id}});
   const now=readState();now.files[p.file_ref]=up.file.id;writeState(now);done++;
  }
  return done;
 }
 /** Fetch pictures the device doesn't have yet, by signed link, up to 40 a run. */
 async function downloads(){
  const st=await open(),db=await database,s=readState(),blobs:Record<string,Blob>={};const missing:string[]=[];
  for(const p of await db.getAll('pins'))if(p.file_ref&&!p.deleted_at&&s.files[p.file_ref]&&!missing.includes(p.file_ref)&&!(await file(p.file_ref)))missing.push(p.file_ref);
  for(const ref of missing.slice(0,40)){try{const link=await st.api.request('GET',`/files/${s.files[ref]}/download-url`);const r=await fetch(link.url);if(r.ok)blobs[ref]=await r.blob();}catch(e){if(!(e instanceof ApiError))throw e;}}
  if(!Object.keys(blobs).length)return;
  const res=await action({type:'files.restore',payload:{fromSync:true},blobs,recordHistory:false});if(res.counts.images)host.refresh();
 }
 async function cycle(){
  const st=await open();set('syncing','Studio · syncing…');
  await st.sync();
  for(let i=0;i<4;i++){const queued=await reconcile();const up=await uploads().catch(e=>{if(e instanceof ApiError)throw e;return 0;});if(!queued&&!up)break;await st.sync();}
  await downloads().catch(e=>{if(e instanceof ApiError)throw e;});
  const pending=await st.pendingCount();
  // The SDK reports a dropped connection as a status, not an error.
  const offline=!online;
  set('on',offline?`Studio · offline${pending?' · '+plural(pending,'change')+' waiting':''}`:pending?`Studio · ${plural(pending,'change')} waiting`:`Studio · synced${readState().conflicts.length?' · '+plural(readState().conflicts.length,'card')+' to review':''}`);
 }
 /** Sync now. Safe to call often: overlapping calls share one run. Never throws: problems become the status. */
 function sync(){
  const s=readSession();if(!s?.on||s.expired)return Promise.resolve();
  if(running){again=true;return running;}
  running=(async()=>{try{do{again=false;await cycle();}while(again);}catch(e){
   if(e instanceof ApiError&&e.status===401){expire();return;}
   set('error',`Studio · can't sync just now${e instanceof ApiError&&e.status===503?': the studio can’t be reached':': '+(e as Error).message}`);
  }finally{running=null;}})();
  return running;
 }
 function expire(){const s=readSession();if(s)writeSession({...s,expired:true});stop();set('error','Studio · sign in again');}
 const kick=()=>{if(document.visibilityState!=='hidden')void sync();};
 const onLocal=()=>{clearTimeout(soon);soon=setTimeout(()=>void sync(),1000);};
 function start(){
  const s=readSession();if(!s?.on)return;if(s.expired){set('error','Studio · sign in again');return;}
  if(timer)return;timer=setInterval(kick,20000);
  changes.addEventListener('change',onLocal);addEventListener('online',kick);addEventListener('focus',kick);document.addEventListener('visibilitychange',kick);
  void sync();
 }
 function stop(){if(timer)clearInterval(timer);timer=null;clearTimeout(soon);changes.removeEventListener('change',onLocal);removeEventListener('online',kick);removeEventListener('focus',kick);document.removeEventListener('visibilitychange',kick);}

 // -------------------------------------------------------------- sign-in
 async function signedIn(email:string,me:Rec){
  const prev=readSession(),studioId=me.activeStudioId||null;
  // Back after an ended sign-in as the same person and studio: keep this device's waiting changes. Anyone else starts clean.
  const same=prev&&prev.email===email&&(prev.studioId||null)===studioId;
  if(prev&&!same)await forget();
  writeSession(same?{...prev!,expired:false}:{email,studioId,on:null});
  if(readSession()?.on){start();await sync();}
 }
 async function forget(){
  stop();const was=studio;studio=null;
  if(was){try{(await was).close();}catch{}}
  await new Promise<void>(r=>{const q=indexedDB.deleteDatabase(DB_NAME);q.onsuccess=q.onerror=q.onblocked=()=>r();});
  writeState(null);writeSession(null);set('off','Studio · signed out');
 }
 async function signOut(){
  let n=0;if(studio)n=await (await studio).pendingCount();
  try{await (await client()).logout();}catch{}
  const was=readSession()?.on;await forget();return {n,was};
 }
 /** Switch this device between old sync and studio sync. The page reloads, so only one of them ever runs. */
 function setMode(on:boolean){const s=readSession();if(!s)return;writeSession({...s,on:on?s.on||new Date().toISOString():null});location.reload();}
 async function keepMine(c:Conflict){
  const s=readState();s.conflicts=s.conflicts.filter(x=>!(x.type===c.type&&x.id===c.id));writeState(s);
  // This device's copy goes back on the device as a fresh edit; the next sync sends it to the studio.
  const now=new Date().toISOString(),cur=await (await database).get(STORES[c.type],c.id);
  await action({type:'library.merge',payload:{boards:[],pins:[],feedback:[],[STORES[c.type]]:[{...c.local,updated_at:now,version:(cur?.version||c.local.version||0)+1}],studio:true,lenient:true},recordHistory:false});
  host.refresh();await sync();
 }
 function dropConflict(c:Conflict){const s=readState();s.conflicts=s.conflicts.filter(x=>!(x.type===c.type&&x.id===c.id));writeState(s);}

 // -------------------------------------------------------------- the panel
 function panel(){
  const s=readSession();
  if(!s||s.expired){
   const d=host.show(`<div class="dialog-heading"><div class="eyebrow">STUDIO ACCOUNT</div><h2>${s?.expired?'Sign in again':'Sign in to your studio'}</h2><p>${s?.expired?`Your studio sign-in has ended. Sign in again as ${esc(s.email)}; changes made since are kept on this device and go up once you do.`:'Signing in lets this device sync through your studio (the platform your other tools use). Nothing changes until you switch this device to studio sync. Signed out, Studio Wall works exactly as before.'}</p></div>
<form id="st-form" class="studio-form"><label>Email<input id="st-email" type="email" autocomplete="email" required value="${esc(s?.email||'')}"></label>
<div class="pin-actions"><button type="button" class="primary" id="st-send">Send me a code</button><button type="button" id="st-pw-show">Use my password</button></div>
<div id="st-pw-row" hidden><label>Password<input id="st-pw" type="password" autocomplete="current-password" maxlength="200"></label><div class="pin-actions"><button type="button" class="primary" id="st-pw-go">Sign in with password</button></div><p class="hint">No password yet? Sign in with a code first, then set one here.</p></div>
<div id="st-code-row" hidden><label>The 6-digit code from the email<input id="st-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></label><div class="pin-actions"><button type="button" class="primary" id="st-verify">Sign in</button></div></div>
<p class="error" id="st-msg" role="status"></p></form>`);
   const $=<T extends HTMLElement>(q:string)=>d.querySelector<T>(q)!;
   const msg=(t:string,bad=false)=>{$('#st-msg').textContent=t;$('#st-msg').className=bad?'error':'hint';};
   const email=()=>$<HTMLInputElement>('#st-email').value.trim().toLowerCase();
   const failed=(e:unknown)=>msg((e as ApiError).status===503?'The studio can’t be reached from here just now. Studio Wall keeps working on this device.':(e as Error).message||'That didn’t work. Try again.',true);
   $<HTMLFormElement>('#st-form').onsubmit=e=>e.preventDefault();
   $('#st-send').onclick=async()=>{if(!/^\S+@\S+\.\S+$/.test(email()))return msg('Type the email you use for the studio.',true);msg('Sending…');try{await (await client()).requestCode(email());$('#st-code-row').hidden=false;$('#st-code').focus();msg('Check your email for a 6-digit code.');}catch(e){failed(e);}};
   $('#st-pw-show').onclick=()=>{$('#st-pw-row').hidden=false;$('#st-pw').focus();};
   const pw=async()=>{if(!/^\S+@\S+\.\S+$/.test(email()))return msg('Type the email you use for the studio.',true);msg('Signing in…');try{await signedIn(email(),await (await client()).request('POST','/auth/password/login',{json:{email:email(),password:$<HTMLInputElement>('#st-pw').value}}));panel();}catch(e){failed(e);}};
   $('#st-pw-go').onclick=pw;$('#st-pw').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void pw();}};
   const verify=async()=>{msg('Signing in…');try{await signedIn(email(),await (await client()).verify(email(),$<HTMLInputElement>('#st-code').value.trim()));panel();}catch(e){failed(e);}};
   $('#st-verify').onclick=verify;$('#st-code').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();void verify();}};
   return d;
  }
  const st=readState();
  const d=host.show(`<div class="dialog-heading"><div class="eyebrow">STUDIO ACCOUNT</div><h2>Your studio</h2><p id="st-signed-in">Signed in as <strong>${esc(s.email)}</strong>.</p></div>
<section class="studio-mode"><h3>How this device syncs</h3>
<label class="studio-choice"><input type="radio" name="st-mode" value="old" ${s.on?'':'checked'}><span><strong>Old sync</strong> · the way Studio Wall has always synced. Client links work.</span></label>
<label class="studio-choice"><input type="radio" name="st-mode" value="studio" ${s.on?'checked':''}><span><strong>Studio sync</strong> · through your studio, with your other devices that use it. Boards, cards and comments made here from now on go up; your older ones wait for “Import my library”, coming next. Client links need old sync until they move too.</span></label>
<p class="hint">Switching reloads Studio Wall. Nothing on this device is deleted either way.</p>
${s.on?`<p class="sync-label hint" id="st-status">${esc(status.text)}</p><div class="pin-actions"><button id="st-sync">Sync now</button></div>`:''}</section>
${st.conflicts.length?`<section class="studio-review"><h3>To review</h3>${st.conflicts.map((c,i)=>`<article><p><strong>${esc(label(c.type,c.local))}</strong> changed on this device and another one at the same time. The studio kept the other version.</p><div class="pin-actions"><button data-keep="${i}" class="primary">Use this device’s version</button><button data-drop="${i}">Keep the studio’s</button></div></article>`).join('')}</section>`:''}
${Object.keys(st.refused).length?`<section><h3>Not in the studio</h3>${Object.values(st.refused).map(r=>`<p class="hint">${esc(r.why)}</p>`).join('')}<p class="hint">These stay on this device. Change them to try again.</p></section>`:''}
<section><h3>Password</h3><p class="hint" id="st-pw-state">Optional: sign in next time with a password instead of an emailed code. The code always works too.</p><label>New password (10 characters or more)<input id="st-newpw" type="password" autocomplete="new-password" maxlength="200"></label><div class="pin-actions"><button id="st-setpw">Set password</button><button id="st-rmpw" hidden>Remove password</button></div><p class="hint" id="st-pw-msg" role="status"></p></section>
<div class="pin-actions"><button class="danger" id="st-signout">Sign out of the studio</button></div>`);
  const $=<T extends HTMLElement>(q:string)=>d.querySelector<T>(q)!;
  d.querySelectorAll<HTMLInputElement>('[name=st-mode]').forEach(r=>r.onchange=()=>{if(r.checked&&(r.value==='studio')!==!!s.on)setMode(r.value==='studio');});
  d.querySelector<HTMLButtonElement>('#st-sync')?.addEventListener('click',async()=>{await sync();panel();});
  d.querySelectorAll<HTMLButtonElement>('[data-keep]').forEach(b=>b.onclick=async()=>{await keepMine(st.conflicts[Number(b.dataset.keep)]);panel();});
  d.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach(b=>b.onclick=()=>{dropConflict(st.conflicts[Number(b.dataset.drop)]);panel();});
  const pwMsg=(t:string,bad=false)=>{$('#st-pw-msg').textContent=t;$('#st-pw-msg').className=bad?'error':'hint';};
  const showPw=(has:boolean)=>{$('#st-setpw').textContent=has?'Change password':'Set password';$('#st-rmpw').hidden=!has;$('#st-pw-state').textContent=has?'You have a password: sign in with it or with an emailed code.':'Optional: sign in next time with a password instead of an emailed code. The code always works too.';};
  const setBtn=$('#st-setpw');client().then(c=>c.me()).then(me=>{if(setBtn.isConnected)showPw(!!me.hasPassword);},e=>{if((e as ApiError).status===401&&setBtn.isConnected){expire();panel();}});
  setBtn.onclick=async()=>{const pw=$<HTMLInputElement>('#st-newpw').value;if(pw.length<10)return pwMsg('Use at least 10 characters.',true);pwMsg('Saving…');try{await (await client()).request('PUT','/auth/password',{json:{password:pw}});$<HTMLInputElement>('#st-newpw').value='';showPw(true);pwMsg('Password set. Your other devices were signed out; sign in there with it or a code.');}catch(e){pwMsg((e as Error).message,true);}};
  $('#st-rmpw').onclick=async()=>{try{await (await client()).request('DELETE','/auth/password');showPw(false);pwMsg('Password removed. Sign in with an emailed code.');}catch(e){pwMsg((e as Error).message,true);}};
  $('#st-signout').onclick=async()=>{const {n,was}=await signOut();host.toast(n?`Signed out. ${plural(n,'change')} that hadn't reached the studio stay on this device.`:'Signed out of the studio. Everything stays on this device.');if(was)location.reload();else panel();};
  return d;
 }
 return {start,sync,panel,status:()=>status};
}
