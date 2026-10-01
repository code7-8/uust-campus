const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {spawn}=require('node:child_process');
let base,server;
const project=path.resolve(__dirname,'..');
async function startServer(){
 server=spawn(process.env.PYTHON||'python',['tools/test_student_life_server.py'],{cwd:project,stdio:['ignore','pipe','pipe']});
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Test server startup timed out')),15000);let output='';
 server.once('error',e=>{clearTimeout(timer);reject(e);});server.once('exit',code=>{clearTimeout(timer);reject(new Error('Test server exited: '+code));});
 server.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/READY (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
 });
}
const output=path.join(project,'artifacts/student-life-tests');fs.mkdirSync(output,{recursive:true});
const run=Date.now().toString(36);
async function api(route,method='GET',body,token){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
(async()=>{
 base=await startServer();
 const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
 const errors=[];
 try{
  const contexts=await Promise.all([1,2].map(()=>browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1})));
  // Fresh installs use the baked-in HTTPS address. Redirect only in this test
  // so registration and publication never touch the real community server.
  const defaultRequests=[];
  for(const context of contexts){
   await context.route('https://139.100.239.210.sslip.io/**',async route=>{
    defaultRequests.push(new URL(route.request().url()).pathname);
    const response=await route.fetch({url:base+new URL(route.request().url()).pathname});await route.fulfill({response});
   });
   await context.addInitScript(()=>localStorage.setItem('uust.campus.v1.profile',JSON.stringify({guest:true,group:null})));
  }
  const [author,guest]=await Promise.all(contexts.map(c=>c.newPage()));
  for(const p of [author,guest])p.on('pageerror',e=>errors.push(e.message));
  await author.goto(base);await author.locator('[data-tab="events"]').click();
  await author.locator('.club-card').first().waitFor();assert.equal(await author.locator('.club-card').count(),35);
  await author.screenshot({path:path.join(output,'clubs.png'),fullPage:true,animations:'disabled'});
  await author.locator('[data-action="club-detail"]').first().click();
  await author.getByRole('heading',{name:'Чем занимаются'}).waitFor();
  await contexts[0].route('https://vk.com/**',route=>route.fulfill({contentType:'text/html',body:'Community link test'}));
  const popupPromise=author.waitForEvent('popup');await author.locator('[data-link="vk"]').click();const popup=await popupPromise;await popup.waitForURL(/vk\.(com|ru)/,{waitUntil:'commit'}).catch(()=>{});assert.match(popup.url(),/vk\.(com|ru)/);await popup.close();
  await author.locator('[data-action="close"]').click();
  await author.locator('[data-action="life-section"][data-id="student"]').click();
  await author.locator('[data-community="create"]').first().click();
  await author.locator('[data-community="register"]').click();
  const register=author.locator('[data-community-form="register"]');
  await register.locator('[name="name"]').fill('Автор встречи');await register.locator('[name="username"]').fill('author'+run);await register.locator('[name="password"]').fill('meeting-test-pass');await register.locator('[type="submit"]').click();
  await author.locator('#community-dialog').waitFor({state:'hidden'});
  assert.equal(await author.evaluate(()=>localStorage.getItem('uust.campus.v1.serverUrl')),null,'No manual server entry on fresh install');
  assert.ok(defaultRequests.includes('/v1/auth/register'));
  await author.locator('[data-community="create"]').first().click();
  const form=author.locator('[data-community-form="event"]');
  await form.locator('[name="title"]').fill('Настолки '+run);await form.locator('[name="date"]').fill('2099-09-30');
  await form.locator('[name="place"]').fill('Корпус 6, аудитория 416');await form.locator('[name="buildingId"]').selectOption('6');await form.locator('[name="room"]').fill('416');
  await form.locator('[name="capacity"]').fill('1');await form.locator('[name="description"]').fill('Собираемся после пар. Приноси любимую игру.');
  assert.equal(await form.locator('select[name="kind"]').count(),0);
  await form.locator('[type="submit"]').click();await author.locator('#community-dialog').waitFor({state:'hidden'});
  const card=author.locator('.event-card').filter({hasText:'Настолки '+run});await card.waitFor();
  await card.locator('[data-event]').click();await author.locator('[data-community="edit"]').click();
  await author.locator('[name="title"]').fill('Вечер настолок '+run);await author.locator('[data-community-form="event"] [type="submit"]').click();await author.locator('#community-dialog').waitFor({state:'hidden'});
  const created=(await api('/v1/events')).events.find(e=>e.title==='Вечер настолок '+run);assert.ok(created);assert.equal(created.kind,'student');assert.ok(created.locationId);assert.ok(created.floorId);
  const member=await api('/v1/auth/register','POST',{username:'guest'+run,name:'Участник',password:'meeting-test-pass'});
  await guest.goto(base);await guest.locator('[data-tab="profile"]').click();await guest.locator('[data-community="login"]').click();
  await guest.locator('[name="username"]').fill('guest'+run);await guest.locator('[name="password"]').fill('meeting-test-pass');
  await guest.locator('[data-community-form="login"] [type="submit"]').click();await guest.locator('#community-dialog').waitFor({state:'hidden'});
  assert.ok(defaultRequests.includes('/v1/auth/login'));
  await guest.locator('[data-tab="events"]').click();await guest.locator('[data-id="student"][data-action="life-section"]').click();
  const guestCard=guest.locator('.event-card').filter({hasText:created.title});await guestCard.waitFor();await guestCard.locator('[data-event]').click();
  assert.equal(await guest.locator('#modal-root [data-community="edit"]').count(),0);
  await guest.locator('#modal-root [data-community="attend"]').click();
  await guest.locator('#modal-root').getByRole('button',{name:'Вы идёте · отменить',exact:true}).waitFor();
  assert.match(await guest.locator('#modal-root .attendance-count').textContent(),/1 человек/);
  await guest.screenshot({path:path.join(output,'meeting.png'),fullPage:true,animations:'disabled'});
  await author.locator('[data-community="refresh"]').click();
  await author.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Мест нет',exact:true}).waitFor();
  assert.equal(await author.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Мест нет',exact:true}).isDisabled(),true);
  await guest.locator('[data-action="event-map"]').click();
  await guest.locator('[data-map-action="search-close"]').click();
  await guest.locator('[data-map-action="route-endpoint"][data-endpoint="target"]').waitFor();assert.match(await guest.locator('[data-map-action="route-endpoint"][data-endpoint="target"]').innerText(),/416/);
  assert.match(await guest.locator('.map-module').innerText(),/416/);
  await guest.screenshot({path:path.join(output,'route.png'),fullPage:true,animations:'disabled'});
  await guest.locator('[data-tab="events"]').click();await guest.locator('.event-card').filter({hasText:created.title}).locator('[data-community="attend"]').click();
  await guest.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Я пойду',exact:true}).waitFor();
  assert.equal((await api('/v1/events')).events.find(e=>e.id===created.id).attendeeCount,0);
  await contexts[1].route('**/v1/events/*/attendance',route=>route.abort());
  await guest.locator('.event-card').filter({hasText:created.title}).locator('[data-community="attend"]').click();
  await guest.locator('#toast').filter({hasText:/fetch|связ|сеть|загруз/i}).waitFor();
  assert.equal((await api('/v1/events')).events.find(e=>e.id===created.id).attendeeCount,0);
  await contexts[1].unroute('**/v1/events/*/attendance');
  await guest.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Я пойду',exact:true}).click();
  await guest.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Вы идёте · отменить',exact:true}).waitFor();
  await guest.locator('[data-tab="profile"]').click();await guest.locator('[data-community="logout"]').click();
  await guest.locator('[data-tab="events"]').click();
  await guest.locator('.event-card').filter({hasText:created.title}).getByRole('button',{name:'Мест нет',exact:true}).waitFor();
  assert.equal(await guest.locator('[data-community="attend"][aria-pressed="true"]').count(),0);
  const admin=await api('/v1/auth/login','POST',{username:'testadmin',password:'test-admin-pass'});
  await api('/v1/events','POST',{title:'Официальная встреча '+run,description:'Тестовый анонс',category:'Университет',kind:'official',date:'2099-09-30',time:'15:00',endTime:'16:00',place:'Корпус 1',buildingId:'1',organizer:'УУНиТ'},admin.token);
  await author.locator('[data-community="refresh"]').click();await author.locator('[data-tab="home"]').click();
  assert.equal(await author.locator('.life-preview .club-card').count(),1);assert.equal(await author.locator('.life-preview .event-card').count(),2);
  await author.screenshot({path:path.join(output,'home.png'),fullPage:true,animations:'disabled'});
  await author.locator('[data-tab="events"]').click();await author.locator('.event-card').filter({hasText:created.title}).locator('[data-event]').click();await author.locator('[data-community="delete"]').click();await author.locator('[data-community-form="delete"] [type="submit"]').click();await author.locator('#community-dialog').waitFor({state:'hidden'});
  assert.equal((await api('/v1/events')).events.some(e=>e.id===created.id),false);
  await author.locator('[data-action="life-section"][data-id="clubs"]').click();await contexts[0].setOffline(true);await author.locator('[data-action="club-detail"]').first().click();await author.locator('#modal-root').getByRole('heading',{name:'Final Round',exact:true}).waitFor();
  // Browser offline mode also blocks HTTP images; APK assets are packaged locally.
  // The cached catalog itself must remain usable without the community server.
  assert.ok(await author.locator('#modal-root .club-activities li').count()>0);
  await contexts[0].setOffline(false);await author.locator('[data-action="close"]').click();
  await author.locator('[data-action="club-detail"]').first().click();
  await author.locator('#modal-root img').evaluate(img=>img.decode());
  await author.locator('[data-action="close"]').click();
  await contexts[0].clearPermissions();
  await author.locator('[data-tab="profile"]').click();await author.locator('[data-action="notifications"]').first().click();
  await author.locator('[data-notification="enabled"]').check();
  await author.locator('[data-action="notification-permission"]').waitFor();
  // Headless Chrome can report Notification.permission='denied' even when
  // navigator.permissions says 'granted'. Simulate the OS API for the granted
  // branch; this verifies the UI dispatch, not an actual desktop notification.
  await author.evaluate(()=>{
   window.notificationTests=[];
   window.Notification=class {static permission='granted';static async requestPermission(){return 'granted';}constructor(title,options){window.notificationTests.push({title,...options});}};
   window.campusNotificationChanged();
  });
  await author.locator('[data-action="notification-test"]').click();
  await author.locator('#toast').filter({hasText:'Тестовое уведомление отправлено'}).waitFor();
  assert.equal(await author.evaluate(()=>window.notificationTests.length),1);
  await author.locator('[data-notification="leadMinutes"]').selectOption('5');
  assert.equal(await author.evaluate(()=>JSON.parse(localStorage.getItem('uust.campus.v1.notifications')).leadMinutes),5);
  await author.locator('[data-notification="enabled"]').uncheck();await author.locator('[data-action="close"]').click();
  await author.locator('[data-tab="events"]').click();
  for(const width of [320,580]){await author.setViewportSize({width,height:844});assert.equal(await author.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await author.setViewportSize({width:390,height:844});await author.locator('[data-tab="profile"]').click();await author.locator('[data-theme-choice="green"]').click();await author.locator('[data-tab="events"]').click();await author.screenshot({path:path.join(output,'clubs-green.png'),fullPage:true,animations:'disabled'});
  assert.deepEqual(errors,[]);console.log('PASS: clubs, external links, student registration/create/edit/delete, shared capacity, attendance/withdrawal, exact room route, mixed home, offline clubs; no page errors');
 }finally{await browser.close();server?.kill();}
})().catch(e=>{console.error(e);server?.kill();process.exitCode=1;});
