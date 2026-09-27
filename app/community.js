import {storage} from './repository.js';
import {validateEvents, dateKey} from './core.js';

const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const roles={user:'Участник',organizer:'Организатор',admin:'Администратор'};
const localHosts=['localhost','127.0.0.1','10.0.2.2','192.168.137.1','192.168.31.245'];
const pending=new Map();
window.campusServerResult=(id,status,text)=>{const item=pending.get(id);if(item){clearTimeout(item.timer);pending.delete(id);item.resolve({status,text});}};

export function normalizeServer(value) {
  let url;try{url=new URL(String(value).trim());}catch{throw new Error('Введите адрес полностью, например http://192.168.137.1:8787');}
  if(url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error('Нужен адрес сервера без пути, пароля и параметров.');
  if(url.protocol!=='https:' && !(url.protocol==='http:' && localHosts.includes(url.hostname)))throw new Error('Для интернет-сервера нужен HTTPS. В точке доступа ноутбука используйте http://192.168.137.1:8787');
  return url.origin;
}

async function request(baseUrl,path,method='GET',body=null,token='') {
  if(!baseUrl)throw new Error('Сначала подключите сервер команды.');
  let response;
  if(window.CampusAndroid?.serverRequest){
    const id=crypto.randomUUID?.()||Date.now()+'-'+Math.random();
    response=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Сервер не ответил. Проверьте подключение к Wi-Fi.'));},26000);
      pending.set(id,{resolve,timer});
      try{window.CampusAndroid.serverRequest(JSON.stringify({id,baseUrl,path,method,body,token}));}
      catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
  }else{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
    try{
      const r=await fetch(baseUrl+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined,signal:controller.signal,cache:'no-store',credentials:'omit',redirect:'error'});
      response={status:r.status,text:await r.text()};
    }catch{throw new Error('Нет связи с сервером. Проверьте адрес и общую Wi-Fi сеть.');}
    finally{clearTimeout(timer);}
  }
  let data;try{data=JSON.parse(response.text);}catch{throw new Error('По этому адресу не найден сервер УУНиТ.');}
  if(response.status<200||response.status>=300){const error=new Error(data.error||'Сервер отклонил запрос.');error.status=response.status;throw error;}
  return data;
}

