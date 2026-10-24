// Studio Wall API. Runs only for /api/* and /s/* (see wrangler.jsonc); everything else is the static app.
// Owner routes: identity comes from Cloudflare Access (email login, or an Access service token for the iPhone Shortcut).
// Client share routes (/s/<token>, /api/s/<token>/…) are public by design: the random token is the credential, and the
// server decides what it exposes (one board, its live cards and images; never notes on images, tags or other boards).
// A link may cover only chosen cards of its board (shares.pin_ids); then everything it serves is limited to those cards.
// A link with a password also needs an unlock cookie, issued by /api/s/<token>/unlock and scoped to that link's API path.
// Without ACCESS_TEAM_DOMAIN, ACCESS_AUD, DB and FILES configured, the API refuses requests (fail closed).
// Images lose their hidden metadata (GPS, camera, dates) when stored, and again when a client link serves them.
// /v1/* goes untouched to the studio platform's studio-api through the API service binding (backend plan, stage 2):
// the studio's own sign-in and data. Without the binding it answers 503, and nothing else here changes.
import {stripMetadata} from './strip';
type Env={ASSETS:{fetch(r:Request):Promise<Response>};API?:{fetch(r:Request):Promise<Response>};DB?:any;FILES?:any;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
type Ctx={waitUntil(p:Promise<unknown>):void};
const KINDS=['boards','pins','feedback'];
const ID=/^[0-9A-Za-z_-]{1,64}$/;
const TOKEN=/^[A-Za-z0-9_-]{32,64}$/;
const MAX_RECORD=200_000,MAX_BATCH=500,MAX_FILE=25*1024*1024,PAGE=500;
// Cards clients add through a link: the page sends WebP ≤2400 px, so 10 MB is generous. Per board per day, and per client.
const GUEST_FILE=10*1024*1024,ADD_PER_BOARD=100,ADD_PER_GUEST=25,ADD_BATCH=10;
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
 return {id:p.id,file_ref:p.file_ref||null,meta:{kind,title:String(p.meta?.title||'')},source_credit:p.is_own?'':String(p.source_credit||''),is_own:!!p.is_own,source_url:kind==='link'?String(p.source_url||''):'',note:kind==='image'?'':String(p.note||''),palette:Array.isArray(p.palette)?p.palette:[],contributor:String(p.contributor_name||''),created_at:p.created_at};
}

// Link passwords: PBKDF2-SHA256, 16-byte salt, stored as pbkdf2$rounds$salt$hash. 20,000 rounds is about 4 ms of CPU, inside
// the Workers Free plan's 10 ms per request (100,000 measured about 18 ms). Guessing also needs the link itself and is rate limited.
const ROUNDS=20_000,LOCKOUT=10,LOCKOUT_MS=15*60_000,UNLOCK_DAYS=30;
const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b));
async function pbkdf2(password:string,salt:Uint8Array<ArrayBuffer>,rounds:number){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:rounds},key,256));
}
export async function hashPassword(password:string){const salt=crypto.getRandomValues(new Uint8Array(16));return `pbkdf2$${ROUNDS}$${b64(salt)}$${b64(await pbkdf2(password,salt,ROUNDS))}`;}
export async function checkPassword(password:string,stored:string){
 const [kind,rounds,salt,hash]=stored.split('$');if(kind!=='pbkdf2'||!hash)return false;
 const got=await pbkdf2(password,Uint8Array.from(atob(salt),c=>c.charCodeAt(0)),Number(rounds)),want=Uint8Array.from(atob(hash),c=>c.charCodeAt(0));
 let diff=got.length^want.length;for(let i=0;i<got.length;i++)diff|=got[i]^(want[i]??0);return diff===0;
}

