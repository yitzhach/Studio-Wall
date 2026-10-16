// Studio Wall sync API. Runs only for /api/* (see wrangler.jsonc); everything else is the static app.
// Identity comes from Cloudflare Access: every request must carry a valid Access JWT for this app's audience.
// Without ACCESS_TEAM_DOMAIN, ACCESS_AUD, DB and FILES configured, the API refuses requests (fail closed).
type Env={ASSETS:{fetch(r:Request):Promise<Response>};DB?:any;FILES?:any;ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
const KINDS=['boards','pins','feedback'];
const ID=/^[0-9A-Za-z_-]{1,64}$/;
const MAX_RECORD=200_000,MAX_BATCH=500,MAX_FILE=25*1024*1024,PAGE=500;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64url=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
let certs:{at:number;keys:any[]}|null=null;
async function identity(req:Request,env:Env):Promise<string|null>{
 const token=req.headers.get('cf-access-jwt-assertion');if(!token||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return null;
 const [h,p,s]=token.split('.');if(!h||!p||!s)return null;
 const header=JSON.parse(new TextDecoder().decode(b64url(h))),claims=JSON.parse(new TextDecoder().decode(b64url(p)));
 const team='https://'+env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//,'').replace(/\/$/,'');
 if(header.alg!=='RS256'||claims.iss!==team||!(Array.isArray(claims.aud)?claims.aud:[claims.aud]).includes(env.ACCESS_AUD)||!(claims.exp*1000>Date.now())||typeof claims.email!=='string')return null;
 if(!certs||Date.now()-certs.at>3600_000)certs={at:Date.now(),keys:(await (await fetch(team+'/cdn-cgi/access/certs')).json() as any).keys};
 const jwk=certs.keys.find(k=>k.kid===header.kid);if(!jwk)return null;
 const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
 const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(s),new TextEncoder().encode(h+'.'+p));
 return ok?claims.email.toLowerCase():null;
}
export function validRecord(kind:string,r:any){
 if(!KINDS.includes(kind)||!r||!ID.test(r.id)||typeof r.updated_at!=='string'||isNaN(Date.parse(r.updated_at)))return false;
 if(kind!=='boards'&&!ID.test(r.board_id))return false;
 if(kind==='pins'&&r.file_ref!==null&&r.file_ref!==undefined&&!ID.test(r.file_ref))return false;
 return JSON.stringify(r).length<=MAX_RECORD;
}
const SCHEMA=['CREATE TABLE IF NOT EXISTS records(owner TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,updated_at TEXT NOT NULL,seq INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,kind,id))','CREATE INDEX IF NOT EXISTS records_seq ON records(owner,seq)'];
let ready=false;
async function api(req:Request,env:Env,url:URL){
 if(!env.DB||!env.FILES||!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD)return json({error:'Sync is not configured.'},503);
 const owner=await identity(req,env);if(!owner)return json({error:'Sign in required.'},401);
 if(!ready){await env.DB.batch(SCHEMA.map(s=>env.DB.prepare(s)));ready=true;}
 if(url.pathname==='/api/me')return json({email:owner});
 if(url.pathname==='/api/boards'){const {results}=await env.DB.prepare("SELECT data FROM records WHERE owner=? AND kind='boards'").bind(owner).all();return json({boards:results.map((r:any)=>JSON.parse(r.data))});}
 if(url.pathname==='/api/sync'&&req.method==='GET'){
  const since=Math.max(0,Number(url.searchParams.get('since'))||0);
  const {results}=await env.DB.prepare('SELECT kind,data,seq FROM records WHERE owner=? AND seq>? ORDER BY seq LIMIT ?').bind(owner,since,PAGE).all();
  return json({records:results.map((r:any)=>({kind:r.kind,data:JSON.parse(r.data)})),cursor:results.length?results[results.length-1].seq:since,more:results.length===PAGE});
 }
 if(url.pathname==='/api/sync'&&req.method==='POST'){
  const body=await req.json().catch(()=>null) as any;const list=body?.records;
  if(!Array.isArray(list)||list.length>MAX_BATCH||!list.every((x:any)=>validRecord(x?.kind,x?.data)))return json({error:'Invalid records.'},400);
  // Newest updated_at wins; each accepted write gets the next sequence number so other devices can pull "everything after N".
  const sql='INSERT INTO records(owner,kind,id,updated_at,seq,data) VALUES(?1,?2,?3,?4,(SELECT COALESCE(MAX(seq),0)+1 FROM records WHERE owner=?1),?5) ON CONFLICT(owner,kind,id) DO UPDATE SET updated_at=excluded.updated_at,seq=excluded.seq,data=excluded.data WHERE excluded.updated_at>records.updated_at';
  if(list.length)await env.DB.batch(list.map((x:any)=>env.DB.prepare(sql).bind(owner,x.kind,x.data.id,x.data.updated_at,JSON.stringify(x.data))));
  return json({ok:true});
 }
 const file=url.pathname.match(/^\/api\/files\/([0-9A-Za-z_-]{1,64})$/);
 if(file){const key=owner+'/'+file[1];
  if(req.method==='HEAD'){const o=await env.FILES.head(key);return new Response(null,{status:o?200:404});}
  if(req.method==='GET'){const o=await env.FILES.get(key);if(!o)return json({error:'Not found.'},404);return new Response(o.body,{headers:{'content-type':o.httpMetadata?.contentType||'application/octet-stream','cache-control':'private, max-age=31536000, immutable'}});}
  if(req.method==='PUT'){const type=req.headers.get('content-type')||'';if(!/^image\/(webp|jpeg|png|gif|heic|heif)$/.test(type))return json({error:'Images only.'},415);
   const bytes=await req.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>MAX_FILE)return json({error:'Image too large.'},413);
   await env.FILES.put(key,bytes,{httpMetadata:{contentType:type}});return json({ok:true});}
 }
 return json({error:'Not found.'},404);
}
export default {async fetch(req:Request,env:Env){const url=new URL(req.url);if(url.pathname.startsWith('/api/'))try{return await api(req,env,url);}catch{return json({error:'Server error.'},500);}return env.ASSETS.fetch(req);}};
