import 'fake-indexeddb/auto';
import {describe,it,expect,beforeEach} from 'vitest';
import {action,database,snapshot} from './data';
beforeEach(async()=>{const db=await database;for(const s of ['boards','pins','files','feedback','activity_log','outbox'])await db.clear(s);});
describe('local action boundary',()=>{
 it('atomically persists image, pin and outbox event',async()=>{const b=await action({type:'board.create',payload:{name:'Materials'}});const p=await action({type:'pin.save',payload:{board_id:b.id,note:'Blue',palette:['#aabbcc']},blob:new Blob(['sample'],{type:'image/png'})});const db=await database;expect(p.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);expect((await db.get('files',p.file_ref)).size).toBe(6);expect(await db.count('activity_log')).toBe(2);expect(await db.count('outbox')).toBe(2);expect((await snapshot()).pins[0].studio_id).toBe('local-studio');});
 it('rejects missing board without partial writes',async()=>{await expect(action({type:'pin.save',payload:{board_id:'missing',note:'x'}})).rejects.toThrow();const db=await database;expect(await db.count('pins')).toBe(0);expect(await db.count('outbox')).toBe(0);});
 it('rejects unsafe links',async()=>{const b=await action({type:'board.create',payload:{name:'Test'}});await expect(action({type:'pin.save',payload:{board_id:b.id,source_url:'javascript:alert(1)'}})).rejects.toThrow();expect((await snapshot()).pins).toHaveLength(0);});
 it('moves and versions a pin, soft deletes a board and its pins',async()=>{const b=await action({type:'board.create',payload:{name:'One'}});const c=await action({type:'board.create',payload:{name:'Two'}});const p=await action({type:'pin.save',payload:{board_id:b.id,note:'keep'}});const moved=await action({type:'pin.move',id:p.id,payload:{board_id:c.id}});expect(moved.version).toBe(2);await action({type:'board.delete',id:c.id});expect((await snapshot()).pins).toHaveLength(0);expect((await(await database).get('pins',p.id)).deleted_at).toBeTruthy();});
 it('keeps sharing unavailable until an authorized backend exists',async()=>{await expect(action({type:'board.share'})).rejects.toThrow('backend');expect(await(await database).count('outbox')).toBe(0);});
 it('rejects a cover from a different board',async()=>{const b=await action({type:'board.create',payload:{name:'One'}});const c=await action({type:'board.create',payload:{name:'Two'}});const p=await action({type:'pin.save',payload:{board_id:c.id,note:'test'}});await expect(action({type:'board.update',id:b.id,payload:{cover_pin_id:p.id}})).rejects.toThrow();});
});

it('copies a batch with shared blobs and intact credits; rolls back invalid batches',async()=>{
 const b=await action({type:'board.create',payload:{name:'Source'}});
 const p=await action({type:'pin.save',payload:{board_id:b.id,note:'hello',source_credit:'Artist',source_url:'https://example.com'},blob:new Blob(['x'])});
 const copied=await action({type:'pin.batch',payload:{ids:[p.id],new_board_name:'Client',operation:'copy'}});
 expect(copied.pins[0].id).not.toBe(p.id);expect(copied.pins[0].file_ref).toBe(p.file_ref);expect(copied.pins[0].source_credit).toBe('Artist');expect((await snapshot()).pins).toHaveLength(2);
 await expect(action({type:'pin.batch',payload:{ids:[p.id,'missing'],new_board_name:'Rollback',operation:'move'}})).rejects.toThrow();
 expect((await snapshot()).boards.some(b=>b.name==='Rollback')).toBe(false);expect((await snapshot()).pins.find(x=>x.id===p.id)?.board_id).toBe(b.id);
 const moved=await action({type:'pin.batch',payload:{ids:[p.id],board_id:copied.id,operation:'move'}});expect(moved.pins[0].version).toBe(2);
});
it('stores demo settings without publishing or storing a password',async()=>{const b=await action({type:'board.create',payload:{name:'Client'}});const r=await action({type:'board.share_settings',id:b.id,payload:{mode:'password',permission:'view',password:'must not store'}});expect(r.visibility).toBe('private');expect(r.share_settings).toEqual({mode:'password',permission:'view'});expect(JSON.stringify(await(await database).getAll('outbox'))).not.toContain('must not store');});

it('keeps stars and image notes scoped to the board and versions toggles',async()=>{
 const b=await action({type:'board.create',payload:{name:'Client'}}),other=await action({type:'board.create',payload:{name:'Other'}});
 const p=await action({type:'pin.save',payload:{board_id:b.id,note:'Reference'}});
 await expect(action({type:'feedback.star',payload:{board_id:other.id,pin_id:p.id}})).rejects.toThrow();
 await expect(action({type:'feedback.add',payload:{board_id:other.id,pin_id:p.id,text:'Wrong board'}})).rejects.toThrow();
 const star=await action({type:'feedback.star',payload:{board_id:b.id,pin_id:p.id}});
 const unstar=await action({type:'feedback.star',payload:{board_id:b.id,pin_id:p.id}});
 expect(unstar.id).toBe(star.id);expect(unstar.starred).toBe(false);expect(unstar.version).toBe(2);
 await action({type:'feedback.add',payload:{board_id:b.id,pin_id:p.id,text:'Love this texture'}});
 expect((await snapshot()).feedback).toHaveLength(2);
});
