// Studio Wall API. Runs only for /api/* and /s/* (see wrangler.jsonc); everything else is the static app.
// Owner routes: identity comes from Cloudflare Access (email login, or an Access service token for the iPhone Shortcut).
// Client share routes (/s/<token>, /api/s/<token>/…) are public by design: the random token is the credential, and the
// server decides what it exposes (one board, its live cards and images; never notes on images, tags or other boards).
// Without ACCESS_TEAM_DOMAIN, ACCESS_AUD, DB and FILES configured, the API refuses requests (fail closed).
type Env={ASSETS:{fetch(r:Request):Promise<Response>};DB?:any;FILES?:any;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
type Ctx={waitUntil(p:Promise<unknown>):void};
const KINDS=['boards','pins','feedback'];
const ID=/^[0-9A-Za-z_-]{1,64}$/;
const TOKEN=/^[A-Za-z0-9_-]{32,64}$/;
const MAX_RECORD=200_000,MAX_BATCH=500,MAX_FILE=25*1024*1024,PAGE=500;
// Matches RETENTION_DAYS in src/data.ts. (Workers modules may only export handlers and functions.)
const RETENTION_DAYS=30;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64url=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
const randomToken=()=>{const b=crypto.getRandomValues(new Uint8Array(24));return btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const newId=()=>crypto.randomUUID().replace(/-/g,'').toUpperCase();
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

let certs:{at:number;keys:any[]}|null=null;
/** Verified Access JWT claims, or null. Service tokens carry common_name instead of email. */
async function accessClaims(req:Request,env:Env):Promise<any|null>{
 const token=req.headers.get('cf-access-jwt-assertion')||req.headers.get('cookie')?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return null;
 const [h,p,s]=token.split('.');if(!h||!p||!s)return null;
 const header=JSON.parse(new TextDecoder().decode(b64url(h))),claims=JSON.parse(new TextDecoder().decode(b64url(p)));
 const team='https://'+env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/$/,'');
 if(header.alg!=='RS256'||claims.iss!==team||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.ACCESS_AUD)||!(claims.exp*1000>Date.now()))return null;
 if(!certs||Date.now()-certs.at>3600_000)certs={at:Date.now(),keys:(await (await fetch(team+'/cdn-cgi/access/certs')).json() as any).keys};
 const jwk=certs.keys.find(k=>k.kid===header.kid);if(!jwk)return null;
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(s),new TextEncoder().encode(h+'.'+p))?claims:null;
}

