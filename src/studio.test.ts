// Stage 3 of docs/backend-and-ai-plan.md: how studio sync compares the device with the studio (src/studio.ts plan()).
import 'fake-indexeddb/auto';
import {describe,it,expect} from 'vitest';
import {plan,toServer,emptyState,hashOf,type Local,type Server,type SyncState} from './studio';

const SINCE='2026-10-26T00:00:00.000Z',BEFORE='2026-10-01T00:00:00.000Z',AFTER='2026-10-26T01:00:00.000Z';
const id=(n:number)=>'01J'+String(n).padStart(23,'0');
const rec=(x:any)=>({studio_id:'local-studio',created_at:AFTER,updated_at:AFTER,created_by:'local-owner',actor_type:'human',version:1,deleted_at:null,...x});
const board=(n:number,x:any={})=>rec({id:id(n),name:'Board '+n,description:'',cover_pin_id:null,visibility:'private',position:n,...x});
const pin=(n:number,b:number,x:any={})=>rec({id:id(n),board_id:id(b),file_ref:null,source_url:'',source_credit:'',is_own:false,note:'note '+n,tags:[],palette:[],linked_type:null,linked_id:null,annotations:[],meta:{kind:'idea',title:''},...x});
const local=(x:Partial<Local>={}):Local=>({board:[],pin:[],feedback:[],...x});
const none=():Server=>({board:new Map(),pin:new Map(),feedback:new Map()});
/** The studio's copy of local records, as the SDK holds it after they went up. */
function mirror(l:Local,st:SyncState,v=1):Server{
 const s=none(),c={alias:st.alias,files:st.files,scope:new Set([...l.board,...l.pin,...l.feedback].map(r=>r.id))};
 for(const t of ['board','pin','feedback'] as const)for(const r of l[t])if(!r.deleted_at)s[t].set(t==='board'?st.alias[r.id]||r.id:r.id,{id:t==='board'?st.alias[r.id]||r.id:r.id,version:v,deletedAt:null,createdAt:r.created_at,updatedAt:r.updated_at,...toServer(t,r,c)});
 return s;
}
const agree=(l:Local,st:SyncState)=>{const s=mirror(l,st);plan(l,s,st,SINCE);return s;};

describe('what goes up',()=>{
 it('sends the Inbox and what was made since switching on; older boards wait for the import',()=>{
  const l=local({board:[board(1,{name:'Inbox',created_at:BEFORE}),board(2,{created_at:BEFORE}),board(3)]});
  const p=plan(l,none(),emptyState(),SINCE);
  expect(p.ops.map(o=>[o.op,o.id])).toEqual([['create',id(1)],['create',id(3)]]);
  expect(p.ops[1].fields).toEqual({name:'Board 3',description:null,coverPinId:null,position:3,commentsEnabled:true});
 });
 it('takes an older board along when a new card goes on it',()=>{
  const l=local({board:[board(2,{created_at:BEFORE})],pin:[pin(10,2),pin(11,2,{created_at:BEFORE})]});
  const p=plan(l,none(),emptyState(),SINCE);
  expect(p.ops.map(o=>[o.op,o.type,o.id])).toEqual([['create','board',id(2)],['create','pin',id(10)]]);
 });
 it('maps a card: empty text is null, the title and kind are columns, drawings stay in meta, the image is a studio file',()=>{
  const st=emptyState();st.files['ref1']=id(99);
  const l=local({board:[board(1)],pin:[pin(10,1,{file_ref:'ref1',note:'',source_url:'https://a.test/x',tags:[' warm ','warm',''],annotations:[{id:'a',tool:'pen',points:[],comment:''}],meta:{kind:'image',title:'Blue'}})]});
  const f=plan(l,none(),st,SINCE).ops[1].fields!;
  expect(f).toMatchObject({boardId:id(1),fileId:id(99),note:null,sourceUrl:'https://a.test/x',tags:['warm'],kind:'image',title:'Blue',meta:{annotations:[{id:'a',tool:'pen',points:[],comment:''}]}});
 });
});

