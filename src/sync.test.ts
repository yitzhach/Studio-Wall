// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import {describe,it,expect,beforeEach,vi} from 'vitest';
import {action,database,snapshot,initialize,resetHistory} from './data';
import {validRecord} from '../worker/index';
// In-memory stand-in for the worker: same newest-wins rule and sequence cursor.
const server={rows:new Map<string,{kind:string;data:any;seq:number}>(),files:new Map<string,Blob>(),seq:0};
async function fakeFetch(path:string,init:RequestInit={}){const url=new URL(path,'https://wall.test');const m=init.method||'GET';const ok=(b:unknown)=>new Response(JSON.stringify(b),{status:200});
 if(url.pathname==='/api/me')return ok({email:'owner@example.com'});
 if(url.pathname==='/api/boards')return ok({boards:[...server.rows.values()].filter(r=>r.kind==='boards').map(r=>r.data)});
 if(url.pathname==='/api/sync'&&m==='POST'){for(const r of JSON.parse(init.body as string).records){expect(validRecord(r.kind,r.data)).toBe(true);const k=r.kind+r.data.id,cur=server.rows.get(k);if(!cur||r.data.updated_at>cur.data.updated_at)server.rows.set(k,{...r,seq:++server.seq});}return ok({ok:true});}
 if(url.pathname==='/api/sync'){const since=Number(url.searchParams.get('since'));const list=[...server.rows.values()].filter(r=>r.seq>since).sort((a,b)=>a.seq-b.seq);return ok({records:list,cursor:list.length?list[list.length-1].seq:since,more:false});}
 const ref=url.pathname.split('/').pop()!;if(m==='PUT'){server.files.set(ref,init.body as Blob);return ok({ok:true});}
 const f=server.files.get(ref);return f?new Response(m==='HEAD'?null:f,{status:200}):new Response(null,{status:404});}
const resetDevice=async()=>{resetHistory();localStorage.clear();const db=await database;for(const s of ['boards','pins','files','feedback','activity_log','outbox'])await db.clear(s);};
beforeEach(async()=>{vi.resetModules();vi.stubGlobal('fetch',vi.fn(fakeFetch));server.rows.clear();server.files.clear();server.seq=0;await resetDevice();});
describe('live sync',()=>{
 it('pushes a board with its image and pulls it onto a second device',async()=>{
  await initialize();const b=await action({type:'board.create',payload:{name:'Living room'}});
  const p=await action({type:'pin.save',payload:{board_id:b.id,note:'Plaster',palette:['#aabbcc']},blob:new Blob(['img'],{type:'image/webp'})});
  const desk=await import('./sync');await desk.syncNow(()=>{});expect(desk.syncStatus().state).toBe('on');expect(server.files.has(p.file_ref)).toBe(true);
  await resetDevice();await initialize();vi.resetModules();
  const phone=await import('./sync');let remote=0;await phone.syncNow(()=>remote++);
  const s=await snapshot();expect(remote).toBe(1);expect(s.boards.filter(x=>x.name==='Inbox')).toHaveLength(1);expect(s.pins.map(x=>x.note)).toEqual(['Plaster']);
  expect(await (await database).get('files',p.file_ref)).toBeTruthy();
  await phone.syncNow(()=>remote++);expect(remote).toBe(1);
 });
 it('keeps cards when an image is not available yet, then backfills it',async()=>{
  await initialize();const b=await action({type:'board.create',payload:{name:'Studio'}});
  const p=await action({type:'pin.save',payload:{board_id:b.id,note:'Late image'},blob:new Blob(['img'],{type:'image/webp'})});
  await action({type:'pin.save',payload:{board_id:b.id,note:'Fine'}});
  await (await import('./sync')).syncNow(()=>{});const held=server.files.get(p.file_ref)!;server.files.delete(p.file_ref);
  await resetDevice();await initialize();vi.resetModules();
  const phone=await import('./sync');await phone.syncNow(()=>{});expect(phone.syncStatus().state).toBe('on');
  expect((await snapshot()).pins.map(x=>x.note).sort()).toEqual(['Fine','Late image']);expect(await (await database).get('files',p.file_ref)).toBeUndefined();
  server.files.set(p.file_ref,held);await phone.syncNow(()=>{});expect(await (await database).get('files',p.file_ref)).toBeTruthy();
 });
 it('stays device-local when the API is not configured',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));const s=await import('./sync');await s.syncNow(()=>{});expect(s.syncStatus().state).toBe('off');});
 it('worker rejects malformed records',()=>{expect(validRecord('pins',{id:'../x',board_id:'a',updated_at:'2026-01-01T00:00:00Z'})).toBe(false);expect(validRecord('users',{id:'a',updated_at:'2026-01-01T00:00:00Z'})).toBe(false);expect(validRecord('boards',{id:'A1',updated_at:'2026-01-01T00:00:00Z'})).toBe(true);});
});
