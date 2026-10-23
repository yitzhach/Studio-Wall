// Client contributions through a share link, run against the real Worker with an in-memory D1 (node:sqlite) and R2 stand-in.
import {it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index';
const sql=new DatabaseSync(':memory:');
const stmt=(q:string,args:unknown[]=[])=>({bind:(...a:unknown[])=>stmt(q,a),first:async()=>sql.prepare(q).get(...(args as any[]))??null,all:async()=>({results:sql.prepare(q).all(...(args as any[]))}),run:async()=>sql.prepare(q).run(...(args as any[]))});
const DB={prepare:(q:string)=>stmt(q),batch:async(list:any[])=>{sql.exec('BEGIN');try{for(const s of list)await s.run();sql.exec('COMMIT');}catch(e){sql.exec('ROLLBACK');throw e;}}};
const files=new Map<string,Uint8Array>();
const FILES={put:async(k:string,v:Uint8Array)=>{files.set(k,v);},get:async(k:string)=>files.has(k)?{arrayBuffer:async()=>files.get(k)!.buffer,httpMetadata:{contentType:'image/png'}}:null};
const env={DB,FILES,ACCESS_TEAM_DOMAIN:'x.cloudflareaccess.com',ACCESS_AUD:'aud',ASSETS:{fetch:async()=>new Response('')}};
const ctx={waitUntil(){}};
const call=(path:string,init:RequestInit={},guest='g'.repeat(20))=>worker.fetch(new Request('https://wall.test'+path,{...init,headers:{'x-guest-id':guest,...init.headers}}),env as any,ctx);
const now=new Date().toISOString();
const put=(kind:string,data:any)=>sql.prepare('INSERT INTO records(owner,kind,id,updated_at,seq,data) VALUES(?,?,?,?,(SELECT COALESCE(MAX(seq),0)+1 FROM records),?)').run('me@x',kind,data.id,now,JSON.stringify(data));
const link=(token:string,permission:string,pin_ids:string|null=null)=>sql.prepare('INSERT INTO shares(token,owner,board_id,permission,created_at,pin_ids) VALUES(?,?,?,?,?,?)').run(token,'me@x','B1',permission,now,pin_ids);
const PNG=Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);

