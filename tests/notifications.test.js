import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReminders,createNotifications} from '../app/notifications.js';
import {ufaTimestamp} from '../app/core.js';

const start=ufaTimestamp('2026-10-01','12:00');
const event={id:'meeting',title:'Встреча',date:'2026-10-01',time:'12:00',place:'Кампус',viewerGoing:true};
const settings={enabled:true,leadMinutes:15};
const input={events:[event]};
function environment(t,{native,permission='granted'}={}){
  const previous={window:globalThis.window,Notification:globalThis.Notification,setInterval:globalThis.setInterval,now:Date.now};
  const state={now:start-20*60000,sent:[],errors:[],timers:[],store:new Map([['notifications',settings]])};
  const storage={read:(key,fallback)=>state.store.has(key)?state.store.get(key):fallback,write:(key,value)=>{state.store.set(key,value);return true;}};
  class Notification {
    static permission=permission;
    static async requestPermission(){this.permission='granted';}
    constructor(title,options){state.sent.push({title,...options});}
  }
  globalThis.Notification=Notification;globalThis.window={Notification,CampusAndroid:native};
  globalThis.setInterval=fn=>{state.timers.push(fn);return 1;};Date.now=()=>state.now;
  t.after(()=>{Date.now=previous.now;globalThis.setInterval=previous.setInterval;globalThis.window=previous.window;globalThis.Notification=previous.Notification;});
  state.create=()=>createNotifications({storage,onOpen:()=>{},onError:message=>state.errors.push(message)});
  return state;
}

test('late alarms remain eligible until the event starts, including joining within the lead window',()=>{
  for(const now of [start-15*60000,start-60000]){
    const queue=buildReminders({...input,settings,now});assert.equal(queue.length,1);assert.equal(queue[0].at,start-15*60000);
  }
  assert.equal(buildReminders({...input,settings,now:start}).length,0);
  assert.equal(buildReminders({...input,settings:{...settings,quiet:true,quietStart:'11:00',quietEnd:'13:00'},now:start-60000}).length,0);
});

test('native refresh retains a due alarm instead of cancelling it before Android delivery',t=>{
  const queues=[];const env=environment(t,{native:{syncReminders:text=>queues.push(JSON.parse(text)),notificationStatus:()=>'{"enabled":true,"exact":false}'}});
  const controller=env.create();controller.sync(input);assert.equal(queues[0].length,1);
  env.now=start-14*60000;controller.sync(input);assert.equal(queues.length,1,'A feed refresh must not replace the due queue with []');
  controller.save({...settings,leadMinutes:10});controller.sync(input);assert.equal(queues.at(-1)[0].at,start-10*60000);
  controller.save({enabled:false});controller.sync(input);assert.deepEqual(queues.at(-1),[]);
});

test('browser delivers once across refresh/reload, permits rescheduled events, and cancels removed events',t=>{
  const env=environment(t);let controller=env.create();controller.sync(input);
  env.now=start-14*60000;controller.sync(input);assert.equal(env.sent.length,1);
  controller.sync(input);env.timers.forEach(fn=>fn());assert.equal(env.sent.length,1);
  controller=env.create();controller.sync(input);assert.equal(env.sent.length,1,'Delivery survives recreation');
  controller.sync({events:[{...event,time:'12:01'}]});assert.equal(env.sent.length,2,'Changed occurrence may notify again');
  env.now=start-20*60000;const pending=env.create();pending.sync({events:[{...event,id:'cancelled'}]});
  env.now=start-14*60000;pending.sync({events:[]});assert.equal(env.sent.length,2,'Do not deliver the old queue before applying cancellation');
});

test('permission denial, diagnostic notification and native bridge retry are visible and recoverable',async t=>{
  const env=environment(t,{permission:'denied'}),controller=env.create();env.now=start-60000;controller.sync(input);
  assert.equal(env.sent.length,0);assert.throws(()=>controller.test(),/разрешите/);
  await controller.request();controller.sync(input);assert.equal(env.sent.length,1);controller.test();assert.equal(env.sent.length,2);
  let calls=0;globalThis.window.CampusAndroid={syncReminders:()=>{if(++calls===1)throw Error('Bridge failure');},notificationStatus:()=>'{"enabled":true}',testNotification:()=>env.sent.push('native-test')};
  const native=env.create();native.sync(input);assert.equal(env.errors.length,1);native.sync(input);assert.equal(calls,2);native.test();assert.equal(env.sent.at(-1),'native-test');
});
