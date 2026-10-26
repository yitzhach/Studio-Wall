// Whether this browser is signed in to the studio, and whether this device syncs through it, read without loading
// anything else. main.ts asks at start; only a sign-in (or opening Studio account) loads src/studio.ts and the SDK,
// so a signed-out Studio Wall runs exactly as before and never calls /v1 (docs/backend-and-ai-plan.md, stage 3).
export const SESSION_KEY='studio-wall-studio';
/** `on`: when this device switched to studio sync (ISO time), else null: old sync (/api/sync) runs, as it always did. */
export type Session={email:string;studioId:string|null;on:string|null;expired?:boolean};
export function readSession():Session|null{try{const s=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');return s&&typeof s.email==='string'?s:null;}catch{return null;}}
export function writeSession(s:Session|null){try{if(s)localStorage.setItem(SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SESSION_KEY);}catch{}}
/** Studio sync replaces old sync on this device only while signed in with it switched on. */
export const studioSyncOn=()=>!!readSession()?.on;