it('lets a contribute link add images and notes, and nothing else',async()=>{
 expect((await call('/api/s/'+'v'.repeat(32))).status).toBe(404);// creates the schema
 put('boards',{id:'B1',name:'Living room',updated_at:now,deleted_at:null});
 put('pins',{id:'P1',board_id:'B1',file_ref:null,note:'Linen',meta:{kind:'idea',title:'Linen'},updated_at:now,created_at:now,deleted_at:null});
 const add='a'.repeat(32),view='b'.repeat(32),chosen='c'.repeat(32);
 link(add,'contribute');link(view,'comment');link(chosen,'contribute','["P1"]');
 // A comment-only link can't add cards; a contribute link can still comment.
 expect((await call(`/api/s/${view}/pins?name=Ana`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"hi"}'})).status).toBe(403);
 expect((await call(`/api/s/${add}/feedback`,{method:'POST',headers:{'content-type':'application/json'},body:'{"text":"Lovely","name":"Ana"}'})).status).toBe(200);
 const note=await call(`/api/s/${add}/pins?name=Ana`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Idea',note:'More oak',url:'https://example.com/oak'})});
 expect(note.status).toBe(200);const {pin}=await note.json() as any;
 expect(pin).toMatchObject({contributor:'Ana',meta:{kind:'link',title:'Idea'},source_url:'https://example.com/oak'});
 const stored=JSON.parse((sql.prepare("SELECT data FROM records WHERE id=?").get(pin.id) as any).data);
 expect(stored).toMatchObject({board_id:'B1',created_by:'guest:'+'g'.repeat(20),contributor_name:'Ana'});
 // Images: sniffed, stored under the owner, visible through the link; non-images and bad links refused.
 const img=await call(`/api/s/${add}/pins?name=Ben&title=Rug&palette=%23aabbcc,nope`,{method:'POST',headers:{'content-type':'image/png'},body:PNG});
 expect(img.status).toBe(200);const imgPin=(await img.json() as any).pin;expect(imgPin.palette).toEqual(['#aabbcc']);
 expect(files.has('me@x/'+imgPin.file_ref)).toBe(true);
 expect((await call(`/api/s/${add}/files/${imgPin.file_ref}`)).status).toBe(200);
 expect((await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'image/png'},body:'not an image'})).status).toBe(415);
 expect((await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:'{"url":"javascript:alert(1)"}'})).status).toBe(400);
 const board=await (await call(`/api/s/${add}`)).json() as any;expect(board.pins.map((p:any)=>p.contributor).sort()).toEqual(['','Ana','Ben']);
 // A link to chosen cards shows the cards its clients add, not other clients' additions.
 const mine=(await (await call(`/api/s/${chosen}/pins?name=Cy`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"Brass"}'})).json() as any).pin;
 expect((await (await call(`/api/s/${chosen}`)).json() as any).pins.map((p:any)=>p.id).sort()).toEqual(['P1',mine.id].sort());
 // Daily limit per client.
 for(let i=0;i<22;i++)await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"x"}'});
 expect((await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"x"}'})).status).toBe(429);
 expect((await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"x"}'},'h'.repeat(20))).status).toBe(200);
});

it('lets a client remove only the cards they added, as a soft delete',async()=>{
 const add='d'.repeat(32),view='e'.repeat(32);link(add,'contribute');link(view,'comment');
 const ana='a1'.repeat(10),ben='b1'.repeat(10);
 const json={method:'POST',headers:{'content-type':'application/json'}};
 const pin=(await (await call(`/api/s/${add}/pins?name=Ana`,{...json,body:'{"note":"Wrong one"}'},ana)).json() as any).pin;
 expect(pin.mine).toBe(true);
 // Only the browser that added it sees it as theirs; the owner's own card is no one's to remove.
 const seen=async(g:string)=>(await (await call(`/api/s/${add}`,{},g)).json() as any).pins.filter((p:any)=>p.mine).map((p:any)=>p.id);
 expect(await seen(ana)).toEqual([pin.id]);expect(await seen(ben)).toEqual([]);
 const remove=(id:string,g:string,token=add)=>call(`/api/s/${token}/pins/${id}`,{method:'DELETE'},g);
 expect((await remove(pin.id,ben)).status).toBe(403);
 expect((await remove('P1',ana)).status).toBe(403);
 expect((await remove(pin.id,ana,view)).status).toBe(403);
 expect((await remove(pin.id,ana)).status).toBe(200);
 expect((await remove(pin.id,ana)).status).toBe(404);
 expect((await (await call(`/api/s/${add}`,{},ana)).json() as any).pins.some((p:any)=>p.id===pin.id)).toBe(false);
 // Kept as a newer, deleted version so the owner's devices sync it into Recently deleted.
 const stored=JSON.parse((sql.prepare("SELECT data FROM records WHERE id=?").get(pin.id) as any).data);
 expect(stored.deleted_at).toBeTruthy();expect(stored.version).toBe(2);expect(stored.contributor_name).toBe('Ana');expect(stored.deleted_by).toBe(stored.created_by);
});

it('adds several images in one request, all or nothing',async()=>{
 const add='f'.repeat(32),chosen='9'.repeat(32);link(add,'contribute');link(chosen,'contribute','["P1"]');
 const cy='c1'.repeat(10),count=()=>(sql.prepare("SELECT COUNT(*) n FROM records WHERE kind='pins'").get() as any).n;
 const form=(n:number,bad=-1)=>{const f=new FormData();f.set('title','Tiles');for(let i=0;i<n;i++){f.append('image',new Blob([i===bad?Uint8Array.from([1,2,3]):PNG],{type:'image/png'}),'x.png');f.append('palette',i?'#112233':'#aabbcc,nope');}return f;};
 const send=(token:string,body:FormData,g=cy)=>call(`/api/s/${token}/pins?name=Cy`,{method:'POST',body},g);
 const r=await send(add,form(3));expect(r.status).toBe(200);const {pins}=await r.json() as any;
 expect(pins).toHaveLength(3);expect(pins.map((p:any)=>p.palette)).toEqual([['#aabbcc'],['#112233'],['#112233']]);
 expect(pins.every((p:any)=>p.mine&&p.contributor==='Cy'&&p.meta.title==='Tiles'&&files.has('me@x/'+p.file_ref))).toBe(true);
 // One unreadable file, too many files, or more than today's allowance: nothing is stored.
 const before=count(),stored=files.size;
 expect((await send(add,form(3,1))).status).toBe(415);
 expect((await send(add,form(11))).status).toBe(400);
 for(let i=0;i<20;i++)await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:'{"note":"x"}'},cy);
 const over=await send(add,form(3));expect(over.status).toBe(429);expect((await over.json() as any).error).toContain('2 more today');
 expect(count()).toBe(before+20);expect(files.size).toBe(stored);
 // A chosen-cards link shows every image its client added.
 const two=(await (await send(chosen,form(2),'d2'.repeat(10))).json() as any).pins.map((p:any)=>p.id);
 expect((await (await call(`/api/s/${chosen}`)).json() as any).pins.map((p:any)=>p.id).sort()).toEqual(['P1',...two].sort());
});

it('keeps the first link when a list or several lines arrive (iPhone Shortcut URLs)',async()=>{
 const add='8'.repeat(32);link(add,'contribute');
 for(const url of [['https://a.example/x','https://b.example'],'https://a.example/x\nhttps://b.example',' https://a.example/x '])
  expect((await (await call(`/api/s/${add}/pins`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})},'e3'.repeat(10))).json() as any).pin.source_url).toBe('https://a.example/x');
});
