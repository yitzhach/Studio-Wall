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
