import {addDays,dateKey,clock,lessonsOn,timeMinutes,ufaTimestamp,minuteOfDay} from './core.js';

export const notificationDefaults={enabled:false,lessons:true,events:true,leadMinutes:15,quiet:false,quietStart:'22:00',quietEnd:'08:00'};
export function notificationSettings(value={}) {
  value=value&&typeof value==='object'?value:{};
  const out={...notificationDefaults};
  for(const key of ['enabled','lessons','events','quiet'])if(typeof value[key]==='boolean')out[key]=value[key];
  if([5,10,15,30,60].includes(value.leadMinutes))out.leadMinutes=value.leadMinutes;
  for(const key of ['quietStart','quietEnd'])if(timeMinutes(value[key])!==null)out[key]=clock(timeMinutes(value[key]));
  return out;
}
export function quietAt(timestamp,settings) {
  if(!settings.quiet)return false;
  const minute=minuteOfDay(new Date(timestamp)),start=timeMinutes(settings.quietStart),end=timeMinutes(settings.quietEnd);
  return start===end?false:start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
export function buildReminders({rows=[],events=[],favorites=[],group=null,config,settings,now=Date.now()}) {
  settings=notificationSettings(settings);
  if(!settings.enabled)return [];
  const items=[];
  const add=(id,title,body,start,tab,date)=>{
    const at=start-settings.leadMinutes*60000;
    // Keep due reminders until the event starts: an inexact Android alarm may
    // still be waiting when a feed refresh rebuilds this queue.
    if(Number.isFinite(at)&&start>now&&!quietAt(at,settings))items.push({id,title,body,at,start,tab,date});
  };
  if(settings.lessons&&group&&config){
    let date=dateKey(new Date(now));if(date<config.academicStart)date=config.academicStart;
    for(let days=0;date<=config.academicEnd&&days<370;date=addDays(date,1),days++){
      for(const lesson of lessonsOn(rows,date,config))if(lesson.start!==null){
        add(`lesson:${group.id}:${date}:${lesson.id}`,lesson.subject,
          `${clock(lesson.start)} · ${group.title} · ${lesson.room||'Аудитория уточняется'}`,ufaTimestamp(date,clock(lesson.start)),'schedule',date);
      }
    }
  }
  if(settings.events)for(const event of events){
    if((favorites.includes(event.id)||event.viewerGoing)&&event.time)
      add(`event:${event.id}:${event.date}`,event.title,`${event.time} · ${event.place||'Место уточняется'}`,ufaTimestamp(event.date,event.time),'events',event.date);
  }
  return [...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id)).slice(0,5000);
}

export function createNotifications({storage,onOpen,onError=()=>{}}) {
  let settings=notificationSettings(storage.read('notifications')),items=[],signature='';
  const native=window.CampusAndroid;
  const nativeSupported=typeof native?.syncReminders==='function';
  const savedDelivered=storage.read('notificationDelivered',[]);
  let delivered=new Set(Array.isArray(savedDelivered)?savedDelivered:[]);
  function status(){
    if(nativeSupported){try{return {...JSON.parse(native.notificationStatus()),native:true};}catch{return {native:true,enabled:false};}}
    return {native:false,supported:'Notification' in window,enabled:'Notification' in window&&Notification.permission==='granted',permission:'Notification' in window?Notification.permission:'unsupported'};
  }
  function sync(input){
    items=buildReminders({...input,settings});
    tick();
    const next=JSON.stringify(items);
    if(next===signature)return;
    if(nativeSupported){try{native.syncReminders(next);}catch{onError('Не удалось сохранить напоминания Android');return;}}
    signature=next;
  }
  function save(value){const next=notificationSettings(value);if(!storage.write('notifications',next))return false;settings=next;signature='';return true;}
  async function request(){
    if(nativeSupported){native.requestNotifications();return;}
    if('Notification' in window)await Notification.requestPermission();
  }
  function tick(){
    if(nativeSupported||!settings.enabled||!status().enabled)return;
    const now=Date.now();
    for(const item of items){
      const key=item.id+':'+item.start;
      if(item.at>now||item.start<=now||delivered.has(key))continue;
      try{const n=new Notification(item.title,{body:item.body,tag:item.id});n.onclick=()=>{window.focus();onOpen(item);n.close();};delivered.add(key);}catch{onError('Не удалось показать уведомление. Проверьте разрешения браузера.');}
    }
    if(delivered.size>5000)delivered=new Set([...delivered].slice(-2500));
    storage.write('notificationDelivered',[...delivered]);
  }
  setInterval(tick,15000);
  function test(){
    if(!status().enabled)throw new Error('Сначала разрешите уведомления в настройках устройства.');
    if(nativeSupported){
      if(typeof native.testNotification!=='function')throw new Error('Для проверки обновите Android-приложение.');
      native.testNotification();
    }else new Notification('Кампус · проверка',{body:'Уведомления разрешены. Напоминания о парах и событиях появятся здесь.',tag:'campus-test'});
  }
  return {get:()=>({...settings}),items:()=>items,status,sync,save,request,test,
    systemSettings:()=>nativeSupported&&native.openNotificationSettings(),
    exactSettings:()=>nativeSupported&&native.requestExactReminders()};
}