const SCHEMA=[
 'CREATE TABLE IF NOT EXISTS records(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,updated_at TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,kind,id))',
 'CREATE INDEX IF NOT EXISTS records_seq ON records(owner,seq)',
 'CREATE TABLE IF NOT EXISTS shares(token TEXT PRIMARY KEY,owner TEXT NOT NULL,board_id TEXT NOT NULL,permission TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT,revoked_at TEXT)',
 'CREATE INDEX IF NOT EXISTS shares_owner ON shares(owner,board_id)',
 'CREATE TABLE IF NOT EXISTS purged_files(owner TEXT NOT NULL,ref TEXT NOT NULL,PRIMARY KEY(owner,ref))',
 'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS share_sessions(id TEXT PRIMARY KEY,token TEXT NOT NULL,expires_at TEXT NOT NULL)',
 'CREATE TABLE IF NOT EXISTS share_attempts(token TEXT NOT NULL,ip TEXT NOT NULL,at TEXT NOT NULL)',
 'CREATE INDEX IF NOT EXISTS share_attempts_at ON share_attempts(token,ip,at)'];
let ready=false;
async function ensureSchema(env:Env){if(!ready){await env.DB.batch(SCHEMA.map(s=>env.DB.prepare(s)));
 // shares predates passwords and chosen cards; each column is added once (an existing column makes ALTER fail, which is fine).
 for(const column of ['password TEXT','pin_ids TEXT'])await env.DB.prepare('ALTER TABLE shares ADD COLUMN '+column).run().catch(()=>{});ready=true;}}
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
 const today=new Date(now).toISOString();await env.DB.batch([env.DB.prepare('DELETE FROM share_sessions WHERE expires_at<?').bind(today),env.DB.prepare('DELETE FROM share_attempts WHERE at<?').bind(new Date(now-86400_000).toISOString())]);
 return results.length;
}

/** iPhone Shortcut capture: an image (raw bytes) or a link/note (JSON) goes into the named board, or the Inbox. */
/** Builds a card from a request: image bytes (title/credit/source in the query) or JSON / text with url, note, title, credit.
 *  Images are sniffed by their bytes, stripped of hidden data and stored in R2. Returns an error response instead when the input is bad. */
