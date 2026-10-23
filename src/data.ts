import {openDB} from 'idb';
import {ulid} from 'ulid';
export type Base={id:string;studio_id:string;created_at:string;updated_at:string;created_by:string;actor_type:'human'|'assistant';version:number;deleted_at:string|null};
export type Board=Base & {name:string;description:string;cover_pin_id:string|null;visibility:'private'|'shared_link';position:number;comments_enabled?:boolean;share_settings?:{mode:'public'|'private'|'password';permission:'view'|'comment'|'contribute'}};
export type Annotation={id:string;tool:'pen'|'circle'|'arrow';points:{x:number;y:number}[];comment:string};
export type Pin=Base & {board_id:string;file_ref:string|null;source_url:string;source_credit:string;is_own:boolean;note:string;tags:string[];palette:string[];linked_type:string|null;linked_id:string|null;annotations?:Annotation[];meta:{kind:'image'|'idea'|'link';title:string};contributor_name?:string};
export type Feedback=Base & {board_id:string;pin_id:string|null;text:string;starred?:boolean;author_name?:string};
export type Action={type:string;id?:string;payload?:any;blob?:Blob;blobs?:Record<string,Blob>;recordHistory?:boolean};
export const STUDIO='local-studio';
/** Deleted boards and cards can be restored for this many days; afterwards their unused image files are cleaned up. */
export const RETENTION_DAYS=30;
// Fires after every committed local write so sync can push it; sync's own merges are marked fromSync.
export const changes=new EventTarget();
export const database=openDB('studio-wall-v1',1,{upgrade(db){for(const store of ['boards','pins','feedback','activity_log','outbox'])db.createObjectStore(store,{keyPath:'id'});db.createObjectStore('files');}});
const base=():Base=>{const now=new Date().toISOString();return {id:ulid(),studio_id:STUDIO,created_at:now,updated_at:now,created_by:'local-owner',actor_type:'human',version:1,deleted_at:null};};
type HistoryState={boards:any[];pins:any[];feedback:any[]};
const undoStack:HistoryState[]=[],redoStack:HistoryState[]=[];
async function currentHistoryState():Promise<HistoryState>{const db=await database;const [boards,pins,feedback]=await Promise.all([db.getAll('boards'),db.getAll('pins'),db.getAll('feedback')]);return {boards,pins,feedback};}
async function restoreHistoryState(state:HistoryState){const db=await database;const tx=db.transaction(['boards','pins','feedback'],'readwrite');for(const key of ['boards','pins','feedback'] as const){await tx.objectStore(key).clear();for(const record of state[key])await tx.objectStore(key).put(record);}await tx.done;}
function remember(state:HistoryState){undoStack.push(state);if(undoStack.length>30)undoStack.shift();redoStack.length=0;}
export function historyStatus(){return {canUndo:undoStack.length>0,canRedo:redoStack.length>0};}
export function resetHistory(){undoStack.length=0;redoStack.length=0;}
export async function undo(){const previous=undoStack.pop();if(!previous)return false;redoStack.push(await currentHistoryState());await restoreHistoryState(previous);return true;}
export async function redo(){const next=redoStack.pop();if(!next)return false;undoStack.push(await currentHistoryState());await restoreHistoryState(next);return true;}
export async function snapshot(){const db=await database;const [boards,pins,feedback]=await Promise.all(['boards','pins','feedback'].map(s=>db.getAll(s)));return {boards:(boards as Board[]).filter(b=>!b.deleted_at).sort((a,b)=>a.position-b.position),pins:(pins as Pin[]).filter(p=>!p.deleted_at),feedback:(feedback as Feedback[]).filter(f=>!f.deleted_at)};}
export async function file(id:string){return (await database).get('files',id) as Promise<Blob|undefined>;}
export async function action(a:Action){
 const db=await database; const tx=db.transaction(['boards','pins','files','feedback','activity_log','outbox'],'readwrite');
 const b=base();let result:any;const p=a.payload||{};const before=a.recordHistory===false?null:{boards:await tx.objectStore('boards').getAll(),pins:await tx.objectStore('pins').getAll(),feedback:await tx.objectStore('feedback').getAll()};
 try{
 if(a.type==='library.merge'){
 // Merge a full-library backup from another device. Records keep their IDs; the newer updated_at wins, so repeated imports only add or update what changed.
 const incoming={boards:p.boards,pins:p.pins,feedback:p.feedback||[]};if(!Array.isArray(incoming.boards)||!Array.isArray(incoming.pins)||!Array.isArray(incoming.feedback))throw Error('This backup is not supported.');
 const okId=(v:unknown)=>typeof v==='string'&&/^[0-9A-Za-z_-]{1,64}$/.test(v);const okTime=(v:unknown)=>typeof v==='string'&&!isNaN(Date.parse(v));
 const boards=tx.objectStore('boards'),pins=tx.objectStore('pins'),feedback=tx.objectStore('feedback'),files=tx.objectStore('files');
 const localInbox=(await boards.getAll()).find(x=>x.name==='Inbox'&&!x.deleted_at);const remap=new Map<string,string>();const counts={boards:0,pins:0,feedback:0,images:0,skipped:0};
 // Sync merges are lenient: one bad record or a not-yet-available image must not block everything else.
 const lenient=p.lenient===true;
 const newer=async(store:any,r:any)=>{const cur=await store.get(r.id);return !cur||Date.parse(r.updated_at)>Date.parse(cur.updated_at);};
 for(const r of incoming.boards){if(!okId(r?.id)||typeof r.name!=='string'||!r.name.trim()||!okTime(r.updated_at)){if(lenient){counts.skipped++;continue;}throw Error('This backup contains an invalid board.');}
 if(r.name==='Inbox'&&localInbox&&r.id!==localInbox.id){remap.set(r.id,localInbox.id);continue;}
 if(await newer(boards,r)){await boards.put({...r,studio_id:STUDIO,description:String(r.description||''),visibility:'private',cover_pin_id:okId(r.cover_pin_id)?r.cover_pin_id:null,position:Number(r.position)||0});counts.boards++;}}
 for(const r of incoming.pins){if(!okId(r?.id)||!okId(r.board_id)||!okTime(r.updated_at)||typeof r.note!=='string'||!Array.isArray(r.tags)||!r.tags.every((t:unknown)=>typeof t==='string')||!Array.isArray(r.palette)||!r.palette.every((c:unknown)=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c))||r.source_url&&!/^https?:\/\//i.test(r.source_url)||r.file_ref!==null&&!okId(r.file_ref)){if(lenient){counts.skipped++;continue;}throw Error('This backup contains an invalid reference.');}
 const board_id=remap.get(r.board_id)||r.board_id;if(!(await boards.get(board_id))){if(lenient){counts.skipped++;continue;}throw Error('This backup is missing a board.');}
 if(r.file_ref&&!(await files.get(r.file_ref))){const blob=a.blobs?.[r.file_ref];if(blob){await files.put(blob,r.file_ref);counts.images++;}else if(!lenient)throw Error('This backup is missing an image.');}
 if(await newer(pins,r)){await pins.put({...r,studio_id:STUDIO,board_id,meta:{kind:['image','idea','link'].includes(r.meta?.kind)?r.meta.kind:'idea',title:String(r.meta?.title||'')}});counts.pins++;}}
 for(const r of incoming.feedback){if(!okId(r?.id)||!okId(r.board_id)||!okTime(r.updated_at)||typeof r.text!=='string'||r.text.length>4000){if(lenient){counts.skipped++;continue;}throw Error('This backup contains an invalid comment.');}const board_id=remap.get(r.board_id)||r.board_id;if(!(await boards.get(board_id))){if(lenient){counts.skipped++;continue;}throw Error('This backup is missing a board.');}if(await newer(feedback,r)){await feedback.put({...r,studio_id:STUDIO,board_id});counts.feedback++;}}
 result={id:b.id,counts};
 }else if(a.type==='board.import'){
 // Single-board ZIP import: new IDs for the board, cards and image refs; credits, notes, palettes and markup are kept.
 if(typeof p.name!=='string'||!p.name.trim()||!Array.isArray(p.pins)||p.pins.length>1000)throw Error('This board export is not supported.');
 const board={...base(),name:p.name.trim(),description:String(p.description||''),cover_pin_id:null,visibility:'private',position:(await tx.objectStore('boards').getAll()).length};await tx.objectStore('boards').put(board);
 const pins=[];
 for(const src of p.pins){const blob=src.file_ref?a.blobs?.[src.file_ref]:undefined;if(src.file_ref&&!blob)throw Error('This board contains invalid or missing data.');
  if(src.source_url&&!/^https?:\/\//i.test(src.source_url))throw Error('Use a complete http or https link.');
  const file_ref=blob?ulid():null;const pin={...base(),board_id:board.id,file_ref,source_url:src.source_url||'',source_credit:String(src.source_credit||''),is_own:!!src.is_own,note:String(src.note||''),tags:Array.isArray(src.tags)?src.tags.map(String):[],palette:Array.isArray(src.palette)?src.palette.filter((c:unknown)=>typeof c==='string'&&/^#[0-9a-f]{6}$/i.test(c)):[],linked_type:null,linked_id:null,annotations:Array.isArray(src.annotations)?src.annotations:[],meta:{kind:['image','idea','link'].includes(src.meta?.kind)?src.meta.kind:blob?'image':src.source_url?'link':'idea',title:String(src.meta?.title||'')}};
  if(blob&&file_ref)await tx.objectStore('files').put(blob,file_ref);await tx.objectStore('pins').put(pin);pins.push(pin);}
 result={id:board.id,board,pins};
 }else if(a.type==='files.restore'){
 // Backfill image blobs that arrived after their pins; only files a pin references and that are still missing.
 const files=tx.objectStore('files');const refs=new Set((await tx.objectStore('pins').getAll()).map(x=>x.file_ref).filter(Boolean));let images=0;
 for(const [ref,blob] of Object.entries(a.blobs||{}))if(refs.has(ref)&&!(await files.get(ref))){await files.put(blob,ref);images++;}
 result={id:b.id,counts:{images}};
 }else if(a.type==='pin.batch'){
 if(!['copy','move'].includes(p.operation)||!Array.isArray(p.ids)||!p.ids.length)throw Error('Select references and choose copy or move.');
 let dest=await tx.objectStore('boards').get(p.board_id||'');
 if(p.new_board_name?.trim()){dest={...base(),name:p.new_board_name.trim(),description:'',cover_pin_id:null,visibility:'private',position:(await tx.objectStore('boards').getAll()).length};await tx.objectStore('boards').put(dest);}
 if(!dest||dest.deleted_at)throw Error('Choose an existing board.');
 const records=[];
 for(const id of [...new Set(p.ids)]){const pin=await tx.objectStore('pins').get(id as string);if(!pin||pin.deleted_at)throw Error('A selected reference is no longer available.');
 const next=p.operation==='copy'?{...pin,...base(),board_id:dest.id}:{...pin,board_id:dest.id,updated_at:b.updated_at,version:pin.version+1};await tx.objectStore('pins').put(next);records.push(next);}
 result={id:dest.id,board:dest,pins:records};
 }else if(a.type==='board.share_settings'){
 if(!['public','private','password'].includes(p.mode)||!['view','comment','contribute'].includes(p.permission))throw Error('Choose valid sharing settings.');
 result=await tx.objectStore('boards').get(a.id!);if(!result||result.deleted_at)throw Error('Board not found.');result={...result,share_settings:{mode:p.mode,permission:p.permission},updated_at:b.updated_at,version:result.version+1};await tx.objectStore('boards').put(result);
 }else if(a.type==='board.create'){if(!p.name?.trim())throw Error('Give your board a name.');result={...b,name:p.name.trim(),description:p.description||'',cover_pin_id:null,visibility:'private',position:(await tx.objectStore('boards').getAll()).length};await tx.objectStore('boards').put(result);}
 else if(a.type==='pin.save'||a.type==='pin.save_batch'){
 // A batch (several images from one upload) saves every card or none.
 const items:{payload:any;blob?:Blob}[]=a.type==='pin.save'?[{payload:p,blob:a.blob}]:Array.isArray(p.items)&&p.items.length&&p.items.length<=200?p.items.map((x:any,i:number)=>({payload:x,blob:a.blobs?.[String(i)]})):[];
 if(!items.length)throw Error('Add an image, link or idea.');
 const saved=[];
 for(const {payload:q,blob} of items){
  const board=await tx.objectStore('boards').get(q.board_id);if(!board||board.deleted_at)throw Error('Choose an existing board.');
  if(!blob&&!q.source_url&&!q.note?.trim())throw Error('Add an image, link or idea.');
  if(q.source_url&&!/^https?:\/\//i.test(q.source_url))throw Error('Use a complete http or https link.');
  const pin={...base(),board_id:q.board_id,file_ref:blob?ulid():null,source_url:q.source_url||'',source_credit:q.source_credit||'',is_own:!!q.is_own,note:q.note||'',tags:q.tags||[],palette:q.palette||[],linked_type:null,linked_id:null,annotations:[],meta:{kind:blob?'image':q.source_url?'link':'idea',title:q.title||''}};
  if(blob&&pin.file_ref)await tx.objectStore('files').put(blob,pin.file_ref);await tx.objectStore('pins').put(pin);saved.push(pin);}
 result=a.type==='pin.save'?saved[0]:{id:saved[0].id,pins:saved};
 }else if(a.type==='feedback.star'){
 const board=await tx.objectStore('boards').get(p.board_id);const pin=await tx.objectStore('pins').get(p.pin_id);if(!board||board.deleted_at||!pin||pin.deleted_at||pin.board_id!==board.id)throw Error('Choose a reference in this board.');
 const existing=(await tx.objectStore('feedback').getAll()).find(f=>!f.deleted_at&&f.board_id===board.id&&f.pin_id===pin.id&&f.created_by===b.created_by&&typeof f.starred==='boolean');
 result=existing?{...existing,starred:!existing.starred,updated_at:b.updated_at,version:existing.version+1}:{...b,board_id:board.id,pin_id:pin.id,text:'',starred:true};await tx.objectStore('feedback').put(result);
 }else if(a.type==='feedback.add'){
 const board=await tx.objectStore('boards').get(p.board_id);if(!board||board.deleted_at||!p.text?.trim())throw Error('Add a comment to an existing board.');if(p.client_preview&&(board.comments_enabled===false||board.share_settings?.permission==='view'))throw Error('Comments are turned off for this board.');if(p.text.trim().length>4000)throw Error('Keep comments under 4,000 characters.');if(p.pin_id){const pin=await tx.objectStore('pins').get(p.pin_id);if(!pin||pin.deleted_at||pin.board_id!==p.board_id)throw Error('Comment reference must belong to this board.');}result={...b,board_id:p.board_id,pin_id:p.pin_id||null,text:p.text.trim()};await tx.objectStore('feedback').put(result);
 }else if(a.type==='pin.restore'||a.type==='board.restore'){
 // Undo a delete within the retention window. A card whose board is gone returns to the Inbox; a board brings back the cards deleted with it.
 const store=tx.objectStore(a.type==='pin.restore'?'pins':'boards');result=await store.get(a.id!);if(!result||!result.deleted_at)throw Error('This item is not in Recently deleted.');
 if(Date.parse(result.deleted_at)<Date.now()-RETENTION_DAYS*86400_000)throw Error('This item was deleted too long ago to restore.');
 const removedAt=result.deleted_at;result={...result,deleted_at:null,updated_at:b.updated_at,version:result.version+1};
 if(a.type==='pin.restore'){const board=await tx.objectStore('boards').get(result.board_id);if(!board||board.deleted_at){const inbox=(await tx.objectStore('boards').getAll()).find(x=>x.name==='Inbox'&&!x.deleted_at);if(!inbox)throw Error('Restore its board first.');result.board_id=inbox.id;}}
 else for(const pin of await tx.objectStore('pins').getAll())if(pin.board_id===result.id&&pin.deleted_at===removedAt)await tx.objectStore('pins').put({...pin,deleted_at:null,updated_at:b.updated_at,version:pin.version+1});
 await store.put(result);
 }else if(a.type==='files.purge'){
 // Free device storage: drop image files of cards deleted more than RETENTION_DAYS ago, unless any live or recently deleted card shares the file.
 const cutoff=Date.now()-RETENTION_DAYS*86400_000,keep=new Set<string>(),old=new Set<string>();
 for(const pin of await tx.objectStore('pins').getAll())if(pin.file_ref)(pin.deleted_at&&Date.parse(pin.deleted_at)<cutoff?old:keep).add(pin.file_ref);
 let images=0;for(const ref of old)if(!keep.has(ref)&&await tx.objectStore('files').get(ref)){await tx.objectStore('files').delete(ref);images++;}
 result={id:b.id,counts:{images}};
 }else if(a.type==='board.share'||a.type==='board.start_artwork'){throw Error('This needs your shared backend. No link has been created.');}
 else {
 const [entity,op]=a.type.split('.');if(!['board','pin'].includes(entity))throw Error('Unknown action');
 const store=tx.objectStore(entity==='board'?'boards':'pins');result=await store.get(a.id!);if(!result||result.deleted_at)throw Error('This item is no longer available.');
 if(op==='delete'){
 if(entity==='board'&&result.name==='Inbox')throw Error('Keep Inbox for new saves.');result.deleted_at=b.updated_at;
 if(entity==='board')for(const pin of await tx.objectStore('pins').getAll())if(pin.board_id===result.id&&!pin.deleted_at)await tx.objectStore('pins').put({...pin,deleted_at:b.updated_at,updated_at:b.updated_at,version:pin.version+1});
 }else if(entity==='board'&&op==='update'){
 if(p.name!==undefined){if(!p.name.trim())throw Error('Give your board a name.');result.name=p.name.trim();}
 if(p.description!==undefined)result.description=p.description;
 if(p.comments_enabled!==undefined){if(typeof p.comments_enabled!=='boolean')throw Error('Choose whether comments are enabled.');result.comments_enabled=p.comments_enabled;}
 if(p.position!==undefined)result.position=p.position;
 if(p.cover_pin_id!==undefined){const pin=await tx.objectStore('pins').get(p.cover_pin_id);if(!pin||pin.board_id!==result.id||pin.deleted_at)throw Error('Cover must belong to this board.');result.cover_pin_id=p.cover_pin_id;}
 }else if(entity==='pin'&&['update','move','link'].includes(op)){
 if(p.board_id){const dest=await tx.objectStore('boards').get(p.board_id);if(!dest||dest.deleted_at)throw Error('Choose an existing board.');result.board_id=p.board_id;}
 for(const k of ['note','tags','source_url','source_credit','is_own','linked_type','linked_id','annotations'])if(p[k]!==undefined)result[k]=p[k];
 if(result.source_url&&!/^https?:\/\//i.test(result.source_url))throw Error('Use a complete http or https link.');
 if(p.title!==undefined)result.meta.title=p.title;
 }else throw Error('Unknown action');
 result.updated_at=b.updated_at;result.version++;await store.put(result);
 }
 // A routine storage cleanup that removed nothing is not worth an activity entry.
 if(!(a.type==='files.purge'&&!result.counts.images)){const event={...base(),action:a.type,record_id:result.id,record:result};await tx.objectStore('activity_log').put(event);await tx.objectStore('outbox').put({...event,status:'pending',attempts:0});}await tx.done;if(before)remember(before);if(!p.fromSync)changes.dispatchEvent(new Event('change'));return result;
 }catch(e){tx.abort();await tx.done.catch(()=>{});throw e;}
}
export async function initialize(){const db=await database;if(!(await db.count('boards')))await action({type:'board.create',payload:{name:'Inbox',description:'Save now. Organize when inspiration settles.'},recordHistory:false});}

/** Boards and cards deleted within the retention window, newest first. Cards deleted together with their board are listed under the board. */
export async function recentlyDeleted(){
 const db=await database;const cutoff=Date.now()-RETENTION_DAYS*86400_000;const [boards,pins]=await Promise.all([db.getAll('boards'),db.getAll('pins')]) as [Board[],Pin[]];
 const recent=(x:{deleted_at:string|null})=>!!x.deleted_at&&Date.parse(x.deleted_at)>=cutoff;const byId=new Map(boards.map(x=>[x.id,x]));
 const deletedBoards=boards.filter(recent).map(board=>({board,count:pins.filter(p=>p.board_id===board.id&&p.deleted_at===board.deleted_at).length}));
 const deletedPins=pins.filter(p=>recent(p)&&byId.get(p.board_id)?.deleted_at!==p.deleted_at);
 const newest=(a:{deleted_at:string|null},b:{deleted_at:string|null})=>String(b.deleted_at).localeCompare(String(a.deleted_at));
 return {boards:deletedBoards.sort((a,b)=>newest(a.board,b.board)),pins:deletedPins.sort(newest)};
}
