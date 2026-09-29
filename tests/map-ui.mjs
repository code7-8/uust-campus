// Isolated real-browser regression tests; no production data or accounts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('..',import.meta.url));
const output=new URL('../artifacts/map-review/',import.meta.url);mkdirSync(output,{recursive:true});
let fixture,browser,page;
async function start(){
  if(process.env.CAMPUS_PREVIEW)return process.env.CAMPUS_PREVIEW;
  fixture=spawn(process.env.PYTHON||'python',['tools/test_student_life_server.py'],{cwd:project,stdio:['ignore','pipe','pipe']});
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Fixture startup timeout')),15000);let text='';
    fixture.on('error',e=>{clearTimeout(timer);reject(e);});
    fixture.on('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited: '+code));});
    fixture.stdout.on('data',data=>{text+=data;const match=text.match(/READY (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
  });
}
const frames=(count=3)=>page.evaluate(n=>new Promise(resolve=>{function tick(){if(--n<=0)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);}),count);
const shot=name=>page.screenshot({path:fileURLToPath(new URL(name+'.png',output)),fullPage:true,animations:'disabled'});
async function search(query,id,endpoint=false){
  await page.locator('#map-search').fill(query);
  await page.locator('['+(endpoint?'data-map-endpoint-pick':'data-map-pick')+'="'+id+'"]').click();await frames();
}
try{
  const base=await start();browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await context.route('**/api/**',route=>route.abort());
  await context.addInitScript(()=>localStorage.setItem('uust.campus.v1.profile',JSON.stringify({guest:true,group:null})));
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('[data-tab="map"]').click();await frames();await shot('01-campus');
  await search('Корпус 3','building:3');assert.match(await page.locator('.map-sheet').innerText(),/План корпуса пока не добавлен/);
  await page.locator('[data-map-action="data-open"]').first().click();
  await page.locator('#map-import').setInputFiles(fileURLToPath(new URL('./fixtures/map-pilot.json',import.meta.url)));
  await page.waitForFunction(()=>document.querySelector('.map-error')?.textContent.includes('Синтетический'));
  assert.equal(await page.evaluate(()=>localStorage.getItem('uust.campus.v1.maps')),null);
  const imported=JSON.parse(readFileSync(new URL('../app/data/maps.json',import.meta.url),'utf8'));imported.dataVersion='browser-import-check';
  await page.locator('#map-import').setInputFiles({name:'campus.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(imported))});
  await page.locator('[data-map-action="import-apply"]').click();
  await page.locator('#map-import').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await page.waitForFunction(()=>document.querySelector('.map-error')?.textContent.includes('Набор не изменён'));
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('uust.campus.v1.maps')).dataVersion),'browser-import-check');
  await page.reload();await page.locator('[data-tab="map"]').click();await page.locator('[data-map-action="data-open"]').first().click();
  assert.match(await page.locator('.map-data-meta').innerText(),/browser-import-check/);
  await page.locator('[data-map-action="import-reset"]').click();
  await page.locator('[data-map-action="data-close"]').click();
  await search('Корпус 6','building:6');
  for(const id of ['sv-6-f1','sv-6-f2','cw-6-f3','cw-6-f4','cw-6-f5']){
    await page.locator('[data-map-action="floor"][data-floor="'+id+'"]').click();await frames();
    assert.equal(await page.locator('[data-scene-floor="'+id+'"]').getAttribute('aria-hidden'),'false');
    if(id==='cw-6-f4'){
      assert.equal(await page.locator('[data-scene-floor="sv-6-f4-annex"]').getAttribute('aria-hidden'),'false');
      assert.equal(await page.locator('[data-map-action="floor"]').count(),5);
      await shot('02-floor-4-and-annex');
      await page.locator('[data-map-action="source-plan"]').click();await frames();
      assert.ok(await page.locator('[data-scene-floor="cw-6-f4"] .floor-source-image').count()>0);
      await page.locator('[data-map-action="source-plan"]').click();
    }
  }
  await page.locator('[data-map-action="floor"][data-floor="sv-6-f1"]').click();await frames();await shot('03-building-6');
  assert.equal(await page.locator('[data-map-place="sv-6-f1-underground"]').count(),1);
  const surface=page.locator('#map-surface');
  // Pan repeatedly through 6 -> gap -> 7. Cards may switch, the camera must settle.
  const encountered=new Set();
  for(let i=0;i<18;i++){
    await surface.press('ArrowUp');await frames();
    const before=await surface.getAttribute('viewBox'),label=await page.locator('.map-level-row').innerText();
    encountered.add(label);await frames(12);
    assert.equal(await surface.getAttribute('viewBox'),before,'Camera moved without input');
    assert.equal(await page.locator('.map-level-row').innerText(),label,'Floor selector oscillated at a building boundary');
  }
  assert.ok([...encountered].some(s=>s.includes('Корпус 7')),'Panning reaches building 7');
  await search('Корпус 7','building:7');
  for(const id of ['sv-7-f1','sv-7-f2','sv-7-f3','sv-7-f4']){
    await page.locator('[data-map-action="floor"][data-floor="'+id+'"]').click();await frames();
    assert.equal(await page.locator('[data-scene-floor="'+id+'"]').getAttribute('aria-hidden'),'false');
  }
  await shot('04-building-7');
  await page.locator('[data-map-action="route-open"]').click();
  await page.locator('[data-map-action="route-endpoint"][data-endpoint="start"]').click();await search('6-101','sv-6-101',true);
  await page.locator('[data-map-action="route-endpoint"][data-endpoint="target"]').click();await search('7-407','sv-7-407',true);
  await page.locator('[data-map-action="route-build"]').click();await frames();
  const sections=page.locator('.route-sections [data-map-action="route-section"]');assert.ok(await sections.count()>=6);
  assert.match(await page.locator('.route-transition').innerText(),/подземный переход/i);
  assert.ok(await page.locator('.route-line polyline').count()>0);
  await sections.last().click();await frames();assert.match(await page.locator('.route-section-heading').innerText(),/Корпус 7.*4 этаж/);
  await shot('05-route');
  await page.locator('[data-map-action="route-edit"]').click();await page.locator('#map-route-mode').selectOption('outdoor');
  await page.locator('[data-map-action="route-build"]').click();await frames();assert.ok(await sections.count()>=6);
  await page.locator('[data-map-action="route-close"]').click();
  await search('6-401а','sv-6-401a');assert.equal(await page.locator('[data-scene-floor="cw-6-f4"]').count(),1);assert.equal(await page.locator('[data-scene-floor="sv-6-f4-annex"]').count(),1);
  for(const viewport of [{width:320,height:500},{width:844,height:390},{width:390,height:844}]){
    await page.setViewportSize(viewport);await frames();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const before=await surface.getAttribute('viewBox');await page.locator('[data-map-action="zoom-in"]').click();assert.notEqual(await surface.getAttribute('viewBox'),before);
  }
  // Semester and notification settings remain usable alongside the map changes.
  await page.locator('[data-tab="profile"]').click();await page.locator('[data-action="notifications"]').first().click();
  assert.ok(await page.locator('[data-notification="enabled"]').isVisible());await page.locator('[data-action="close"]').click();
  assert.deepEqual(errors,[]);console.log('PASS: floor placement, combined 4/4.5, both building routes, passage stairs, stable camera, source overlay, import validation, mobile layouts');
}catch(error){if(page)await shot('failure').catch(()=>{});throw error;}
finally{await browser?.close();fixture?.kill();}
