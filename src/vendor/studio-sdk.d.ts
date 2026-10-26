// Types for the parts of studio-sdk.js (the platform SDK's ES-module build, generated: do not edit it) that
// src/studio.ts uses. Written by hand; the CI check compares only the .js with the platform's bundle:esm.
export class ApiError extends Error {status:number;code:string;details?:unknown;}
export class NetworkError extends Error {}
export type SyncChange={entityType:string;entityId:string;record:Record<string,any>};
export class ApiClient {
 constructor(opts:{baseUrl:string;fetch?:typeof fetch});
 request<T=any>(method:string,path:string,opts?:{json?:unknown;headers?:Record<string,string>}):Promise<T>;
 requestCode(email:string):Promise<unknown>;
 verify(email:string,code:string):Promise<any>;
 logout():Promise<unknown>;
 me():Promise<any>;
 pull(since:string,limit?:number):Promise<{changes:SyncChange[];cursor:string;hasMore:boolean}>;
}
export class Studio {
 static open(opts:{baseUrl:string;dbName?:string;fetch?:typeof fetch}):Promise<Studio>;
 api:ApiClient;
 store:{putFromServer(type:string,id:string,data:Record<string,any>|null):Promise<boolean>;close():void};
 get(type:string,id:string):Promise<Record<string,any>|undefined>;
 list(type:string):Promise<Record<string,any>[]>;
 pendingCount():Promise<number>;
 create(type:string,fields:Record<string,any>):Promise<Record<string,any>>;
 update(type:string,id:string,patch:Record<string,any>):Promise<Record<string,any>>;
 remove(type:string,id:string):Promise<void>;
 restore(type:string,record:Record<string,any>):Promise<Record<string,any>>;
 sync():Promise<void>;
 close():void;
 on(event:'change'|'status'|'conflict'|'rejected',fn:(payload:any)=>void):()=>void;
}
