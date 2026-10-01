import {storage} from './repository.js';
import {validateEvents, dateKey, ufaTimestamp} from './core.js';

const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roles={user:'Участник',organizer:'Организатор',admin:'Администратор'};
const localHosts=['localhost','127.0.0.1','10.0.2.2','192.168.137.1','192.168.31.245'];
export const DEFAULT_SERVER_URL='https://139.100.239.210.sslip.io';
const pending=new Map();
window.campusServerResult=(id,status,text)=>{const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.resolve({status,text});}};

export function normalizeServer(value) {
  let url;try{url=new URL(String(value).trim());}catch{throw new Error('Введите полный адрес сервера, например https://campus.example.org');}
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Нужен адрес сервера без пути, пароля и параметров.');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && localHosts.includes(url.hostname)))throw new Error('Для интернет-сервера нужен HTTPS. В точке доступа ноутбука используйте http://192.168.137.1:8787');
  return url.origin;
}

export function initialServer(saved) {
  try {return typeof saved==='string'&&saved.trim()?normalizeServer(saved):DEFAULT_SERVER_URL;}
  catch {return DEFAULT_SERVER_URL;}
}

async function request(baseUrl,path,method='GET',body=null,token='') {
  if(!baseUrl)throw new Error('Сначала подключите сервер команды.');
  let response;
  if(window.CampusAndroid?.serverRequest){
    const id=crypto.randomUUID?.()||Date.now()+'-'+Math.random();
    response=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Сервер не ответил. Проверьте интернет и адрес сервера.'));},26000);
      pending.set(id,{resolve,timer});
      try{window.CampusAndroid.serverRequest(JSON.stringify({id,baseUrl,path,method,body,token}));}
      catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
  }else{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const r=await fetch(baseUrl+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
      response={status:r.status,text:await r.text()};
    }catch{throw new Error('Нет связи с сервером. Проверьте интернет и адрес сервера.');}
    finally{clearTimeout(timer);}
  }
  let data;try{data=JSON.parse(response.text);}catch{throw new Error('По этому адресу не найден сервер УУНиТ.');}
  if(response.status<200||response.status>=300){const error=new Error(data.error||'Сервер отклонил запрос.');error.status=response.status;throw error;}
  return data;
}

