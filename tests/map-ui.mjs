// Run against tools/preview.py with Playwright installed. Only isolated browser contexts.
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.CAMPUS_PREVIEW||'http://127.0.0.1:4173';
const out=new URL('../artifacts/map-review/',import.meta.url);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const errors=[];
let currentPage;
async function context() {
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await ctx.route('**/api/**',r=>r.abort()); // No online source required.
  const page=await ctx.newPage();currentPage=page;page.on('pageerror',e=>errors.push(e.message));return {ctx,page};
}
const shot=async(page,name)=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return page.screenshot({path:new URL(name+'.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});};
try {
  const {ctx,page}=await context();
  await page.goto(base);
  await page.locator('[data-pick-group="14381"]').click();await page.locator('#save-group').click();
  await page.locator('[data-tab="map"]').click();await page.locator('#map-surface').waitFor();
  await shot(page,'01-territory');
  await page.locator('[data-map-action="building"][data-id="3"]').click();
  assert.match(await page.locator('.map-sheet').innerText(),/План корпуса пока не добавлен/);
  await page.locator('#map-search').fill('Аудитория 412');assert.equal(await page.locator('.map-search-result').count(),0);
  await shot(page,'02-no-plan-search');await page.locator('[data-map-action="search-close"]').click();
  await page.locator('[data-map-action="data-open"]').first().click();
  await page.locator('#map-import').setInputFiles(new URL('./fixtures/map-pilot.json',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
  assert.match(await page.locator('.map-error').innerText(),/Синтетический/);
  assert.equal(await page.evaluate(()=>localStorage.getItem('uust.campus.v1.maps')),null);
  await page.locator('[data-map-action="data-close"]').click();
  // Valid empty real-data envelope can be imported and survives reload; bad input is atomic.
  await page.locator('[data-map-action="data-open"]').first().click();
  const emptyPack=JSON.parse(readFileSync(new URL('../app/data/maps.json',import.meta.url),'utf8'));
  emptyPack.dataVersion='test-empty-import';
  await page.locator('#map-import').setInputFiles({name:'team-empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(emptyPack))});
  await page.locator('[data-map-action="import-apply"]').click();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('uust.campus.v1.maps')).dataVersion),'test-empty-import');
  await page.locator('#map-import').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
  await page.waitForFunction(()=>document.querySelector('.map-error')?.textContent.includes('Набор не изменён'));
  assert.match(await page.locator('.map-error').innerText(),/Набор не изменён/);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('uust.campus.v1.maps')).dataVersion),'test-empty-import');
  await page.reload();await page.locator('[data-tab="map"]').click();
  await page.locator('[data-map-action="data-open"]').first().click();assert.match(await page.locator('.map-data-meta').innerText(),/test-empty-import/);
  await page.locator('[data-map-action="data-close"]').click();
  await page.locator('[data-tab="home"]').click();await page.locator('[data-action="next-map"]').click();
  assert.match(await page.locator('.map-context').innerText(),/Точное помещение не сопоставлено/);
  await shot(page,'03-lesson-place');
  await page.locator('[data-tab="events"]').click();await page.locator('[data-event]').first().click();
  await page.locator('[data-action="event-map"]').click();assert.ok(await page.locator('.map-context').isVisible());
  // Input is safe at a keyboard-sized viewport; results remain scrollable.
  await page.setViewportSize({width:320,height:500});await page.locator('#map-search').fill('Корпус 3');
  assert.equal(await page.locator('.map-search-result').count(),1);
  await page.locator('.map-search-result').click();
  assert.ok(await page.locator('#map-surface').isVisible());
  const widths=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth]);assert.ok(widths[0]<=widths[1]);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>document.documentElement.style.fontSize='24px');
  await page.waitForFunction(()=>document.querySelector('[data-map-action="zoom-in"]').getBoundingClientRect().right<=innerWidth);
  await shot(page,'04-large-text');
  assert.ok(await page.locator('[data-map-action="data-open"]').first().isVisible());
  const surface=page.locator('#map-surface'),box=await surface.boundingBox(),cdp=await ctx.newCDPSession(page);
  const x=box.x+box.width/2,y=box.y+box.height/2,view=await surface.getAttribute('viewBox');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:x-20,y,id:1},{x:x+20,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-55,y,id:1},{x:x+55,y,id:2}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual(await surface.getAttribute('viewBox'),view);
  const zoomed=await surface.getAttribute('viewBox');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+35,y:y+25,id:1}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual(await surface.getAttribute('viewBox'),zoomed);
  await ctx.close();

  const demo=await context();
  await demo.ctx.route('**/map-harness.html',r=>r.fulfill({contentType:'text/html',body:readFileSync(new URL('./map-harness.html',import.meta.url),'utf8')}));
  await demo.ctx.route('**/test-fixture.json',r=>r.fulfill({contentType:'application/json',body:readFileSync(new URL('./fixtures/map-pilot.json',import.meta.url),'utf8')}));
  const p=demo.page;await p.goto(base+'/map-harness.html');
  await p.locator('#map-search').fill('412');assert.equal(await p.locator('.map-search-result').count(),2);
  await shot(p,'05-search-synthetic');
  await p.locator('#map-search').fill('3 корпус 412');assert.equal(await p.locator('.map-search-result').count(),1);
  await p.locator('.map-search-result').click();assert.match(await p.locator('.map-sheet').innerText(),/2 этаж/);
  await shot(p,'06-floor-synthetic');
  const before=await p.locator('#map-surface').getAttribute('viewBox');
  await p.locator('[data-map-action="zoom-in"]').click();assert.notEqual(await p.locator('#map-surface').getAttribute('viewBox'),before);
  await p.locator('[data-map-action="zoom-reset"]').click();
  await p.locator('[data-map-action="route-to"]').click();
  assert.equal(await p.locator('#map-route-start').inputValue(),'');assert.equal(await p.locator('.route-line polyline').count(),0);
  await p.locator('#map-route-start').selectOption('test-3-1-place-entry');
  assert.ok(await p.locator('.route-line polyline').count()>0);
  assert.match(await p.locator('.map-steps').innerText(),/Лестница А.*2 этаж/);
  await shot(p,'07-route-synthetic');
  await p.locator('[data-map-action="floor"][data-floor="test-3-f2"]').click();
  assert.equal(await p.locator('#map-route-start').inputValue(),'test-3-1-place-entry');
  assert.ok(await p.locator('.route-endpoint.end').isVisible());
  await shot(p,'08-route-destination-synthetic');
  await p.locator('.map-route-settings summary').click();await p.locator('#map-step-free').check();assert.equal(await p.locator('.route-line polyline').count(),0);
  assert.match(await p.locator('.map-sheet').innerText(),/Нет подтверждённого пути/);
  await shot(p,'09-no-route-synthetic');
  // Selecting another search result exits the old route and opens its own card.
  await p.locator('#map-search').fill('101А');await p.locator('.map-search-result').click();
  assert.match(await p.locator('.map-card-title').innerText(),/101А/);
  await p.locator('[data-map-action="route-from"]').click();
  await p.locator('#map-search').fill('3 корпус 412');await p.locator('.map-search-result').click();
  await p.locator('[data-map-action="route-to"]').click();
  assert.equal(await p.locator('#map-route-start').inputValue(),'test-3-1-place-room');
  await demo.ctx.close();
  assert.deepEqual(errors,[]);console.log('PASS: production campus, integrations, rejection of synthetic import, mobile sizes, search, floors and routes. Screenshots: artifacts/map-review');
} catch(error) {console.error('Browser errors:',errors);if(currentPage&&!currentPage.isClosed()){console.error(await currentPage.locator('body').innerText());await shot(currentPage,'failure');}throw error;}
finally {await browser.close();}
