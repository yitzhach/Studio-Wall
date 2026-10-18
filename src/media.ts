export const IMAGE_MAX_EDGE=2400;
export const IMAGE_WEBP_QUALITY=.82;

/** File types the picker and drag/drop accept. Extensions cover browsers that report HEIC/TIFF with an empty MIME type. */
export const IMAGE_ACCEPT='image/*,.heic,.heif,.avif,.tif,.tiff,.bmp,.gif,.webp';
export const isImageFile=(f:File)=>f.type.startsWith('image/')||/\.(heic|heif|avif|tiff?|bmp|gif|webp|jpe?g|png)$/i.test(f.name);

/** Identify formats by their bytes, since file names and MIME types are often missing or wrong. */
export async function sniffFormat(blob:Blob):Promise<'heic'|'tiff'|null>{
 const b=new Uint8Array(await blob.slice(0,16).arrayBuffer()),ascii=(f:number,t:number)=>String.fromCharCode(...b.slice(f,t));
 if(ascii(4,8)==='ftyp'&&['heic','heix','hevc','heim','heis','hevm','hevs','mif1','msf1'].includes(ascii(8,12)))return 'heic';
 if((b[0]===0x49&&b[1]===0x49&&b[2]===0x2a&&b[3]===0)||(b[0]===0x4d&&b[1]===0x4d&&b[2]===0&&b[3]===0x2a))return 'tiff';
 return null;
}
async function nativeDecode(blob:Blob){const url=URL.createObjectURL(blob);try{const img=new Image();img.src=url;await img.decode();return {img,url};}catch(e){URL.revokeObjectURL(url);throw e;}}
// Converters load only when a browser can't open the file itself (e.g. HEIC in Chrome/Firefox, TIFF outside Safari).
async function convertHeic(blob:Blob){const {default:heic2any}=await import('heic2any');const out=await heic2any({blob,toType:'image/jpeg',quality:.92});return Array.isArray(out)?out[0]:out;}
async function convertTiff(blob:Blob){const UTIF=(await import('utif')).default;const buf=await blob.arrayBuffer();const ifds=UTIF.decode(buf);UTIF.decodeImage(buf,ifds[0]);const rgba=UTIF.toRGBA8(ifds[0]),w=ifds[0].width,h=ifds[0].height;
 const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');if(!ctx)throw Error('Image processing is not available on this device.');ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer,rgba.byteOffset,w*h*4),w,h),0,0);return canvasBlob(c,'image/png');}
async function decodedImage(blob:Blob){
 try{return await nativeDecode(blob);}catch{}
 const format=await sniffFormat(blob);
 try{if(format==='heic')return await nativeDecode(await convertHeic(blob));if(format==='tiff')return await nativeDecode(await convertTiff(blob));}catch{}
 throw Error('This image could not be opened. Supported: JPEG, PNG, WebP, HEIC/HEIF, AVIF, GIF, BMP and TIFF.');
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
