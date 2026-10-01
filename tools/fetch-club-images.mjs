// Download official gallery images into the APK. Never overwrite existing art.
// node tools/fetch-club-images.mjs [club-id ...]
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const catalog=new URL('../app/data/clubs.json',import.meta.url);
const data=JSON.parse(await readFile(catalog,'utf8')),ids=new Set(process.argv.slice(2));
let added=0,failed=0;
async function download(url){
  const parsed=new URL(url);
  if(parsed.origin!=='https://uust.ru')throw Error('Only the official HTTPS source is allowed');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response;
}
for(const club of data.clubs.filter(c=>!c.image&&(!ids.size||ids.has(c.id)))){
  try{
    let source=club.imageSource;
    if(!source){
      const html=await (await download(club.source)).text();
      const path=html.match(/\/media\/pages\/subdivisionpage\/[^\s"'<>]*photo_(?:scene|event)_\d+\.(?:jpe?g|png|webp)/i)?.[0];
      if(!path){console.log(club.id+': no official gallery image');continue;}
      source=new URL(path,club.source).href;
    }
    const response=await download(source);
    if(!response.headers.get('content-type')?.startsWith('image/'))throw Error('Response is not an image');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>8*1024*1024)throw Error('Image exceeds 8 MiB');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    const ext=bytes[0]===255&&bytes[1]===216?'jpg':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'?'webp':null;
    if(!ext)throw Error('Unrecognized image format');
    if(!/^[a-z0-9-]+$/.test(club.id))throw Error('Invalid club ID');
    const image='assets/clubs/'+club.id+'.'+ext,target=new URL('../app/'+image,import.meta.url);
    await mkdir(new URL('../app/assets/clubs/',import.meta.url),{recursive:true});
    await writeFile(target,bytes,{flag:'wx'});
    Object.assign(club,{image,imageAlt:'Фотография объединения «'+club.name+'» со страницы УУНиТ',imageSource:source});
    data.updatedAt=new Date().toISOString().slice(0,10);
    await writeFile(catalog,JSON.stringify(data,null,2)+'\n');added++;console.log(club.id+': '+image);
  }catch(error){failed++;console.error(club.id+': '+error.message);}
}
console.log(`Added ${added}; failed ${failed}. Existing images and missing-image covers preserved.`);
if(failed)process.exitCode=1;