describe('after the first sync',()=>{
 it('agrees, then sends only the fields changed here',()=>{
  const st=emptyState(),l=local({board:[board(1)],pin:[pin(10,1)]});const s=agree(l,st);
  expect(plan(l,s,st,SINCE).ops).toEqual([]);
  l.pin[0]={...l.pin[0],note:'changed',tags:['a']};
  expect(plan(l,s,st,SINCE).ops).toEqual([{op:'update',type:'pin',id:id(10),patch:{note:'changed',tags:['a']}}]);
 });
 it('takes the studio’s change when only the studio moved, keeping local-only settings',()=>{
  const st=emptyState(),l=local({board:[board(1,{share_settings:{mode:'private',permission:'view'}})]});const s=agree(l,st);
  s.board.set(id(1),{...s.board.get(id(1)),name:'Renamed elsewhere',version:2,updatedAt:'2026-10-26T02:00:00.000Z'});
  const p=plan(l,s,st,SINCE);
  expect(p.ops).toEqual([]);expect(p.conflicts).toEqual([]);
  expect(p.apply.boards[0]).toMatchObject({id:id(1),name:'Renamed elsewhere',share_settings:{mode:'private',permission:'view'},updated_at:'2026-10-26T02:00:00.000Z'});
 });
 it('keeps the studio’s copy and makes a review card when both moved',()=>{
  const st=emptyState(),l=local({board:[board(1)],pin:[pin(10,1)]});const s=agree(l,st);
  s.pin.set(id(10),{...s.pin.get(id(10)),note:'theirs',version:2});l.pin[0]={...l.pin[0],note:'mine'};
  const p=plan(l,s,st,SINCE);
  expect(p.ops).toEqual([]);expect(p.apply.pins[0].note).toBe('theirs');
  expect(p.conflicts.map(c=>[c.id,c.local.note])).toEqual([[id(10),'mine']]);
 });
 it('fetches a picture the studio has under its own file id',()=>{
  const st=emptyState(),l=local({board:[board(1)]});const s=agree(l,st);
  s.pin.set(id(10),{id:id(10),version:1,deletedAt:null,...toServer('pin',pin(10,1),{alias:{},files:{},scope:new Set()}),fileId:id(50),kind:'image'});
  const p=plan(l,s,st,SINCE);
  expect(p.apply.pins[0]).toMatchObject({id:id(10),file_ref:id(50),meta:{kind:'image'}});
  expect(st.files[id(50)]).toBe(id(50));
 });
});

describe('the Inbox',()=>{
 it('maps this device’s Inbox onto the studio’s, quietly, and files new cards there',()=>{
  const st=emptyState(),s=none();
  s.board.set(id(5),{id:id(5),version:3,deletedAt:null,name:'Inbox',description:'Theirs',coverPinId:null,position:0,commentsEnabled:true});
  const l=local({board:[board(1,{name:'Inbox',description:'Mine',created_at:BEFORE})],pin:[pin(10,1)]});
  const p=plan(l,s,st,SINCE);
  expect(st.alias).toEqual({[id(1)]:id(5)});
  expect(p.conflicts).toEqual([]);
  expect(p.apply.boards[0]).toMatchObject({id:id(1),description:'Theirs'});
  expect(p.ops).toEqual([expect.objectContaining({op:'create',type:'pin',id:id(10),fields:expect.objectContaining({boardId:id(5)})})]);
 });
});

describe('deletes and restores',()=>{
 it('deletes a board once, after other changes; its cards go with it',()=>{
  const st=emptyState(),l=local({board:[board(1),board(2)],pin:[pin(10,1),pin(11,1)]});const s=agree(l,st);
  const at='2026-10-26T03:00:00.000Z';
  l.pin[1]={...l.pin[1],board_id:id(2)};l.board[0]={...l.board[0],deleted_at:at};l.pin[0]={...l.pin[0],deleted_at:at};
  expect(plan(l,s,st,SINCE).ops.map(o=>[o.op,o.id])).toEqual([['update',id(11)],['remove',id(1)]]);
 });
 it('applies the studio’s delete to the device, with its time',()=>{
  const st=emptyState(),l=local({board:[board(1)],pin:[pin(10,1)]});const s=agree(l,st);
  s.pin.delete(id(10));st.tombs['pin:'+id(10)]={v:2,d:'2026-10-26T04:00:00.000Z',by:null};
  const p=plan(l,s,st,SINCE);
  expect(p.apply.pins[0]).toMatchObject({id:id(10),deleted_at:'2026-10-26T04:00:00.000Z'});
  expect(st.base['pin:'+id(10)]).toBe('deleted');
 });
 it('restores a board alone when its cards were deleted with it',()=>{
  const st=emptyState(),l=local({board:[board(1)],pin:[pin(10,1)]});const s=agree(l,st);
  const d='2026-10-26T05:00:00.000Z';s.board.delete(id(1));s.pin.delete(id(10));
  st.tombs['board:'+id(1)]={v:2,d};st.tombs['pin:'+id(10)]={v:2,d};st.base['board:'+id(1)]='deleted';st.base['pin:'+id(10)]='deleted';
  expect(plan(l,s,st,SINCE).ops).toEqual([expect.objectContaining({op:'restore',type:'board',id:id(1),version:2})]);
 });
 it('holds a refused card back until it changes',()=>{
  const st=emptyState(),l=local({board:[board(1)],pin:[pin(10,1)]});const s=agree(l,st);s.pin.delete(id(10));
  st.refused['pin:'+id(10)]={h:'?',why:'No'};delete st.base['pin:'+id(10)];
  expect(plan(l,s,st,SINCE).ops).toEqual([]);expect(plan(l,s,st,SINCE).ops).toEqual([]);
  l.pin[0]={...l.pin[0],note:'fixed'};
  expect(plan(l,s,st,SINCE).ops.map(o=>o.op)).toEqual(['create']);
 });
});

it('compares only the fields both sides have',()=>{
 expect(hashOf('board',{name:'A',description:null,coverPinId:null,position:0,commentsEnabled:true,version:4,meta:{x:1}})).toBe(hashOf('board',{name:'A',position:0,commentsEnabled:true}));
 expect(hashOf('pin',{deletedAt:'x',note:'a'})).toBe('deleted');
});
