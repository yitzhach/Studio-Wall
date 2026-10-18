import 'fake-indexeddb/auto';
import {describe,it,expect,beforeEach} from 'vitest';
import {unzipSync} from 'fflate';
import {action,database,snapshot,initialize,resetHistory} from './data';
import {libraryZip,importLibraryFiles} from './backup';
const clear=async()=>{resetHistory();const db=await database;for(const s of ['boards','pins','files','feedback','activity_log','outbox'])await db.clear(s);};
beforeEach(clear);
describe('whole-library backup',()=>{
 it('moves boards, images and comments to another device and merges repeat imports',async()=>{
  await initialize();const inbox=(await snapshot()).boards[0];
  const b=await action({type:'board.create',payload:{name:'Living room'}});
  const p=await action({type:'pin.save',payload:{board_id:b.id,note:'Plaster',palette:['#aabbcc']},blob:new Blob(['img'],{type:'image/webp'})});
  await action({type:'pin.save',payload:{board_id:inbox.id,note:'Loose idea'}});
  await action({type:'feedback.add',payload:{board_id:b.id,pin_id:p.id,text:'Love this'}});
  const files=unzipSync((await libraryZip()).zip);
  await clear();await initialize();
  const first=await importLibraryFiles(files);expect(first).toMatchObject({boards:1,pins:2,feedback:1,images:1});
  const s=await snapshot();expect(s.boards.map(x=>x.name).sort()).toEqual(['Inbox','Living room']);expect(s.boards.filter(x=>x.name==='Inbox')).toHaveLength(1);
  expect(s.pins.find(x=>x.note==='Loose idea')!.board_id).toBe(s.boards.find(x=>x.name==='Inbox')!.id);
  expect(await (await database).get('files',p.file_ref)).toBeTruthy();
  expect(await importLibraryFiles(files)).toMatchObject({boards:0,pins:0,feedback:0,images:0});
 });
 it('rejects a backup missing images without partial writes',async()=>{
  const b=await action({type:'board.create',payload:{name:'Kitchen'}});await action({type:'pin.save',payload:{board_id:b.id,note:'x'},blob:new Blob(['i'])});
  const files=unzipSync((await libraryZip()).zip);for(const k of Object.keys(files))if(k.startsWith('images/'))delete files[k];
  await clear();await expect(importLibraryFiles(files)).rejects.toThrow('missing an image');expect(await (await database).count('boards')).toBe(0);
 });
});
describe('single-board ZIP import',()=>{
 it('imports a board and its images in one step, and leaves nothing behind when an image is missing',async()=>{
  const {zipSync,strToU8}=await import('fflate');const {importBoard}=await import('./backup');
  const pins=[{id:'P1',meta:{kind:'image',title:'Wall'},note:'n',tags:['t'],palette:['#aabbcc'],source_url:'',source_credit:'Ann',file_ref:'F1',annotations:[]},{id:'P2',meta:{kind:'idea',title:''},note:'idea',tags:[],palette:[],source_url:'',source_credit:'',file_ref:null}];
  const zip=(withImage:boolean)=>new Blob([zipSync({'board.json':strToU8(JSON.stringify({format:'studio-wall',version:1,board:{name:'Hall'},pins,mime:{F1:'image/webp'}})),...(withImage?{'images/F1':new Uint8Array([1,2,3])}:{})}) as BlobPart]);
  const board=await importBoard(zip(true));const s=await snapshot();
  expect(board.name).toBe('Hall (imported)');expect(s.pins.filter(p=>p.board_id===board.id).map(p=>p.source_credit).sort()).toEqual(['','Ann']);
  const img=s.pins.find(p=>p.file_ref)!;expect(img.file_ref).not.toBe('F1');expect(await (await database).get('files',img.file_ref!)).toBeTruthy();
  await clear();await expect(importBoard(zip(false))).rejects.toThrow();expect(await (await database).count('boards')).toBe(0);expect(await (await database).count('pins')).toBe(0);
 });
});