export function createCommunity({onEvents,onChange,toast,closeMainModal}) {
  const browserDefault=!window.CampusAndroid&&location.port==='8787'?location.origin:'';
  let base=storage.read('serverUrl',browserDefault),session=storage.read('account'),events=[],online=false,lastSync=null,busy=false,screen='',editing=null;
  if(session?.server!==base)session=null;
  const cached=storage.read('communityCache');
  if(cached?.server===base){try{events=validateEvents({schemaVersion:1,events:cached.events});lastSync=cached.at;}catch{}}
  let dialog=document.createElement('dialog');dialog.id='community-dialog';dialog.className='community-dialog';document.body.append(dialog);
  const api=(path,method='GET',body=null)=>request(base,path,method,body,session?.token||'');
  const canPublish=()=>['organizer','admin'].includes(session?.user?.role);
  const canEdit=event=>canPublish()&&(session.user.role==='admin'||event.authorId===session.user.id);
  const cbutton=(label,action,extra='',cls='button')=>`<button type="button" class="${cls}" data-community="${action}" ${extra}>${label}</button>`;
  const field=(name,label,type='text',value='',extra='')=>`<label class="account-field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  function frame(title,body){dialog.innerHTML=`<div class="community-dialog-head"><h2>${title}</h2>${cbutton('✕','close','aria-label="Закрыть"','icon-button')}</div>${body}<p id="community-error" class="form-message" role="status"></p>`;}
  function status(){return !base?'Общая афиша ещё не подключена':online?'Синхронизировано с командой':lastSync?'Нет связи · сохранённая афиша':'Сервер не подключён';}
  function accountCard(){
    return `<section class="account-card"><div class="account-heading"><span class="account-avatar">${esc((session?.user?.name||'Гость').slice(0,1).toUpperCase())}</span><div><h3>${esc(session?.user?.name||'Гостевой режим')}</h3><p>${session?roles[session.user.role]:'Карта, расписание и афиша без регистрации'}</p></div></div>${session?`<p class="subtle">@${esc(session.user.username)}${canPublish()?' · можно публиковать мероприятия':' · право публикации выдаёт администратор'}</p><div class="account-actions">${canPublish()?cbutton('Создать событие','create'):''}${session.user.role==='admin'?cbutton('Управление правами','admin','','button light'):''}${cbutton('Выйти','logout','','text-button')}</div>`:`<div class="account-actions">${cbutton('Войти','login')}${cbutton('Создать аккаунт','register','','button light')}</div>`}<div class="server-status"><span class="status-dot"></span><span>${esc(status())}</span></div>${cbutton('Сервер команды','server','','text-button')}</section>`;
  }
  function toolbar(){return `<div class="community-toolbar"><div><strong>Общая афиша</strong><p class="subtle">${esc(status())}</p></div>${canPublish()?cbutton('+ Событие','create','','button'):''}${cbutton(base?'Обновить':'Подключить',base?'refresh':'server','','button light')}</div>`;}
  function controls(event){return event.community?`<p class="source-line">Опубликовал(а): ${esc(event.authorName||'участник команды')}</p>${canEdit(event)?`<div class="account-actions">${cbutton('Редактировать','edit',`data-id="${esc(event.id)}"`,'button light')}${cbutton('Удалить','delete',`data-id="${esc(event.id)}"`,'text-button')}</div>`:''}`:'';}
  function open(kind,event=null){
    closeMainModal?.();screen=kind;editing=event;
    if(kind==='server')frame('Сервер команды',`<p class="subtle">Подключитесь к точке доступа ноутбука. Все участники используют один адрес.</p><form data-community-form="server">${field('server','Адрес сервера','url',base||'http://192.168.137.1:8787','required autocomplete="url" placeholder="http://192.168.137.1:8787"')}<button class="button wide" type="submit">Проверить и подключить</button></form><p class="account-help">При смене сервера нужно войти заново. Для подключения через интернет укажите HTTPS-адрес.</p>`);
    if(kind==='login'||kind==='register')frame(kind==='login'?'С возвращением':'Твой аккаунт',`<p class="subtle">${base?'Вход в сообщество кампуса.':'Сначала подключите сервер команды.'}</p>${base?`<form data-community-form="${kind}">${kind==='register'?field('name','Как тебя зовут','text','','required maxlength="80" autocomplete="name"'):''}${field('username','Логин','text','','required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none" spellcheck="false" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,31}"')}${field('password','Пароль','password','','required minlength="8" maxlength="128" autocomplete="'+(kind==='login'?'current-password':'new-password')+'"')}<button type="submit" class="button wide">${kind==='login'?'Войти':'Зарегистрироваться'}</button></form>${cbutton(kind==='login'?'Нет аккаунта? Создать':'Уже есть аккаунт? Войти',kind==='login'?'register':'login','','text-button')}`:cbutton('Подключить сервер','server','','button wide')}<p class="account-help">${kind==='register'?'После регистрации администратор может дать право создавать общие мероприятия.':'Смотреть карту и афишу можно без входа.'}</p>`);
    if(kind==='editor'){
      if(!canPublish()){open('login');return;}
      const e=event||{};
      frame(event?'Редактировать событие':'Новое событие',`<form data-community-form="event">${field('title','Название','text',e.title,'required maxlength="160"')}${field('category','Категория','text',e.category||'Встреча','required maxlength="40"')}<div class="form-grid">${field('date','Дата','date',e.date||dateKey(),'required')}${field('time','Начало · Уфа','time',e.time||'16:00','required')}${field('endTime','Окончание · Уфа','time',e.endTime||'17:00','required')}</div>${field('place','Место встречи','text',e.place,'required maxlength="240" placeholder="Корпус 6, аудитория 416"')}<label class="account-field">Корпус для карты<select name="buildingId"><option value="">Другая площадка / не указан</option>${Array.from({length:9},(_,i)=>`<option value="${i+1}" ${String(e.buildingId)===String(i+1)?'selected':''}>Корпус ${i+1}</option>`).join('')}</select></label><label class="account-field">Описание<textarea name="description" required maxlength="4000" rows="4">${esc(e.description||'')}</textarea></label><p class="account-help">После сохранения событие появится у всех, кто подключён к этому серверу, включая гостей.</p><button type="submit" class="button wide">${event?'Сохранить изменения':'Опубликовать для всех'}</button></form>`);
    }
    if(kind==='delete')frame('Удалить событие?',`<p>${esc(event.title)}</p><p class="subtle">Событие исчезнет из общей афиши после обновления.</p><form data-community-form="delete"><button type="submit" class="button wide">Удалить событие</button></form>`);
    if(kind==='admin'){frame('Участники и права','<p class="subtle">Загружаем участников…</p>');loadUsers();}
    if(!dialog.open)dialog.showModal();
  }
  async function loadUsers(){
    try{const data=await api('/v1/users');if(screen!=='admin')return;frame('Участники и права',`<p class="subtle">Организаторы могут публиковать события для всего кампуса. Новые аккаунты появляются здесь после регистрации.</p><div class="admin-users">${data.users.map(u=>`<article class="admin-user"><div><strong>${esc(u.name)}</strong><small>@${esc(u.username)} · ${roles[u.role]}</small></div>${u.role==='admin'?'<span class="chip">Администратор</span>':cbutton(u.role==='organizer'?'Отозвать право':'Разрешить события','role',`data-user="${esc(u.id)}" data-role="${u.role==='organizer'?'user':'organizer'}"`,'button light')}</article>`).join('')}</div>`);}catch(e){showError(e.message);}
  }
  function showError(message){const el=dialog.querySelector('#community-error');if(el)el.textContent=message;}
  function saveSession(value){session=value?{...value,server:base}:null;if(session)storage.write('account',session);else storage.remove('account');}
  async function sync({quiet=false}={}){
    if(!base||busy)return;busy=true;const source=base;
    try{
      const result=await request(source,'/v1/events');
      if(source!==base)return;
      events=validateEvents({schemaVersion:1,events:result.events});online=true;lastSync=result.updatedAt;
      storage.write('communityCache',{server:base,events,at:lastSync});
      if(session){try{const me=await api('/v1/auth/me');if(source===base)saveSession({...session,user:me.user});}catch(e){if(e.status===401)saveSession(null);}}
      onEvents(events);if(!quiet)toast('Общая афиша обновлена');
    }catch(e){if(source===base){online=false;if(!quiet)toast(e.message);}}
    finally{busy=false;onChange();}
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
        await api('/v1/events'+(editing?'/'+editing.id:''),editing?'PATCH':'POST',{...data,buildingId:data.buildingId||null});
        dialog.close();await sync({quiet:true});toast('Событие опубликовано в общей афише');return;
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
    if(action==='refresh'){await sync();return;}
    if(action==='logout'){const old=session;saveSession(null);onChange();toast('Вы вышли из аккаунта');if(old)request(base,'/v1/auth/logout','POST',{},old.token).catch(()=>{});return;}
    if(action==='role'){
      el.disabled=true;try{await api('/v1/users/'+el.dataset.user+'/role','PATCH',{role:el.dataset.role});await loadUsers();toast('Права обновлены');}catch(error){showError(error.message);el.disabled=false;}
    }
  });
  dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
  setInterval(()=>{if(document.visibilityState==='visible'&&!dialog.open)sync({quiet:true});},20000);
  return {accountCard,toolbar,controls,sync,events:()=>events,dialogOpen:()=>dialog.open,close(){if(dialog.open){dialog.close();return true;}return false;}};
}
