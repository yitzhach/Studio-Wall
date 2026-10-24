// Stage 2 of docs/backend-and-ai-plan.md: /v1/* reaches studio-api through the API service binding, untouched.
import {it,expect} from 'vitest';
import worker from '../worker/index';
const ctx={waitUntil(){}};
const assets={fetch:async()=>new Response('app')};

it('forwards /v1/* to studio-api with its method, headers and body, and returns its answer',async()=>{
 const seen:Request[]=[];
 const API={fetch:async(r:Request)=>{seen.push(r);return new Response(JSON.stringify({user:{email:'me@x'}}),{status:200,headers:{'content-type':'application/json','set-cookie':'studio_session=abc; Path=/; HttpOnly'}});}};
 const me=await worker.fetch(new Request('https://wall.test/v1/me',{headers:{cookie:'studio_session=abc'}}),{ASSETS:assets,API} as any,ctx);
 expect(me.status).toBe(200);
 expect(await me.json()).toEqual({user:{email:'me@x'}});
 expect(me.headers.get('set-cookie')).toContain('studio_session=abc');
 expect(seen[0].url).toBe('https://wall.test/v1/me');
 expect(seen[0].headers.get('cookie')).toBe('studio_session=abc');
 const body=JSON.stringify({ops:[]});
 await worker.fetch(new Request('https://wall.test/v1/sync/push',{method:'POST',body,headers:{'content-type':'application/json'}}),{ASSETS:assets,API} as any,ctx);
 expect(seen[1].method).toBe('POST');
 expect(await seen[1].text()).toBe(body);
});

it('answers 503 in the platform\'s error shape without the binding, or when studio-api is unreachable; other paths are unchanged',async()=>{
 const none=await worker.fetch(new Request('https://wall.test/v1/me'),{ASSETS:assets} as any,ctx);
 expect(none.status).toBe(503);
 expect((await none.json() as any).error.code).toBe('unavailable');
 const broken={fetch:async()=>{throw new Error('down');}};
 expect((await worker.fetch(new Request('https://wall.test/v1/me'),{ASSETS:assets,API:broken} as any,ctx)).status).toBe(503);
 // Only /v1/ goes to the studio: the app and the old sync API stay where they were.
 const API={fetch:async()=>{throw new Error('should not be called');}};
 expect(await (await worker.fetch(new Request('https://wall.test/'),{ASSETS:assets,API} as any,ctx)).text()).toBe('app');
 expect((await worker.fetch(new Request('https://wall.test/v1'),{ASSETS:assets,API} as any,ctx)).status).toBe(200);
 expect((await worker.fetch(new Request('https://wall.test/api/me'),{ASSETS:assets,API} as any,ctx)).status).toBe(503);
});
