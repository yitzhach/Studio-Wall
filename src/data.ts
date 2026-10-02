import {openDB} from 'idb';
import {ulid} from 'ulid';
export type Base={id:string;studio_id:string;created_at:string;updated_at:string;created_by:string;actor_type:'human'|'assistant';version:number;deleted_at:string|null};
export type Board=Base & {name:string;description:string;cover_pin_id:string|null;visibility:'private'|'shared_link';position:number;share_settings?:{mode:'public'|'private'|'password';permission:'view'|'comment'|'contribute'}};
export type Pin=Base & {board_id:string;file_ref:string|null;source_url:string;source_credit:string;is_own:boolean;note:string;tags:string[];palette:string[];linked_type:string|null;linked_id:string|null;meta:{kind:'image'|'idea'|'link';title:string}};
export type Feedback=Base & {board_id:string;pin_id:string|null;text:string;starred?:boolean};
export type Action={type:string;id?:string;payload?:any;blob?:Blob};
export const STUDIO='local-studio';
export const database=openDB('studio-wall-v1',1,{upgrade(db){for(const store of ['boards','pins','feedback','activity_log','outbox'])db.createObjectStore(store,{keyPath:'id'});db.createObjectStore('files');}});
const base=():Base=>{const now=new Date().toISOString();return {id:ulid(),studio_id:STUDIO,created_at:now,updated_at:now,created_by:'local-owner',actor_type:'human',version:1,deleted_at:null};};
export async function snapshot(){const db=await database;const [boards,pins,feedback]=await Promise.all(['boards','pins','feedback'].map(s=>db.getAll(s)));return {boards:(boards as Board[]).filter(b=>!b.deleted_at).sort((a,b)=>a.position-b.position),pins:(pins as Pin[]).filter(p=>!p.deleted_at),feedback:(feedback as Feedback[]).filter(f=>!f.deleted_at)};}
export async function file(id:string){return (await database).get('files',id) as Promise<Blob|undefined>;}
export async function action(a:Action){
 const db=await database; const tx=db.transaction(['boards','pins','files','feedback','activity_log','outbox'],'readwrite');
 const b=base();let result:any;const p=a.payload||{};
 try{
 if(a.type==='pin.batch'){
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
 else if(a.type==='pin.save'){
 const board=await tx.objectStore('boards').get(p.board_id);if(!board||board.deleted_at)throw Error('Choose an existing board.');
 if(!a.blob&&!p.source_url&&!p.note?.trim())throw Error('Add an image, link or idea.');
 if(p.source_url&&!/^https?:\/\//i.test(p.source_url))throw Error('Use a complete http or https link.');
 result={...b,board_id:p.board_id,file_ref:a.blob?ulid():null,source_url:p.source_url||'',source_credit:p.source_credit||'',is_own:!!p.is_own,note:p.note||'',tags:p.tags||[],palette:p.palette||[],linked_type:null,linked_id:null,meta:{kind:a.blob?'image':p.source_url?'link':'idea',title:p.title||''}};
 if(a.blob)await tx.objectStore('files').put(a.blob,result.file_ref);await tx.objectStore('pins').put(result);
 }else if(a.type==='feedback.star'){
 const board=await tx.objectStore('boards').get(p.board_id);const pin=await tx.objectStore('pins').get(p.pin_id);if(!board||board.deleted_at||!pin||pin.deleted_at||pin.board_id!==board.id)throw Error('Choose a reference in this board.');
 const existing=(await tx.objectStore('feedback').getAll()).find(f=>!f.deleted_at&&f.board_id===board.id&&f.pin_id===pin.id&&f.created_by===b.created_by&&typeof f.starred==='boolean');
 result=existing?{...existing,starred:!existing.starred,updated_at:b.updated_at,version:existing.version+1}:{...b,board_id:board.id,pin_id:pin.id,text:'',starred:true};await tx.objectStore('feedback').put(result);
 }else if(a.type==='feedback.add'){
 const board=await tx.objectStore('boards').get(p.board_id);if(!board||board.deleted_at||!p.text?.trim())throw Error('Add a comment to an existing board.');if(p.pin_id){const pin=await tx.objectStore('pins').get(p.pin_id);if(!pin||pin.deleted_at||pin.board_id!==p.board_id)throw Error('Comment reference must belong to this board.');}result={...b,board_id:p.board_id,pin_id:p.pin_id||null,text:p.text.trim()};await tx.objectStore('feedback').put(result);
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
 if(p.position!==undefined)result.position=p.position;
 if(p.cover_pin_id!==undefined){const pin=await tx.objectStore('pins').get(p.cover_pin_id);if(!pin||pin.board_id!==result.id||pin.deleted_at)throw Error('Cover must belong to this board.');result.cover_pin_id=p.cover_pin_id;}
 }else if(entity==='pin'&&['update','move','link'].includes(op)){
 if(p.board_id){const dest=await tx.objectStore('boards').get(p.board_id);if(!dest||dest.deleted_at)throw Error('Choose an existing board.');result.board_id=p.board_id;}
 for(const k of ['note','tags','source_url','source_credit','is_own','linked_type','linked_id'])if(p[k]!==undefined)result[k]=p[k];
 if(result.source_url&&!/^https?:\/\//i.test(result.source_url))throw Error('Use a complete http or https link.');
 if(p.title!==undefined)result.meta.title=p.title;
 }else throw Error('Unknown action');
 result.updated_at=b.updated_at;result.version++;await store.put(result);
 }
 const event={...base(),action:a.type,record_id:result.id,record:result};await tx.objectStore('activity_log').put(event);await tx.objectStore('outbox').put({...event,status:'pending',attempts:0});await tx.done;return result;
 }catch(e){tx.abort();await tx.done.catch(()=>{});throw e;}
}
export async function initialize(){const db=await database;if(!(await db.count('boards')))await action({type:'board.create',payload:{name:'Inbox',description:'Save now. Organize when inspiration settles.'}});}
