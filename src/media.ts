export const IMAGE_MAX_EDGE=2400;
export const IMAGE_WEBP_QUALITY=.82;

async function decodedImage(blob:Blob){
 const url=URL.createObjectURL(blob);
 try{const img=new Image();img.src=url;await img.decode();return {img,url};}
 catch{URL.revokeObjectURL(url);throw Error('This image format could not be opened on this device. Try JPEG, PNG or WebP. HEIC/HEIF works when the browser can decode it.');}
}
function canvasBlob(canvas:HTMLCanvasElement,type:string,quality?:number){return new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Could not optimize this image.')),type,quality));}

/** Browser-side ingest policy. The future backend should enforce the same 2400px/WebP policy server-side. */
export async function optimizeImage(blob:Blob,maxEdge=IMAGE_MAX_EDGE,quality=IMAGE_WEBP_QUALITY):Promise<Blob>{
 const {img,url}=await decodedImage(blob);try{
  const scale=Math.min(1,maxEdge/Math.max(img.naturalWidth,img.naturalHeight));
  const width=Math.max(1,Math.round(img.naturalWidth*scale)),height=Math.max(1,Math.round(img.naturalHeight*scale));
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d');if(!ctx)throw Error('Image processing is not available on this device.');
  ctx.drawImage(img,0,0,width,height);
  return await canvasBlob(c,'image/webp',quality);
 }finally{URL.revokeObjectURL(url);}
}
export async function palette(blob:Blob):Promise<string[]>{
 const {img,url}=await decodedImage(blob);try{const c=document.createElement('canvas');c.width=c.height=60;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0,60,60);const d=ctx.getImageData(0,0,60,60).data;const buckets=new Map<string,number>();for(let i=0;i<d.length;i+=4){if(d[i+3]<128)continue;const hex='#'+[d[i],d[i+1],d[i+2]].map(v=>Math.min(255,Math.round(v/40)*40).toString(16).padStart(2,'0')).join('');buckets.set(hex,(buckets.get(hex)||0)+1);}return [...buckets].sort((a,b)=>b[1]-a[1]).slice(0,5).map(x=>x[0]);}finally{URL.revokeObjectURL(url);}
}
