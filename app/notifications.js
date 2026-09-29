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
    if(Number.isFinite(at)&&at>now&&!quietAt(at,settings))items.push({id,title,body,at,start,tab,date});
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
  let delivered=new Set(storage.read('notificationDelivered',[]));
  function status(){
    if(nativeSupported){try{return {...JSON.parse(native.notificationStatus()),native:true};}catch{return {native:true,enabled:false};}}
    return {native:false,supported:'Notification' in window,enabled:'Notification' in window&&Notification.permission==='granted',permission:'Notification' in window?Notification.permission:'unsupported'};
  }
  function sync(input){
    tick();
    items=buildReminders({...input,settings});
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
      if(item.at>now||item.start<=now||delivered.has(item.id))continue;
      try{const n=new Notification(item.title,{body:item.body,tag:item.id});n.onclick=()=>{window.focus();onOpen(item);n.close();};delivered.add(item.id);}catch{}
    }
    if(delivered.size>5000)delivered=new Set([...delivered].slice(-2500));
    storage.write('notificationDelivered',[...delivered]);
  }
  setInterval(tick,15000);
  return {get:()=>({...settings}),items:()=>items,status,sync,save,request,
    systemSettings:()=>nativeSupported&&native.openNotificationSettings(),
    exactSettings:()=>nativeSupported&&native.requestExactReminders()};
}