export function createCommunity({onEvents,onChange,onPublished,toast,closeMainModal,mapData}) {
  let base=initialServer(storage.read('serverUrl')),session=storage.read('account'),events=[],online=false,lastSync=null,busy=null,screen='',editing=null;
  if(session?.server!==base)session=null;
  const cached=storage.read('communityCache');
  if(cached?.server===base){try{events=validateEvents({schemaVersion:1,events:cached.events});lastSync=cached.at;events=events.map(e=>({...e,viewerGoing:cached.viewerId===session?.user?.id&&e.viewerGoing}));}catch{}}
  let dialog=document.createElement('dialog');dialog.id='community-dialog';dialog.className='community-dialog';document.body.append(dialog);
  const api=(path,method='GET',body=null)=>request(base,path,method,body,session?.token||'');
  const canPublish=()=>!!session;
  const canOfficial=()=>['organizer','admin'].includes(session?.user?.role);
  const joining=new Set();
  const canEdit=event=>canPublish()&&(event.kind!=='official'||canOfficial())&&(session.user.role==='admin'||event.authorId===session.user.id);
  const cbutton=(label,action,extra='',cls='button')=>`<button type="button" class="${cls}" data-community="${action}" ${extra}>${label}</button>`;
  const field=(name,label,type='text',value='',extra='')=>`<label class="account-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function frame(title,body){dialog.innerHTML=`<div class="community-dialog-head"><h2>${title}</h2>${cbutton('✕','close','aria-label="Закрыть"','icon-button')}</div>${body}<p id="community-error" class="form-message" role="status"></p>`;}
  function status(){return !base?'Общая афиша ещё не подключена':online?'Синхронизировано с командой':lastSync?'Нет связи · сохранённая афиша':'Сервер не подключён';}
  function accountCard(){
    return `<section class="account-card"><div class="account-heading"><span class="account-avatar">${esc((session?.user?.name||'Гость').slice(0,1).toUpperCase())}</span><div><h3>${esc(session?.user?.name||'Гостевой режим')}</h3><p>${session?roles[session.user.role]:'Карта, расписание и афиша без регистрации'}</p></div></div>${session?`<p class="subtle">@${esc(session.user.username)}${canPublish()?' · можно создавать встречи':' · право публикации выдаёт администратор'}</p><div class="account-actions">${canPublish()?cbutton('Создать событие','create'):''}${session.user.role==='admin'?cbutton('Управление правами','admin','','button light'):''}${cbutton('Выйти','logout','','text-button')}</div>`:`<div class="account-actions">${cbutton('Войти','login')}${cbutton('Создать аккаунт','register','','button light')}</div>`}<div class="server-status"><span class="status-dot"></span><span>${esc(status())}</span></div>${cbutton('Сервер команды','server','','text-button')}</section>`;
  }
  function attendance(event){
    if(!event.community)return '';
    const ended=ufaTimestamp(event.date,event.endTime||'23:59')<=Date.now(),full=event.capacity!==null&&event.attendeeCount>=event.capacity;
    const label=joining.has(event.id)?'Сохраняем…':event.viewerGoing?'Вы идёте · отменить':ended?'Событие завершено':full?'Мест нет':'Я пойду';
    return `<div class="attendance"><span class="attendance-count">${event.attendeeCount} ${peopleWord(event.attendeeCount)} ${event.attendeeCount%10===1&&event.attendeeCount%100!==11?'идёт':'идут'}${event.capacity!==null?` · ${event.capacity} ${placesWord(event.capacity)}`:''}</span>${cbutton(label,'attend',`data-id="${esc(event.id)}" aria-pressed="${event.viewerGoing}" ${joining.has(event.id)||!event.viewerGoing&&(ended||full)?'disabled':''}`,`button ${event.viewerGoing?'light':''}`)}</div>`;
  }
  function peopleWord(n){return n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'человека':'человек';}
  function placesWord(n){return n%10===1&&n%100!==11?'место':n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)?'места':'мест';}
  function toolbar(){return `<div class="community-toolbar"><div><strong>Общая афиша</strong><p class="subtle">${esc(status())}</p></div>${cbutton('+ Создать встречу','create','','button')}${cbutton(base?'Обновить':'Подключить',base?'refresh':'server','','button light')}</div>`;}
  function controls(event){return event.community?`<p class="source-line">Опубликовал(а): ${esc(event.authorName||'участник команды')}</p>${canEdit(event)?`<div class="account-actions">${cbutton('Редактировать','edit',`data-id="${esc(event.id)}"`,'button light')}${cbutton('Удалить','delete',`data-id="${esc(event.id)}"`,'text-button')}</div>`:''}`:'';}
  function open(kind,event=null){
    closeMainModal?.();screen=kind;editing=event;
    if(kind==='server')frame('Сервер команды',`<p class="subtle">Введите общий HTTPS-адрес. Все участники используют один сервер и могут подключаться через мобильный интернет или любой Wi-Fi.</p><form data-community-form="server">${field('server','Адрес сервера','url',base,'required autocomplete="url" placeholder="https://campus.example.org"')}<button class="button wide" type="submit">Проверить и подключить</button></form><p class="account-help">Адрес выдаёт администратор команды. Укажите только https:// и имя сервера, без /v1. При смене сервера нужно войти заново.</p>`);
    if(kind==='login'||kind==='register')frame(kind==='login'?'Вход':'Регистрация',`<p class="subtle">${base?'Вход в сообщество кампуса.':'Сначала подключите сервер команды.'}</p>${base?`<form data-community-form="${kind}">${kind==='register'?field('name','Имя','text','','required maxlength="80" autocomplete="name"'):''}${field('username','Логин','text','','required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,31}"')}${field('password','Пароль','password','','required minlength="8" maxlength="128" autocomplete="'+(kind==='login'?'current-password':'new-password')+'"')}<button type="submit" class="button wide">${kind==='login'?'Войти':'Зарегистрироваться'}</button></form>${cbutton(kind==='login'?'Нет аккаунта? Создать':'Уже есть аккаунт? Войти',kind==='login'?'register':'login','','text-button')}`:cbutton('Подключить сервер','server','','button wide')}<p class="account-help">${kind==='register'?'После регистрации можно создавать свои встречи и записываться на события.':'Смотреть карту и афишу можно без входа.'}</p>`);
    if(kind==='editor'){
      if(!canPublish()){open('login');return;}
      const e=event||{};
      frame(event?'Редактировать событие':'Новое событие',`<form data-community-form="event">${canOfficial()?`<label class="account-field">Кто организует<select name="kind"><option value="student" ${e.kind!=='official'?'selected':''}>От студента</option><option value="official" ${e.kind==='official'?'selected':''}>УУНиТ ✓ · от организатора</option></select></label>`:'<input type="hidden" name="kind" value="student">'}${field('title','Название','text',e.title,'required maxlength="160"')}${field('category','Категория','text',e.category||'Встреча','required maxlength="40"')}<div class="form-grid">${field('date','Дата','date',e.date||dateKey(),'required')}${field('time','Начало · Уфа','time',e.time||'16:00','required')}${field('endTime','Окончание · Уфа','time',e.endTime||'17:00','required')}</div>${field('organizer','Организатор','text',e.organizer||session.user.name,'required maxlength="160"')}${field('capacity','Количество мест · можно оставить пустым','number',e.capacity??'','min="1" max="10000" step="1" placeholder="Без ограничения"')}${field('place','Место встречи','text',e.place,'required maxlength="240" placeholder="Корпус 6, аудитория 416"')}<label class="account-field">Корпус для карты<select name="buildingId"><option value="">Другая площадка / не указан</option>${Array.from({length:9},(_,i)=>`<option value="${i+1}" ${String(e.buildingId)===String(i+1)?'selected':''}>Корпус ${i+1}</option>`).join('')}</select></label>${field('room','Аудитория · если есть','text',e.room,'maxlength="80" placeholder="Например, 416" list="event-rooms"')}<datalist id="event-rooms"></datalist><label class="account-field">Этаж<select name="floorId"><option value="">Не указан / не нанесён на карту</option></select></label><p class="account-help">Если аудитории ещё нет на схеме, маршрут приведёт к корпусу. Место встречи останется в карточке.</p><label class="account-field">Описание<textarea name="description" required maxlength="4000" rows="4">${esc(e.description||'')}</textarea></label><p class="account-help">После сохранения событие появится у всех, кто подключён к этому серверу, включая гостей.</p><button type="submit" class="button wide">${event?'Сохранить изменения':'Опубликовать для всех'}</button></form>`);
    }
    if(kind==='editor')updatePlaces(event?.floorId||'');
    if(kind==='delete')frame('Удалить событие?',`<p>${esc(event.title)}</p><p class="subtle">Событие исчезнет из общей афиши после обновления.</p><form data-community-form="delete"><button type="submit" class="button wide">Удалить событие</button></form>`);
    if(kind==='admin'){frame('Участники и права','<p class="subtle">Загружаем участников…</p>');loadUsers();}
    if(!dialog.open)dialog.showModal();
  }
  function updatePlaces(selected=''){
    const form=dialog.querySelector('[data-community-form="event"]');if(!form)return;
    const building=form.elements.buildingId.value;
    form.querySelector('#event-rooms').innerHTML=mapData.locations.filter(l=>l.type==='room'&&l.buildingId===building).map(l=>`<option value="${esc(l.number)}">${esc(l.name)}</option>`).join('');
    form.elements.floorId.innerHTML='<option value="">Не указан / не нанесён на карту</option>'+mapData.floors.filter(f=>f.buildingId===building).map(f=>`<option value="${esc(f.id)}" ${selected===f.id?'selected':''}>${esc(f.name)}</option>`).join('');
  }
  dialog.addEventListener('change',e=>{if(e.target.name==='buildingId')updatePlaces();});
  async function loadUsers(){
    try{const data=await api('/v1/users');if(screen!=='admin')return;frame('Участники и права',`<p class="subtle">Любой участник создаёт свои встречи. Организаторы дополнительно публикуют события с отметкой УУНиТ. Новые аккаунты появляются здесь после регистрации.</p><div class="admin-users">${data.users.map(u=>`<article class="admin-user"><div><strong>${esc(u.name)}</strong><small>@${esc(u.username)} · ${roles[u.role]}</small></div>${u.role==='admin'?'<span class="chip">Администратор</span>':cbutton(u.role==='organizer'?'Отозвать право':'Разрешить от УУНиТ','role',`data-user="${esc(u.id)}" data-role="${u.role==='organizer'?'user':'organizer'}"`,'button light')}</article>`).join('')}</div>`);}catch(e){showError(e.message);}
  }
  function showError(message){const el=dialog.querySelector('#community-error');if(el)el.textContent=message;}
  function saveSession(value){session=value?{...value,server:base}:null;if(session)storage.write('account',session);else{storage.remove('account');events=events.map(e=>({...e,viewerGoing:false}));onEvents(events);}}
  async function sync({quiet=false}={}){
    if(!base)return;while(busy)await busy;
    const source=base;let viewerToken=session?.token||'',finish;busy=new Promise(resolve=>{finish=resolve;});
    try{
      let result;try{result=await request(source,'/v1/events','GET',null,viewerToken);}catch(e){if(e.status!==401)throw e;if(session?.token!==viewerToken)return;saveSession(null);viewerToken='';result=await request(source,'/v1/events');}
      if(source!==base||(session?.token||'')!==viewerToken)return;
      events=validateEvents({schemaVersion:1,events:result.events});online=true;lastSync=result.updatedAt;
      storage.write('communityCache',{server:base,viewerId:session?.user?.id,events,at:lastSync});
      if(viewerToken){try{const me=await request(source,'/v1/auth/me','GET',null,viewerToken);if(source===base&&session?.token===viewerToken)saveSession({...session,user:me.user});}catch(e){if(e.status===401&&session?.token===viewerToken)saveSession(null);}}
      onEvents(events);if(!quiet)toast('Общая афиша обновлена');
    }catch(e){if(source===base){online=false;if(!quiet)toast(e.message);}}
    finally{busy=null;finish();onChange();}
  }
  dialog.addEventListener('submit',async e=>{
    const form=e.target.closest('[data-community-form]');if(!form)return;e.preventDefault();
    const submit=form.querySelector('[type="submit"]');if(submit.disabled)return;submit.disabled=true;showError('');
    const data=Object.fromEntries(new FormData(form));
    try{
      const kind=form.dataset.communityForm;
      if(kind==='server'){
        const candidate=normalizeServer(data.server),health=await request(candidate,'/v1/health');
        if(health.service!=='UUST Campus')throw new Error('Это не сервер UUST Campus.');
        if(candidate!==base){base=candidate;saveSession(null);events=[];storage.remove('communityCache');onEvents([]);}
        storage.write('serverUrl',base);dialog.close();await sync();return;
      }
      if(kind==='login'||kind==='register'){
        saveSession(await api('/v1/auth/'+kind,'POST',data));dialog.close();toast('Вы вошли как '+session.user.name);await sync({quiet:true});return;
      }
      if(kind==='event'){
        const candidates=mapData.locations.filter(l=>l.type==='room'&&l.buildingId===data.buildingId&&l.number?.toLowerCase()===data.room.trim().toLowerCase()&&(!data.floorId||l.floorId===data.floorId));
        const place=candidates.length===1?candidates[0]:null;
        await api('/v1/events'+(editing?'/'+editing.id:''),editing?'PATCH':'POST',{...data,capacity:data.capacity===''?null:Number(data.capacity),buildingId:data.buildingId||null,locationId:place?.id||'',floorId:place?.floorId||data.floorId||''});
        dialog.close();await sync({quiet:true});onPublished?.(data.kind);toast('Событие опубликовано в общей афише');return;
      }
      if(kind==='delete'){await api('/v1/events/'+editing.id,'DELETE');dialog.close();await sync({quiet:true});toast('Событие удалено');}
    }catch(error){showError(error.message);}finally{if(submit.isConnected)submit.disabled=false;onChange();}
  });
  document.addEventListener('click',async e=>{
    const el=e.target.closest('[data-community]');if(!el)return;
    const action=el.dataset.community;
    if(action==='close'){dialog.close();return;}
    if(['server','login','register','admin'].includes(action)){open(action);return;}
    if(action==='create'){open('editor');return;}
    if(action==='edit'||action==='delete'){const event=events.find(x=>x.id===el.dataset.id);if(event)open(action==='edit'?'editor':'delete',event);return;}
    if(action==='attend'){
      const event=events.find(x=>x.id===el.dataset.id);if(!event||joining.has(event.id))return;
      if(!session){open('login');return;}
      joining.add(event.id);el.disabled=true;
      try{const result=await api('/v1/events/'+event.id+'/attendance',event.viewerGoing?'DELETE':'POST');
        const updated=validateEvents({schemaVersion:1,events:[result.event]})[0];events=events.map(e=>e.id===updated.id?updated:e);
        onEvents(events);toast(updated.viewerGoing?'Вы записались. Место встречи — в карточке.':'Участие отменено');
      }catch(error){if(error.status===401){saveSession(null);open('login');}toast(error.message);}
      finally{joining.delete(event.id);el.disabled=false;onChange();await sync({quiet:true});}return;
    }
    if(action==='refresh'){await sync();return;}
    if(action==='logout'){const old=session;saveSession(null);events=events.map(e=>({...e,viewerGoing:false}));onEvents(events);onChange();toast('Вы вышли из аккаунта');if(old)request(base,'/v1/auth/logout','POST',{},old.token).catch(()=>{});return;}
    if(action==='role'){
      el.disabled=true;try{await api('/v1/users/'+el.dataset.user+'/role','PATCH',{role:el.dataset.role});await loadUsers();toast('Права обновлены');}catch(error){showError(error.message);el.disabled=false;}
    }
  });
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  setInterval(()=>{if(document.visibilityState==='visible'&&!dialog.open)sync({quiet:true});},20000);
  return {accountCard,toolbar,controls,attendance,sync,events:()=>events,dialogOpen:()=>dialog.open,close(){if(dialog.open){dialog.close();return true;}return false;}};
}
