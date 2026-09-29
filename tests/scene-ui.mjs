// Run with Playwright installed: node tests/scene-ui.mjs (isolated local browser).
import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const root=fileURLToPath(new URL('../app/',import.meta.url));
const out=fileURLToPath(new URL('../artifacts/scene-review/',import.meta.url));
await mkdir(out,{recursive:true});
const harness=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/map/map.css"><link rel="stylesheet" href="/theme-purple.css">
<style>body{height:100dvh}#map-root{height:100%;max-width:580px;margin:auto}</style><div id="map-root"></div>
<script type="module">
import {createMapController} from '/map/view.js';
const [pack,{buildings}]=await Promise.all([fetch('/data/maps.json').then(r=>r.json()),fetch('/data/buildings.json').then(r=>r.json())]);
window.map=createMapController({buildings,bundledPack:pack,storage:{read(){return null},write(){return true}},external(){},onFavorite(){},isFavorite(){return false}});
map.mount(document.querySelector('#map-root'));
</script></html>`;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(harness);return;}
  const path=resolve(root,'.'+decodeURIComponent(pathname));
  if(!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(403).end();return;}
  try {
    const content=await readFile(path),extension=path.split('.').at(-1);
    res.setHeader('Content-Type',({js:'text/javascript',css:'text/css',json:'application/json',png:'image/png',jpg:'image/jpeg'})[extension]||'application/octet-stream');
    res.end(content);
  }catch{res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const errors=[];
try {
  browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.map);
  // Compare against the real SVG building bounds, including every side wing.
  const geometry=await page.evaluate(async()=>{
    const {createSceneLayout}=await import('/map/scene.js');
    const [pack,{buildings}]=await Promise.all([fetch('/data/maps.json').then(r=>r.json()),fetch('/data/buildings.json').then(r=>r.json())]);
    const layout=createSceneLayout(buildings,pack.floors),problems=[];
    for(const f of pack.floors){
      const p=layout.plans.get(f.id),path=document.querySelector('path[data-campus-building="'+f.buildingId+'"]');
      const b=path.getBBox(),expected=.92*Math.min(b.height/f.viewBox[2],b.width/f.viewBox[3]);
      if(Math.abs(p.scale-expected)>1e-8)problems.push(f.id+' changed size relative to the building');
      if(Math.abs(p.box[2]/p.box[3]-f.viewBox[2]/f.viewBox[3])>1e-8)problems.push(f.id+' changed proportions');
      const frame=layout.frames.get(f.buildingId);
      if(p.box[0]<frame[0]||p.box[1]<frame[1]||p.box[0]+p.box[2]>frame[0]+frame[2]||p.box[1]+p.box[3]>frame[1]+frame[3])problems.push(f.id+' leaves the building frame');
    }
    return {problems,count:layout.plans.size};
  });
  assert.deepEqual(geometry,{problems:[],count:10});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const measure=floorId=>page.evaluate(id=>{
    const layer=document.querySelector('[data-scene-floor="'+id+'"]'),plan=layer.getScreenCTM();
    const building=document.querySelector('path[data-campus-building="'+layer.dataset.sceneBuilding+'"]');
    const body=building.getScreenCTM();
    return {ratio:Math.hypot(plan.a,plan.b)/Math.hypot(body.a,body.b),sx:Math.hypot(plan.a,plan.b),sy:Math.hypot(plan.c,plan.d),transform:layer.getAttribute('transform')};
  },floorId);
  let checks=0;
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390}]){
    for(const [buildingId,floorId] of [['6','cw-6-f4'],['7','sv-7-f4']]){
      await page.setViewportSize({width:390,height:844});
      await page.evaluate(id=>map.open({buildingId:id}),buildingId);
      await page.locator('[data-map-action="floor"][data-floor="'+floorId+'"]').click();await settle();
      await page.setViewportSize(viewport);await settle();
      const before=await measure(floorId);assert.ok(Math.abs(before.sx-before.sy)<1e-8);
      await page.locator('[data-map-action="zoom-in"]').click();await settle();
      const after=await measure(floorId);
      assert.ok(after.sx>before.sx);assert.ok(Math.abs(before.ratio-after.ratio)<1e-8);
      assert.equal(before.transform,after.transform);
      await page.locator('[data-map-action="zoom-out"]').click();await settle();
      if(viewport.width===390)await page.screenshot({path:resolve(out,'building-'+buildingId+'.png')});
      checks++;
    }
  }
  // A source image uses exactly the same plan transform as the vectors.
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>map.open({buildingId:'6'}));
  await page.locator('[data-map-action="floor"][data-floor="cw-6-f4"]').click();
  const vector=await measure('cw-6-f4');
  await page.locator('[data-map-action="source-plan"]').click();
  assert.equal((await measure('cw-6-f4')).transform,vector.transform);
  assert.equal(await page.locator('.floor-source-image').count(),1);
  assert.deepEqual(errors,[]);
  console.log(`OK: 10 floors retain building-relative sizes and proportions; ${checks} viewport/zoom checks; source overlay; no browser errors`);
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
