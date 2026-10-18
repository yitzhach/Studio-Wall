// Client view of a shared board (/s/<token>). Talks only to /api/s/<token>/…; the server decides what is visible.
import './style.css';
import {openGallery} from './viewer';
import type {Pin} from './data';
type SharedPin={id:string;file_ref:string|null;meta:{kind:'image'|'idea'|'link';title:string};source_credit:string;is_own:boolean;source_url:string;note:string;palette:string[]};
type Comment={id:string;pin_id:string|null;text:string;author:string;created_at:string};
type Shared={board:{name:string;description:string};permission:'view'|'comment';expires_at:string|null;pins:SharedPin[];comments:Comment[];starred:string[]};
const root=document.querySelector<HTMLElement>('#share')!;
const token=location.pathname.split('/')[2]||'';
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const store={get:(k:string)=>{try{return localStorage.getItem(k);}catch{return null;}},set:(k:string,v:string)=>{try{localStorage.setItem(k,v);}catch{}}};
// An anonymous per-browser id lets a client toggle their own stars; it is not an account and grants nothing by itself.
const guest=store.get('studio-wall-guest')||(()=>{const g=crypto.randomUUID().replace(/-/g,'');store.set('studio-wall-guest',g);return g;})();
document.documentElement.dataset.theme=store.get('studio-wall-theme')||'dark';
const api=async(path:string,init:RequestInit={})=>{const r=await fetch(`/api/s/${token}${path}`,{...init,headers:{'x-guest-id':guest,...(init.body?{'content-type':'application/json'}:{}),...init.headers}});const body=await r.json().catch(()=>({}));if(!r.ok)throw Error(body.error||'Something went wrong. Please try again.');return body;};
const src=(p:SharedPin)=>p.file_ref?`/api/s/${token}/files/${p.file_ref}`:null;
let data:Shared,about:string|null=null;

function card(p:SharedPin){const img=src(p),stars=data.starred.includes(p.id),count=data.comments.filter(c=>c.pin_id===p.id).length,can=data.permission==='comment';
 return `<div class="pin-wrap"><button class="pin ${img?'':'text-pin'}" data-open="${p.id}">${img?`<img src="${img}" alt="${esc(p.meta.title||'Reference')}" loading="lazy" draggable="false">`:`<div class="idea-content"><p>${esc(p.note||p.meta.title||p.source_url)}</p></div>`}<div class="caption"><strong>${stars?'★ ':''}${esc(p.meta.title||(p.meta.kind==='idea'?'A thought':'Untitled reference'))}</strong><span>${esc(p.is_own?'Artist’s own work':p.source_credit||'')}${count?` · ${count} comment${count===1?'':'s'}`:''}</span></div></button>
 ${p.source_url?`<a class="share-source" href="${esc(p.source_url)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`:''}${can?`<div class="share-actions"><button data-star="${p.id}" aria-pressed="${stars}" aria-label="${stars?'Remove star':'Star this'}">${stars?'★ Starred':'☆ Star'}</button><button data-about="${p.id}">Comment</button></div>`:''}</div>`;}

function render(){
 const can=data.permission==='comment',name=store.get('studio-wall-guest-name')||'',aboutPin=data.pins.find(p=>p.id===about);
 document.title=`${data.board.name} · Studio Wall`;
 root.innerHTML=`<header class="share-head"><div class="eyebrow">A BOARD SHARED WITH YOU</div><h1>${esc(data.board.name)}</h1>${data.board.description?`<p class="intro">${esc(data.board.description)}</p>`:''}<p class="share-meta">${data.pins.length} reference${data.pins.length===1?'':'s'} · ${can?'Tap ☆ to star favourites and leave comments for the artist':'View only'}${data.expires_at?` · link open until ${new Date(data.expires_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}`:''}</p><button class="secondary" id="theme-toggle" aria-label="Toggle light or dark">${document.documentElement.dataset.theme==='dark'?'Light':'Dark'} mode</button></header>
 <section class="masonry">${data.pins.map(card).join('')||'<p class="hint">This board is empty for now.</p>'}</section>
 <section class="feedback share-feedback"><div class="eyebrow">CONVERSATION</div>${data.comments.map(c=>`<article><strong>${esc(c.author)}${c.pin_id?` <small>on ${esc(data.pins.find(p=>p.id===c.pin_id)?.meta.title||'an image')}</small>`:''}</strong><p>${esc(c.text)}</p></article>`).join('')||'<p class="hint">No comments yet.</p>'}
 ${can?`<form id="comment-form">${aboutPin?`<p class="share-about">Commenting on <strong>${esc(aboutPin.meta.title||'this image')}</strong> <button type="button" id="clear-about">Comment on the whole board instead</button></p>`:''}<label>Your name<input name="name" maxlength="60" value="${esc(name)}" placeholder="So the artist knows who wrote"></label><label>Comment<textarea name="text" rows="3" maxlength="2000" required placeholder="What do you love, or what would you change?"></textarea></label><p class="error" role="alert"></p><button class="primary">Send to artist</button></form>`:''}</section>`;
 bind();
}
function bind(){
 root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b=>b.onclick=()=>{const p=data.pins.find(x=>x.id===b.dataset.open)!;if(src(p))openGallery(data.pins as unknown as Pin[],x=>src(x as unknown as SharedPin),p.id);});
 root.querySelector<HTMLButtonElement>('#theme-toggle')!.onclick=()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;store.set('studio-wall-theme',t);render();};
 root.querySelectorAll<HTMLButtonElement>('[data-star]').forEach(b=>b.onclick=async()=>{const id=b.dataset.star!,on=!data.starred.includes(id);b.disabled=true;
  try{await api('/feedback',{method:'POST',body:JSON.stringify({pin_id:id,starred:on,name:store.get('studio-wall-guest-name')||''})});data.starred=on?[...data.starred,id]:data.starred.filter(x=>x!==id);render();}catch(e){alert((e as Error).message);b.disabled=false;}});
 root.querySelectorAll<HTMLButtonElement>('[data-about]').forEach(b=>b.onclick=()=>{about=b.dataset.about!;render();root.querySelector<HTMLTextAreaElement>('[name=text]')?.focus();});
 root.querySelector('#clear-about')?.addEventListener('click',()=>{about=null;render();});
 const form=root.querySelector<HTMLFormElement>('#comment-form');
 if(form)form.onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(form)) as Record<string,string>;const btn=form.querySelector('button.primary') as HTMLButtonElement;btn.disabled=true;store.set('studio-wall-guest-name',v.name.trim());
  try{const {comment}=await api('/feedback',{method:'POST',body:JSON.stringify({pin_id:about,text:v.text,name:v.name})});data.comments.push(comment);about=null;render();}
  catch(err){form.querySelector('.error')!.textContent=(err as Error).message;btn.disabled=false;}};
}
async function load(){try{data=await api('');render();}catch(e){root.innerHTML=`<header class="share-head"><div class="eyebrow">STUDIO WALL</div><h1>This link isn’t available</h1><p class="intro">${esc((e as Error).message)} Ask the artist for a new link.</p></header>`;}}
load();