/** Recognise real image files by their leading bytes (magic numbers). */
export function sniffImage(b:Uint8Array):string|null{
 const ascii=(from:number,to:number)=>String.fromCharCode(...b.slice(from,to));
 if(b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return 'image/jpeg';
 if(b[0]===0x89&&ascii(1,4)==='PNG')return 'image/png';
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
 if(ascii(0,4)==='GIF8')return 'image/gif';
 if(ascii(4,8)==='ftyp'&&['heic','heix','hevc','heif','mif1','msf1'].includes(ascii(8,12)))return 'image/heic';
 return null;
}
export function validRecord(kind:string,r:any){
 if(!KINDS.includes(kind)||!r||!ID.test(r.id)||typeof r.updated_at!=='string'||isNaN(Date.parse(r.updated_at)))return false;
 if(kind!=='boards'&&!ID.test(r.board_id))return false;
 if(kind==='pins'&&r.file_ref!==null&&r.file_ref!==undefined&&!ID.test(r.file_ref))return false;
 return JSON.stringify(r).length<=MAX_RECORD;
}
/** What a client may see of a card: never private image notes, tags or markup comments. Idea/link cards show their text. */
export function publicPin(p:any){
 const kind=p.meta?.kind||'image';
 return {id:p.id,file_ref:p.file_ref||null,meta:{kind,title:String(p.meta?.title||'')},source_credit:p.is_own?'':String(p.source_credit||''),is_own:!!p.is_own,source_url:kind==='link'?String(p.source_url||''):'',note:kind==='image'?'':String(p.note||''),palette:Array.isArray(p.palette)?p.palette:[],created_at:p.created_at};
}

const SCHEMA=[
 'CREATE TABLE IF NOT EXISTS records(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,updated_at TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,kind,id))',
 'CREATE INDEX IF NOT EXISTS records_seq ON records(owner,seq)',
 'CREATE TABLE IF NOT EXISTS shares(token TEXT PRIMARY KEY,owner TEXT NOT NULL,board_id TEXT NOT NULL,permission TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT,revoked_at TEXT)',
 'CREATE INDEX IF NOT EXISTS shares_owner ON shares(owner,board_id)',
 'CREATE TABLE IF NOT EXISTS purged_files(owner TEXT NOT NULL,ref TEXT NOT NULL,PRIMARY KEY(owner,ref))',
 'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)'];
let ready=false;
async function ensureSchema(env:Env){if(!ready){await env.DB.batch(SCHEMA.map(s=>env.DB.prepare(s)));ready=true;}}
// Newest updated_at wins; each accepted write gets the next sequence number so devices can pull "everything after N".
const UPSERT='INSERT INTO records(owner,kind,id,updated_at,seq,data) VALUES(?1,?2,?3,?4,(SELECT COALESCE(MAX(seq),0)+1 FROM records WHERE owner=?1),?5) ON CONFLICT(owner,kind,id) DO UPDATE SET updated_at=excluded.updated_at,seq=excluded.seq,data=excluded.data WHERE excluded.updated_at>records.updated_at';
const putRecords=(env:Env,owner:string,list:{kind:string;data:any}[])=>list.length?env.DB.batch(list.map(x=>env.DB.prepare(UPSERT).bind(owner,x.kind,x.data.id,x.data.updated_at,JSON.stringify(x.data)))):Promise.resolve();
async function record(env:Env,owner:string,kind:string,id:string){const r=await env.DB.prepare('SELECT data FROM records WHERE owner=? AND kind=? AND id=?').bind(owner,kind,id).first();return r?JSON.parse(r.data):null;}
async function boardPins(env:Env,owner:string,boardId:string){const {results}=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='pins' AND json_extract(data,'$.board_id')=? AND json_extract(data,'$.deleted_at') IS NULL").bind(owner,boardId).all();return results.map((r:any)=>JSON.parse(r.data)).sort((a:any,b:any)=>String(b.created_at).localeCompare(String(a.created_at)));}

/** Images of cards deleted more than RETENTION_DAYS ago are removed from R2, unless any live or recently deleted card still uses the same file. Runs at most daily. */
export async function cleanup(env:Env,now=Date.now()){
 const last=await env.DB.prepare("SELECT value FROM meta WHERE key='last_cleanup'").first();if(last&&now-Number(last.value)<20*3600_000)return 0;
 await env.DB.prepare("INSERT INTO meta(key,value) VALUES('last_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(now)).run();
 const cutoff=new Date(now-RETENTION_DAYS*86400_000).toISOString();
 const {results}=await env.DB.prepare(`SELECT DISTINCT r.owner owner,json_extract(r.data,'$.file_ref') ref FROM records r WHERE r.kind='pins' AND json_extract(r.data,'$.file_ref') IS NOT NULL AND json_extract(r.data,'$.deleted_at') IS NOT NULL AND json_extract(r.data,'$.deleted_at')<?1
  AND NOT EXISTS(SELECT 1 FROM records o WHERE o.owner=r.owner AND o.kind='pins' AND json_extract(o.data,'$.file_ref')=json_extract(r.data,'$.file_ref') AND (json_extract(o.data,'$.deleted_at') IS NULL OR json_extract(o.data,'$.deleted_at')>=?1))
  AND NOT EXISTS(SELECT 1 FROM purged_files p WHERE p.owner=r.owner AND p.ref=json_extract(r.data,'$.file_ref')) LIMIT 500`).bind(cutoff).all();
 for(const r of results as {owner:string;ref:string}[]){await env.FILES.delete(r.owner+'/'+r.ref);await env.DB.prepare('INSERT OR IGNORE INTO purged_files(owner,ref) VALUES(?,?)').bind(r.owner,r.ref).run();}
 return results.length;
}

/** iPhone Shortcut capture: an image (raw bytes) or a link/note (JSON) goes into the named board, or the Inbox. */
async function capture(req:Request,env:Env,url:URL,owner:string){
 const {results}=await env.DB.prepare("SELECT data,seq FROM records WHERE owner=? AND kind='boards' ORDER BY seq").bind(owner).all();
 const boards=results.map((r:any)=>JSON.parse(r.data)).filter((b:any)=>!b.deleted_at);
 const want=(url.searchParams.get('board')||'').trim().toLowerCase();
 const board=boards.find((b:any)=>want&&b.name.toLowerCase()===want)||boards.find((b:any)=>b.name==='Inbox');
 if(!board)return json({error:'Open Studio Wall once with sync on, then try again.'},409);
 const now=new Date().toISOString(),type=req.headers.get('content-type')||'';
 const pin:any={id:newId(),studio_id:'local-studio',created_at:now,updated_at:now,created_by:'shortcut',actor_type:'human',version:1,deleted_at:null,board_id:board.id,file_ref:null,source_url:'',source_credit:'',is_own:false,note:'',tags:[],palette:[],linked_type:null,linked_id:null,annotations:[],meta:{kind:'idea',title:''}};
 const text=(v:unknown,max:number)=>String(v??'').slice(0,max);
 if(type.startsWith('application/json')||type.startsWith('text/')){
  const raw=type.startsWith('text/')?{url:(await req.text()).trim()}:await req.json().catch(()=>null) as any;if(!raw)return json({error:'Send an image, or JSON with url / note.'},400);
  const link=text(raw.url,2000);if(link&&!/^https?:\/\//i.test(link))return json({error:'Use a complete http or https link.'},400);
  pin.source_url=link;pin.note=text(raw.note,4000);pin.meta={kind:link?'link':'idea',title:text(raw.title||url.searchParams.get('title'),200)};pin.source_credit=text(raw.credit,200);
  if(!pin.source_url&&!pin.note.trim())return json({error:'Nothing to save.'},400);
 }else{
  const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>MAX_FILE)return json({error:'Image too large (25 MB max).'},413);
  const kind=sniffImage(new Uint8Array(bytes,0,Math.min(16,bytes.byteLength)));if(!kind)return json({error:'Images only.'},415);
  pin.file_ref=newId();await env.FILES.put(owner+'/'+pin.file_ref,bytes,{httpMetadata:{contentType:kind}});
  const src=text(url.searchParams.get('source'),2000);pin.source_url=/^https?:\/\//i.test(src)?src:'';pin.meta={kind:'image',title:text(url.searchParams.get('title'),200)};pin.source_credit=text(url.searchParams.get('credit'),200);
 }
 await putRecords(env,owner,[{kind:'pins',data:pin}]);
 return json({ok:true,board:board.name});
}

async function ownerApi(req:Request,env:Env,url:URL,ctx:Ctx){
 const claims=await accessClaims(req,env);if(!claims)return json({error:'Sign in required.'},401);
 await ensureSchema(env);
 let owner=typeof claims.email==='string'?claims.email.toLowerCase():null;
 if(!owner){
  // An Access service token (iPhone Shortcut) may only capture into, and list boards of, the single library owner.
  if(!claims.common_name||!['/api/capture','/api/boards'].includes(url.pathname))return json({error:'Sign in required.'},401);
  const {results}=await env.DB.prepare('SELECT DISTINCT owner FROM records LIMIT 2').all();if(results.length!==1)return json({error:'Capture needs exactly one library owner.'},409);
  owner=results[0].owner as string;
 }
 if(url.pathname==='/api/me')return json({email:owner});
 if(url.pathname==='/api/capture'&&req.method==='POST')return capture(req,env,url,owner);
 if(url.pathname==='/api/boards'){const {results}=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='boards'").bind(owner).all();const boards=results.map((r:any)=>JSON.parse(r.data));return json({boards:claims.email?boards:boards.filter((b:any)=>!b.deleted_at).map((b:any)=>b.name)});}
 if(url.pathname==='/api/sync'&&req.method==='GET'){
  ctx.waitUntil(cleanup(env).catch(()=>{}));
  const since=Math.max(0,Number(url.searchParams.get('since'))||0);
  const {results}=await env.DB.prepare('SELECT kind,data,seq FROM records WHERE owner=? AND seq>? ORDER BY seq LIMIT ?').bind(owner,since,PAGE).all();
  return json({records:results.map((r:any)=>({kind:r.kind,data:JSON.parse(r.data)})),cursor:results.length?results[results.length-1].seq:since,more:results.length===PAGE});
 }
 if(url.pathname==='/api/sync'&&req.method==='POST'){
  const body=await req.json().catch(()=>null) as any;const list=body?.records;
  if(!Array.isArray(list)||list.length>MAX_BATCH||!list.every((x:any)=>validRecord(x?.kind,x?.data)))return json({error:'Invalid records.'},400);
  await putRecords(env,owner,list);return json({ok:true});
 }
 if(url.pathname==='/api/shares'&&req.method==='GET'){const {results}=await env.DB.prepare('SELECT token,board_id,permission,created_at,expires_at FROM shares WHERE owner=? AND revoked_at IS NULL ORDER BY created_at DESC').bind(owner).all();return json({shares:results});}
 if(url.pathname==='/api/shares'&&req.method==='POST'){
  const body=await req.json().catch(()=>null) as any;if(!body||!ID.test(body.board_id)||!['view','comment'].includes(body.permission))return json({error:'Choose a board and what the client can do.'},400);
  const board=await record(env,owner,'boards',body.board_id);if(!board||board.deleted_at)return json({error:'This board has not synced yet. Wait a moment and try again.'},409);
  const days=Number(body.expires_days)||0;const expires=days>0&&days<=365?new Date(Date.now()+days*86400_000).toISOString():null;
  const share={token:randomToken(),board_id:body.board_id,permission:body.permission,created_at:new Date().toISOString(),expires_at:expires};
  await env.DB.prepare('INSERT INTO shares(token,owner,board_id,permission,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(share.token,owner,share.board_id,share.permission,share.created_at,share.expires_at).run();
  return json({share});
 }
 const revoke=url.pathname.match(/^\/api\/shares\/([A-Za-z0-9_-]{32,64})$/);
 if(revoke&&req.method==='DELETE'){await env.DB.prepare('UPDATE shares SET revoked_at=? WHERE token=? AND owner=?').bind(new Date().toISOString(),revoke[1],owner).run();return json({ok:true});}
 const file=url.pathname.match(/^\/api\/files\/([0-9A-Za-z_-]{1,64})$/);
 if(file){const key=owner+'/'+file[1];
  if(req.method==='HEAD'){const o=await env.FILES.head(key);return new Response(null,{status:o?200:404});}
  if(req.method==='GET'){const o=await env.FILES.get(key);if(!o)return json({error:'Not found.'},404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, max-age=31536000, immutable'}});}
  if(req.method==='PUT'){const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>MAX_FILE)return json({error:'Image too large.'},413);
   // The stored type comes from the file's own bytes, never the client's header.
   const type=sniffImage(new Uint8Array(bytes,0,Math.min(16,bytes.byteLength)));if(!type)return json({error:'Images only.'},415);
   await env.FILES.put(key,bytes,{httpMetadata:{contentType:type}});await env.DB.prepare('DELETE FROM purged_files WHERE owner=? AND ref=?').bind(owner,file[1]).run();return json({ok:true});}
 }
 return json({error:'Not found.'},404);
}

/** A share is usable while not revoked, not expired, and its board still exists. */
async function openShare(env:Env,token:string){
 if(!TOKEN.test(token))return null;await ensureSchema(env);
 const share=await env.DB.prepare('SELECT * FROM shares WHERE token=?').bind(token).first() as any;
 if(!share||share.revoked_at||(share.expires_at&&Date.parse(share.expires_at)<Date.now()))return null;
 const board=await record(env,share.owner,'boards',share.board_id);if(!board||board.deleted_at)return null;
 // A board with comments turned off is view-only for every link.
 return {...share,board,permission:board.comments_enabled===false?'view':share.permission};
}
const guestId=(req:Request)=>{const g=req.headers.get('x-guest-id')||'';return /^[A-Za-z0-9_-]{16,64}$/.test(g)?g:null;};

async function shareApi(req:Request,env:Env,url:URL,token:string,rest:string){
 const share=await openShare(env,token);if(!share)return json({error:'This link is no longer active.'},404);
 if(rest===''&&req.method==='GET'){
  const pins=await boardPins(env,share.owner,share.board_id);const g=guestId(req);
  const {results}=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='feedback' AND json_extract(data,'$.board_id')=? AND json_extract(data,'$.deleted_at') IS NULL").bind(share.owner,share.board_id).all();
  const feedback=results.map((r:any)=>JSON.parse(r.data));
  return json({board:{name:share.board.name,description:share.board.description||''},permission:share.permission,expires_at:share.expires_at,pins:pins.map(publicPin),
   comments:feedback.filter((f:any)=>f.text).sort((a:any,b:any)=>String(a.created_at).localeCompare(String(b.created_at))).map((f:any)=>({id:f.id,pin_id:f.pin_id||null,text:f.text,author:f.author_name||(String(f.created_by).startsWith('guest:')?'Client':'Artist'),created_at:f.created_at})),
   starred:g?feedback.filter((f:any)=>f.starred===true&&f.created_by==='guest:'+g).map((f:any)=>f.pin_id):[]});
 }
 const file=rest.match(/^\/files\/([0-9A-Za-z_-]{1,64})$/);
 if(file&&req.method==='GET'){
  const ok=await env.DB.prepare("SELECT 1 FROM records WHERE owner=? AND kind='pins' AND json_extract(data,'$.board_id')=? AND json_extract(data,'$.file_ref')=? AND json_extract(data,'$.deleted_at') IS NULL LIMIT 1").bind(share.owner,share.board_id,file[1]).first();
  if(!ok)return json({error:'Not found.'},404);const o=await env.FILES.get(share.owner+'/'+file[1]);if(!o)return json({error:'Not found.'},404);
  return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, max-age=600'}});
 }
 if(rest==='/feedback'&&req.method==='POST'){
  if(share.permission!=='comment')return json({error:'This link is view only.'},403);
  const g=guestId(req);if(!g)return json({error:'Reload the page and try again.'},400);
  const body=await req.json().catch(()=>null) as any;if(!body)return json({error:'Nothing to send.'},400);
  const pinId=body.pin_id?String(body.pin_id):null;
  if(pinId){const p=await record(env,share.owner,'pins',pinId);if(!p||p.deleted_at||p.board_id!==share.board_id)return json({error:'That image is no longer on this board.'},404);}
  const recent=await env.DB.prepare("SELECT COUNT(*) n FROM records WHERE owner=? AND kind='feedback' AND json_extract(data,'$.created_by')=? AND updated_at>?").bind(share.owner,'guest:'+g,new Date(Date.now()-3600_000).toISOString()).first() as any;
  if(recent&&recent.n>=60)return json({error:'Too many messages — please wait a little.'},429);
  const now=new Date().toISOString(),name=String(body.name||'').trim().slice(0,60)||'Client';
  if(typeof body.starred==='boolean'){
   if(!pinId)return json({error:'Choose an image to star.'},400);
   const prior=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='feedback' AND json_extract(data,'$.created_by')=? AND json_extract(data,'$.pin_id')=? AND json_extract(data,'$.starred') IS NOT NULL LIMIT 1").bind(share.owner,'guest:'+g,pinId).first() as any;
   const base=prior?JSON.parse(prior.data):{id:newId(),studio_id:'local-studio',created_at:now,created_by:'guest:'+g,actor_type:'human',version:0,deleted_at:null,board_id:share.board_id,pin_id:pinId,text:''};
   await putRecords(env,share.owner,[{kind:'feedback',data:{...base,starred:body.starred,author_name:name,updated_at:now,version:base.version+1}}]);return json({ok:true});
  }
  const text=String(body.text||'').trim();if(!text||text.length>2000)return json({error:'Write a comment (up to 2,000 characters).'},400);
  const f={id:newId(),studio_id:'local-studio',created_at:now,updated_at:now,created_by:'guest:'+g,actor_type:'human',version:1,deleted_at:null,board_id:share.board_id,pin_id:pinId,text,author_name:name};
  await putRecords(env,share.owner,[{kind:'feedback',data:f}]);return json({comment:{id:f.id,pin_id:pinId,text,author:name,created_at:now}});
 }
 return json({error:'Not found.'},404);
}

/** The client page, with link-preview tags (iMessage, email, social) filled in for active links. */
async function sharePage(req:Request,env:Env,url:URL,token:string){
 // Static hosting serves share.html at /share (it redirects the .html form).
 const page=await env.ASSETS.fetch(new Request(new URL('/share',url)));let html=await page.text();
 let tags='<meta property="og:title" content="Studio Wall"><meta property="og:description" content="A shared mood board">';
 if(env.DB){const share=await openShare(env,token).catch(()=>null);
  if(share){const pins=await boardPins(env,share.owner,share.board_id);const cover=pins.find((p:any)=>p.id===share.board.cover_pin_id&&p.file_ref)||pins.find((p:any)=>p.file_ref);
   tags=`<meta property="og:title" content="${esc(share.board.name)}"><meta property="og:description" content="${esc(share.board.description||`${pins.length} reference${pins.length===1?'':'s'} · shared from Studio Wall`)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(url.origin+url.pathname)}">${cover?`<meta property="og:image" content="${esc(`${url.origin}/api/s/${token}/files/${cover.file_ref}`)}"><meta name="twitter:card" content="summary_large_image">`:''}<title>${esc(share.board.name)} · Studio Wall</title>`;}}
 html=html.replace('<!--share-meta-->',tags);
 return new Response(html,{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'}});
}

export default {async fetch(req:Request,env:Env,ctx:Ctx){
 const url=new URL(req.url);
 try{
  const page=url.pathname.match(/^\/s\/([A-Za-z0-9_-]{32,64})\/?$/);if(page)return await sharePage(req,env,url,page[1]);
  if(url.pathname.startsWith('/api/')){
   if(!env.DB||!env.FILES||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return json({error:'Sync is not configured.'},503);
   const shared=url.pathname.match(/^\/api\/s\/([A-Za-z0-9_-]{32,64})(\/.*)?$/);if(shared)return await shareApi(req,env,url,shared[1],shared[2]||'');
   return await ownerApi(req,env,url,ctx);
  }
 }catch{return json({error:'Server error.'},500);}
 return env.ASSETS.fetch(req);
}};
