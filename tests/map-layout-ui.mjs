// Isolated mobile browser: canvas size must not depend on overlay content.
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {chromium}=createRequire(import.meta.url)('playwright');
const out=new URL('../artifacts/map-layout/',import.meta.url);mkdirSync(out,{recursive:true});
const browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});
const errors=[];
try {
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await ctx.route('**/api/**',r=>r.abort());
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.CAMPUS_PREVIEW||'http://127.0.0.1:4173');
  await page.locator('[data-pick-group="14381"]').click();await page.locator('#save-group').click();
  await page.locator('[data-tab="map"]').click();
  const surface=page.locator('#map-surface'),sheet=page.locator('.map-sheet');
  await surface.waitFor();
  assert.equal(await sheet.isVisible(),false,'No empty bottom card');
  const before=await surface.boundingBox();assert.equal(before.height,844);
  await page.screenshot({path:new URL('territory.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.locator('.map-number[data-map-place="building:3"]').click();
  assert.equal((await surface.boundingBox()).height,before.height,'Selecting a building must not shrink the canvas');
  const title=await page.locator('.map-card-title').innerText();assert.match(title,/Корпус 3/);
  const position=await page.evaluate(()=>{
    const c=document.querySelector('.map-number.is-selected circle'),p=document.querySelector('#map-surface').createSVGPoint();
    p.x=c.cx.baseVal.value;p.y=c.cy.baseVal.value;const pt=p.matrixTransform(c.getScreenCTM());
    return {y:pt.y,top:document.querySelector('.map-header').getBoundingClientRect().bottom,bottom:document.querySelector('.map-sheet').getBoundingClientRect().top};
  });
  assert.ok(position.y>position.top&&position.y<position.bottom,'Selected marker stays in the visible window');
  await page.screenshot({path:new URL('selected.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.locator('[data-map-action="card-close"]').click();assert.equal(await sheet.isVisible(),false);
  for(const size of [{width:320,height:500},{width:844,height:390},{width:390,height:844}]) {
    await page.setViewportSize(size);await page.locator('[data-map-action="zoom-reset"]').click();
    assert.equal((await surface.boundingBox()).height,size.height);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.ok(await page.locator('[data-map-action="zoom-in"]').isVisible());
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize='24px';window.campusTheme.apply('green');});
  await page.locator('#map-search').fill('Корпус 6');await page.locator('.map-search-result').click();
  assert.equal((await surface.boundingBox()).height,844);
  await page.screenshot({path:new URL('green-large-text.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  assert.deepEqual(errors,[]);
  console.log('PASS: full-height canvas, optional overlays, visible selection, narrow/landscape layouts and large text');
} finally {await browser.close();}