const blankPin=(boardId:string,createdBy:string,now=new Date().toISOString()):any=>({id:newId(),studio_id:'local-studio',created_at:now,updated_at:now,created_by:createdBy,actor_type:'human',version:1,deleted_at:null,board_id:boardId,file_ref:null,source_url:'',source_credit:'',is_own:false,note:'',tags:[],palette:[],linked_type:null,linked_id:null,annotations:[],meta:{kind:'idea',title:''}});
const okPalette=(v:string|null)=>(v||'').split(',').filter(c=>/^#[0-9a-f]{6}$/i.test(c)).slice(0,8);
async function readCard(req:Request,env:Env,url:URL,owner:string,boardId:string,createdBy:string,maxBytes:number):Promise<any>{
 const type=req.headers.get('content-type')||'';const pin=blankPin(boardId,createdBy);
 const text=(v:unknown,max:number)=>String(v??'').slice(0,max);
 if(type.startsWith('application/json')||type.startsWith('text/')){
  const raw=type.startsWith('text/')?{url:(await req.text()).trim()}:await req.json().catch(()=>null) as any;if(!raw)return json({error:'Send an image, or JSON with url / note.'},400);
  // An iPhone Shortcut may send its URLs variable as a list or as several lines; the first link is kept.
  const link=text((Array.isArray(raw.url)?String(raw.url[0]??''):String(raw.url??'')).trim().split(/\s+/)[0],2000);if(link&&!/^https?:\/\//i.test(link))return json({error:'Use a complete http or https link.'},400);
  pin.source_url=link;pin.note=text(raw.note,4000);pin.meta={kind:link?'link':'idea',title:text(raw.title||url.searchParams.get('title'),200)};pin.source_credit=text(raw.credit,200);
  if(!pin.source_url&&!pin.note.trim())return json({error:'Nothing to save.'},400);
 }else{
  const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>maxBytes)return json({error:`Image too large (${Math.round(maxBytes/1048576)} MB max).`},413);
  const kind=sniffImage(new Uint8Array(bytes,0,Math.min(16,bytes.byteLength)));if(!kind)return json({error:'Images only.'},415);
  pin.file_ref=newId();await env.FILES.put(owner+'/'+pin.file_ref,stripMetadata(new Uint8Array(bytes),kind),{httpMetadata:{contentType:kind}});
  const src=text(url.searchParams.get('source'),2000);pin.source_url=/^https?:\/\//i.test(src)?src:'';pin.meta={kind:'image',title:text(url.searchParams.get('title'),200)};pin.source_credit=text(url.searchParams.get('credit'),200);
 }
 if(pin.file_ref)pin.palette=okPalette(url.searchParams.get('palette'));
 return pin;
}
/** Several images in one multipart request (fields: image × n, palette × n in the same order, title). Every image is checked before any is stored. */
async function readImages(req:Request,maxBytes:number){
 const form=await req.formData().catch(()=>null);if(!form)return json({error:'Send the images again.'},400);
 const files=form.getAll('image').filter((f):f is File=>typeof f!=='string'),palettes=form.getAll('palette').map(String);
 if(!files.length)return json({error:'Choose an image.'},400);if(files.length>ADD_BATCH)return json({error:`Up to ${ADD_BATCH} images at a time.`},400);
 const images:{bytes:Uint8Array<ArrayBuffer>;kind:string;palette:string[]}[]=[];
 for(const [i,f] of files.entries()){const bytes=new Uint8Array(await f.arrayBuffer());if(!bytes.byteLength||bytes.byteLength>maxBytes)return json({error:`Image too large (${Math.round(maxBytes/1048576)} MB max).`},413);
  const kind=sniffImage(bytes.subarray(0,16));if(!kind)return json({error:'Images only.'},415);images.push({bytes,kind,palette:okPalette(palettes[i]||'')});}
 return {images,title:String(form.get('title')||'').slice(0,200)};
}
async function capture(req:Request,env:Env,url:URL,owner:string){
 const {results}=await env.DB.prepare("SELECT data,seq FROM records WHERE owner=? AND kind='boards' ORDER BY seq").bind(owner).all();
 const boards=results.map((r:any)=>JSON.parse(r.data)).filter((b:any)=>!b.deleted_at);
 const want=(url.searchParams.get('board')||'').trim().toLowerCase();
 const board=boards.find((b:any)=>want&&b.name.toLowerCase()===want)||boards.find((b:any)=>b.name==='Inbox');
 if(!board)return json({error:'Open Studio Wall once with sync on, then try again.'},409);
 const pin=await readCard(req,env,url,owner,board.id,'shortcut',MAX_FILE);if(pin instanceof Response)return pin;
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
 if(url.pathname==='/api/shares'&&req.method==='GET'){const {results}=await env.DB.prepare('SELECT token,board_id,permission,created_at,expires_at,password IS NOT NULL locked,json_array_length(pin_ids) pin_count FROM shares WHERE owner=? AND revoked_at IS NULL ORDER BY created_at DESC').bind(owner).all();return json({shares:results.map((r:any)=>({...r,locked:!!r.locked}))});}
 if(url.pathname==='/api/shares'&&req.method==='POST'){
  const body=await req.json().catch(()=>null) as any;if(!body||!ID.test(body.board_id)||!['view','comment','contribute'].includes(body.permission))return json({error:'Choose a board and what the client can do.'},400);
  const board=await record(env,owner,'boards',body.board_id);if(!board||board.deleted_at)return json({error:'This board has not synced yet. Wait a moment and try again.'},409);
  const days=Number(body.expires_days)||0;const expires=days>0&&days<=365?new Date(Date.now()+days*86400_000).toISOString():null;
  const password=typeof body.password==='string'?body.password:'';if(password&&(password.length<8||password.length>200))return json({error:'Use a password of at least 8 characters.'},400);
  let only:string[]|null=null;
  if(body.pin_ids!==undefined){
   if(!Array.isArray(body.pin_ids)||!body.pin_ids.length||body.pin_ids.length>500||!body.pin_ids.every((id:unknown)=>typeof id==='string'&&ID.test(id)))return json({error:'Choose the cards to share.'},400);
   const live=new Set((await boardPins(env,owner,body.board_id)).map((p:any)=>p.id));only=[...new Set<string>(body.pin_ids)].filter(id=>live.has(id));
   if(!only.length)return json({error:'Those cards have not synced yet. Wait a moment and try again.'},409);
  }
  const share={token:randomToken(),board_id:body.board_id,permission:body.permission,created_at:new Date().toISOString(),expires_at:expires,locked:!!password,pin_count:only?only.length:null};
  await env.DB.prepare('INSERT INTO shares(token,owner,board_id,permission,created_at,expires_at,password,pin_ids) VALUES(?,?,?,?,?,?,?,?)').bind(share.token,owner,share.board_id,share.permission,share.created_at,share.expires_at,password?await hashPassword(password):null,only?JSON.stringify(only):null).run();
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
   await env.FILES.put(key,stripMetadata(new Uint8Array(bytes),type),{httpMetadata:{contentType:type}});await env.DB.prepare('DELETE FROM purged_files WHERE owner=? AND ref=?').bind(owner,file[1]).run();return json({ok:true});}
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
 return {...share,board,permission:board.comments_enabled===false?'view':share.permission,only:share.pin_ids?new Set<string>(JSON.parse(share.pin_ids)):null};
}
const unlockCookie=(req:Request)=>req.headers.get('cookie')?.match(/(?:^|;\s*)sw_link=([A-Za-z0-9_-]{32})/)?.[1]||null;
async function unlocked(req:Request,env:Env,token:string){const id=unlockCookie(req);return !!id&&!!await env.DB.prepare('SELECT 1 FROM share_sessions WHERE id=? AND token=? AND expires_at>?').bind(id,token,new Date().toISOString()).first();}
/** Checks a link's password. Ten wrong tries from one address lock that address out of the link for 15 minutes. */
async function unlock(req:Request,env:Env,share:any){
 const ip=req.headers.get('cf-connecting-ip')||'unknown',since=new Date(Date.now()-LOCKOUT_MS).toISOString();
 const tries=await env.DB.prepare('SELECT COUNT(*) n FROM share_attempts WHERE token=? AND ip=? AND at>?').bind(share.token,ip,since).first() as any;
 if(tries&&tries.n>=LOCKOUT)return json({error:'Too many tries. Wait 15 minutes, or ask the artist for the password.'},429);
 const body=await req.json().catch(()=>null) as any;const password=typeof body?.password==='string'?body.password.slice(0,200):'';
 if(!password||!share.password||!await checkPassword(password,share.password)){await env.DB.prepare('INSERT INTO share_attempts(token,ip,at) VALUES(?,?,?)').bind(share.token,ip,new Date().toISOString()).run();return json({error:'That password isn’t right.'},400);}
 const until=Math.min(Date.now()+UNLOCK_DAYS*86400_000,share.expires_at?Date.parse(share.expires_at):Infinity),id=randomToken().slice(0,32);
 await env.DB.prepare('INSERT INTO share_sessions(id,token,expires_at) VALUES(?,?,?)').bind(id,share.token,new Date(until).toISOString()).run();
 const res=json({ok:true});res.headers.append('set-cookie',`sw_link=${id}; Path=/api/s/${share.token}; Max-Age=${Math.max(1,Math.floor((until-Date.now())/1000))}; HttpOnly; Secure; SameSite=Lax`);return res;
}
/** The cards a link shows: the board's live cards, narrowed to the chosen ones when the link has a selection. */
const inShare=(share:any,pinId:string|null)=>!share.only||(!!pinId&&share.only.has(pinId));
const sharedPins=async(env:Env,share:any)=>(await boardPins(env,share.owner,share.board_id)).filter((p:any)=>inShare(share,p.id));
const guestId=(req:Request)=>{const g=req.headers.get('x-guest-id')||'';return /^[A-Za-z0-9_-]{16,64}$/.test(g)?g:null;};

async function shareApi(req:Request,env:Env,url:URL,token:string,rest:string){
 const share=await openShare(env,token);if(!share)return json({error:'This link is no longer active.'},404);
 if(share.password){if(rest==='/unlock'&&req.method==='POST')return unlock(req,env,share);if(!await unlocked(req,env,token))return json({error:'This board needs a password.',password:true},401);}
 if(rest===''&&req.method==='GET'){
  const pins=await sharedPins(env,share);const g=guestId(req);
  const {results}=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='feedback' AND json_extract(data,'$.board_id')=? AND json_extract(data,'$.deleted_at') IS NULL").bind(share.owner,share.board_id).all();
  // Board-wide comments always show; comments and stars on cards outside a selection never do.
  const feedback=results.map((r:any)=>JSON.parse(r.data)).filter((f:any)=>!f.pin_id||inShare(share,f.pin_id));
  return json({board:{name:share.board.name,description:share.board.description||''},permission:share.permission,expires_at:share.expires_at,pins:pins.map((p:any)=>({...publicPin(p),mine:!!g&&p.created_by==='guest:'+g})),
   comments:feedback.filter((f:any)=>f.text).sort((a:any,b:any)=>String(a.created_at).localeCompare(String(b.created_at))).map((f:any)=>({id:f.id,pin_id:f.pin_id||null,text:f.text,author:f.author_name||(String(f.created_by).startsWith('guest:')?'Client':'Artist'),created_at:f.created_at})),
   starred:g?feedback.filter((f:any)=>f.starred===true&&f.created_by==='guest:'+g).map((f:any)=>f.pin_id):[]});
 }
 const file=rest.match(/^\/files\/([0-9A-Za-z_-]{1,64})$/);
 if(file&&req.method==='GET'){
  const {results:users}=await env.DB.prepare("SELECT id FROM records WHERE owner=? AND kind='pins' AND json_extract(data,'$.board_id')=? AND json_extract(data,'$.file_ref')=? AND json_extract(data,'$.deleted_at') IS NULL").bind(share.owner,share.board_id,file[1]).all();
  if(!users.some((r:any)=>inShare(share,r.id)))return json({error:'Not found.'},404);const o=await env.FILES.get(share.owner+'/'+file[1]);if(!o)return json({error:'Not found.'},404);
  // Stripped again on the way out: images stored before stripping existed may still carry a location.
  const type=o.httpMetadata?.contentType||'application/octet-stream';
  return new Response(stripMetadata(new Uint8Array(await o.arrayBuffer()),type),{headers:{'content-type':type,'cache-control':'private, max-age=600'}});
 }
 if(rest==='/feedback'&&req.method==='POST'){
  if(share.permission==='view')return json({error:'This link is view only.'},403);
  const g=guestId(req);if(!g)return json({error:'Reload the page and try again.'},400);
  const body=await req.json().catch(()=>null) as any;if(!body)return json({error:'Nothing to send.'},400);
  const pinId=body.pin_id?String(body.pin_id):null;
  if(pinId){const p=await record(env,share.owner,'pins',pinId);if(!p||p.deleted_at||p.board_id!==share.board_id||!inShare(share,pinId))return json({error:'That image is no longer on this board.'},404);}
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
 if(rest==='/pins'&&req.method==='POST'){
  if(share.permission!=='contribute')return json({error:'This link can’t add cards.'},403);
  const g=guestId(req);if(!g)return json({error:'Reload the page and try again.'},400);
  const many=(req.headers.get('content-type')||'').startsWith('multipart/form-data')?await readImages(req,GUEST_FILE):null;if(many instanceof Response)return many;
  const n=many?many.images.length:1;
  const added=await env.DB.prepare("SELECT COUNT(*) n,COALESCE(SUM(json_extract(data,'$.created_by')=?3),0) mine FROM records WHERE owner=?1 AND kind='pins' AND json_extract(data,'$.board_id')=?2 AND json_extract(data,'$.created_by') LIKE 'guest:%' AND json_extract(data,'$.created_at')>?4").bind(share.owner,share.board_id,'guest:'+g,new Date(Date.now()-86400_000).toISOString()).first() as any;
  const left=Math.min(ADD_PER_BOARD-Number(added?.n||0),ADD_PER_GUEST-Number(added?.mine||0));
  if(n>left)return json({error:left>0?`You can add ${left} more today. Choose fewer images.`:'That’s the limit for today. Please send more tomorrow.'},429);
  let pins:any[];
  if(many){pins=many.images.map(()=>({...blankPin(share.board_id,'guest:'+g)}));
   // All-or-nothing: every file is stored before the cards are written in one batch; files of a failed batch are removed again.
   await Promise.all(pins.map((p,i)=>{const {bytes,kind,palette}=many.images[i];p.file_ref=newId();p.palette=palette;p.meta={kind:'image',title:many.title};return env.FILES.put(share.owner+'/'+p.file_ref,stripMetadata(bytes,kind),{httpMetadata:{contentType:kind}});}));}
  else{const pin=await readCard(req,env,url,share.owner,share.board_id,'guest:'+g,GUEST_FILE);if(pin instanceof Response)return pin;pins=[pin];}
  const name=String(url.searchParams.get('name')||'').trim().slice(0,60)||'Client';
  const writes=pins.map(p=>{p.contributor_name=name;return env.DB.prepare(UPSERT).bind(share.owner,'pins',p.id,p.updated_at,JSON.stringify(p));});
  // A link to chosen cards also shows the cards its clients add.
  if(share.only)for(const p of pins)writes.push(env.DB.prepare("UPDATE shares SET pin_ids=json_insert(pin_ids,'$[#]',?) WHERE token=?").bind(p.id,share.token));
  try{await env.DB.batch(writes);}catch(e){await Promise.all(pins.filter(p=>p.file_ref).map(p=>env.FILES.delete(share.owner+'/'+p.file_ref).catch(()=>{})));throw e;}
  const out=pins.map(p=>({...publicPin(p),mine:true}));return json(many?{pins:out}:{pin:out[0]});
 }
 const own=rest.match(/^\/pins\/([0-9A-Za-z_-]{1,64})$/);
 if(own&&req.method==='DELETE'){
  if(share.permission!=='contribute')return json({error:'This link can’t change cards.'},403);
  const g=guestId(req);if(!g)return json({error:'Reload the page and try again.'},400);
  const p=await record(env,share.owner,'pins',own[1]);
  if(!p||p.deleted_at||p.board_id!==share.board_id||!inShare(share,p.id))return json({error:'That card is no longer on this board.'},404);
  // A client removes only cards added from their own browser. It is a soft delete, so the owner can restore it from Recently deleted for 30 days; deleted_by tells the owner's app a client removed it.
  if(p.created_by!=='guest:'+g)return json({error:'You can only remove cards you added.'},403);
  const now=new Date().toISOString();await putRecords(env,share.owner,[{kind:'pins',data:{...p,deleted_at:now,deleted_by:'guest:'+g,updated_at:now,version:(Number(p.version)||1)+1}}]);return json({ok:true});
 }
 return json({error:'Not found.'},404);
}

/** The client page, with link-preview tags (iMessage, email, social) filled in for active links. */
async function sharePage(req:Request,env:Env,url:URL,token:string){
 // Static hosting serves share.html at /share (it redirects the .html form).
 const page=await env.ASSETS.fetch(new Request(new URL('/share',url)));let html=await page.text();
 let tags='<meta property="og:title" content="Studio Wall"><meta property="og:description" content="A shared mood board">';
 if(env.DB){const share=await openShare(env,token).catch(()=>null);
  // A password link's preview names nothing: no board name, description or cover image.
  if(share&&!share.password){const pins=await sharedPins(env,share);const cover=pins.find((p:any)=>p.id===share.board.cover_pin_id&&p.file_ref)||pins.find((p:any)=>p.file_ref);
   tags=`<meta property="og:title" content="${esc(share.board.name)}"><meta property="og:description" content="${esc(share.board.description||`${pins.length} reference${pins.length===1?'':'s'} · shared from Studio Wall`)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(url.origin+url.pathname)}">${cover?`<meta property="og:image" content="${esc(`${url.origin}/api/s/${token}/files/${cover.file_ref}`)}"><meta name="twitter:card" content="summary_large_image">`:''}<title>${esc(share.board.name)} · Studio Wall</title>`;}}
 html=html.replace('<!--share-meta-->',tags);
 return new Response(html,{headers:{'content-type':'text/html;charset=UTF-8','cache-control':'no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'}});
}

/** The studio platform's API, on this origin, as Booth Studio does it. Errors use the platform's shape. */
async function forwardToStudio(req:Request,env:Env){
 const down=(message:string)=>new Response(JSON.stringify({error:{code:'unavailable',message}}),{status:503,headers:{'content-type':'application/json','cache-control':'no-store'}});
 if(!env.API)return down("The studio isn't connected to this copy of Studio Wall.");
 try{return await env.API.fetch(req);}catch{return down("The studio can't be reached just now.");}
}

export default {async fetch(req:Request,env:Env,ctx:Ctx){
 const url=new URL(req.url);
 if(url.pathname.startsWith('/v1/'))return forwardToStudio(req,env);
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
