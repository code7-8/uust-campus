import {TIME_ZONE,dateKey,minuteOfDay,addDays,monday,academicWeek,formatDate,clock,lessonsOn,nextLesson,freeGaps,eventCompatibility,searchGroups,validateEvents,ufaTimestamp} from './core.js';
import {initialData,loadSavedSchedule,refreshSchedule,refreshGroups,storage} from './repository.js';
import {icon} from './icons.js';
import {createMapController} from './map/view.js';
import {createCommunity} from './community.js';
import {createMapData} from './map/data.js';
import {clubCard,clubDetail,kindBadge,eventKind,eventEnded,campusPreview} from './student-life.js';
import {semesterWeeks,normalizeSearch,validDate} from './core.js';
import {createNotifications} from './notifications.js';

const $ = s=>document.querySelector(s);
const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrs = escape;
const shortDays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const state={tab:'home',profile:storage.read('profile'),data:null,rows:[],loaded:false,source:null,at:null,error:null,busy:false,
  date:dateKey(),scheduleView:'day',eventFilter:'all',lifeSection:'clubs',clubQuery:'',clubCategory:'all',
  favorites:storage.read('favorites',[]),savedPlaces:storage.read('places',[]),modal:null,groupQuery:'ТОП-106Б',selectedGroup:null,request:0};
let toastTimer,returnFocus,mapController,community,notifications;
function toast(text) {clearTimeout(toastTimer);const el=$('#toast');el.textContent=text;el.classList.add('visible');toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
const btn=(text,action,cls='button',more='')=>`<button class="${cls}" data-action="${action}" ${more}>${text}</button>`;
const iconBtn=(name,label,action,more='')=>btn(icon(name),action,'icon-button',`aria-label="${attrs(label)}" ${more}`);
function external(url) {if(!/^https:\/\//.test(url))return; if(window.CampusAndroid)window.CampusAndroid.openExternal(url);else window.open(url,'_blank','noopener,noreferrer');}
function group() {return state.profile?.group;}
function currentLessons(date=state.date) {return lessonsOn(state.rows,date,state.data.config);}
function tag(type) {const cls=/Лекц/.test(type)?'lecture':/Лаб/.test(type)?'lab':'practice';return `<span class="chip ${cls}">${escape(type?.replace(' (семинар)','')||'Занятие')}</span>`;}
const brandIcon=()=>'<span class="brand-symbol brand-image"><img class="brand-purple" src="assets/uust-logo.png" alt="УУНиТ"><img class="brand-green" src="assets/uust-logo-green.png" alt="УУНиТ"></span>';
const wordmark=()=>`<div class="wordmark">${brandIcon()}<span><strong>Кампус</strong><small>УУНИТ · УФА</small></span></div>`;
function topbar(){return `<header class="topbar">${wordmark()}${iconBtn('bell','Уведомления и настройки','notifications')}${btn(`${icon('user')} ${escape(group()?.title||'Выбрать группу')} ${icon('chevron')}`,'groups','group-chip','aria-label="Изменить учебную группу"')}</header>`;}
function nav(){return `<nav class="bottom-nav" aria-label="Основная навигация">${[['home','home','Сегодня'],['schedule','calendar','Расписание'],['map','map','Карта'],['events','spark','Жизнь'],['profile','user','Профиль']].map(([id,ico,label])=>`<button class="nav-item ${state.tab===id?'active':''}" data-tab="${id}" ${state.tab===id?'aria-current="page"':''}><span class="nav-icon">${icon(ico)}</span>${label}</button>`).join('')}</nav>`;}
function statusLine(){
  const stamp=state.at?new Intl.DateTimeFormat('ru-RU',{timeZone:TIME_ZONE,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(state.at)):null;
  let text=state.loaded?`${state.source==='bundled'?'Снимок':'Обновлено'} ${stamp}`:'Расписание ещё не сохранено';
  if(state.busy)text+=' · обновляем';
  if(state.error)text=state.loaded?`Нет обновления · данные от ${stamp}`:'Не удалось связаться с источником';
  const stale=state.at && Date.now()-Date.parse(state.at)>86400000;
  if(stale && !state.error)text+=' · проверьте актуальность';
  return `<div class="status-line ${state.error||stale?'warning':''}"><span class="status-dot"></span><span>${escape(text)}</span>${btn(icon('refresh',state.busy?'motion-spin':'')+(state.busy?'':' Обновить'),'refresh','text-button',state.busy?'disabled':'')}</div>`;
}
function pageHeading(kicker,title,subtitle=''){return `<div class="page-heading">${kicker?`<div class="eyebrow">${kicker}</div>`:''}<h1>${title}</h1>${subtitle?`<p class="subtle">${subtitle}</p>`:''}</div>`;}
function section(title,action,label='Все'){return `<div class="section-heading"><h2>${title}</h2>${action?btn(label+' '+icon('arrow'),action,'text-button'):''}</div>`;}
function empty(title,description,ico='sun',action='',label=''){return `<div class="empty-state">${icon(ico)}<h3>${title}</h3><p>${description}</p>${action?btn(label,action,'button light'):''}</div>`;}
function lessonList(lessons,date,limit=99){
  if(!lessons.length)return '';
  const gaps=freeGaps(lessons);
  return `<div class="lesson-list">${lessons.slice(0,limit).map((l,i)=>{
    const gap=i>0?gaps.find(g=>g.end===l.start):null;
    return `${gap?`<div class="gap-row">${icon('coffee')} Окно ${gap.minutes} мин · до ${clock(gap.end)}</div>`:''}<div class="lesson-row"><div class="lesson-time">${l.start===null?'—':clock(l.start)}<span>${l.end===null?'уточняется':clock(l.end)}</span></div><button class="lesson-card" data-lesson="${attrs(l.id)}" data-date="${date}">${tag(l.type)}<h3>${escape(l.subject)}</h3><p>${escape(l.teacherShort||l.teacher||'Преподаватель не указан')}</p><span class="room">${icon('pin')}${escape(l.room||'Место уточняется')}${!l.buildingId&&l.room?' · вне схемы':''}</span>${icon('chevron','chev')}</button></div>`;
  }).join('')}</div>`;
}
function dayRelative(date){return date===dateKey()?'Сегодня':date===addDays(dateKey(),1)?'Завтра':formatDate(date,{day:'numeric',month:'short'});}
function nextHero(){
  if(!group())return `<section class="hero hero-empty"><div class="eyebrow">Расписание</div><h2>Выберите группу</h2><p>Для загрузки расписания.</p>${btn('Выбрать группу','groups','button lime')}</section>`;
  const next=nextLesson(state.rows,new Date(),state.data.config);
  if(!state.loaded){return `<section class="hero hero-empty"><div class="eyebrow">Расписание</div><h2>${state.busy?'Загрузка расписания…':'Расписание не загружено'}</h2><p>${state.busy?'Получаем расписание с сервиса УУНиТ.':'Нужен интернет для первой загрузки. После этого пары будут доступны офлайн.'}</p>${btn('Загрузить расписание '+icon('refresh'),'refresh','button lime',state.busy?'disabled':'')}</section>`;}
  if(!next)return `<section class="hero hero-empty"><div class="eyebrow">Расписание</div><h2>Нет ближайших пар</h2><p>В загруженном расписании нет пар с известным временем на ближайшие 6 недель. Проверьте расписание и обновления источника.</p>${btn('Открыть расписание '+icon('arrow'),'schedule','button lime')}</section>`;
  return `<section class="hero"><div class="hero-top"><span class="eyebrow">${next.ongoing?'Сейчас идёт':'Ближайшая пара'}</span><span class="chip">${dayRelative(next.date)} · ${clock(next.start)}</span></div><h2>${escape(next.subject)}</h2><div class="hero-meta"><span>${icon('clock')}${clock(next.start)}–${clock(next.end)}</span><span>${icon('pin')}${escape(next.room||'Место уточняется')}</span></div><div class="hero-footer">${next.buildingId||next.locationId?btn(`Показать место ${icon('arrow')}`,'next-map','button lime'):btn('О паре '+icon('arrow'),'next-detail','button lime')}${iconBtn('bell','Добавить ближайшую пару в календарь','next-calendar')}</div></section>`;
}
function home(){
  const today=dateKey(),now=new Date(),day=lessonsOn(state.rows,today,state.data.config),next=nextLesson(state.rows,now,state.data.config);
  const previewDate=day.length?today:next?.date||today,preview=currentLessons(previewDate),gaps=freeGaps(day);
  const lifePreview=campusPreview(state.data.events,state.data.clubs);
  const info=!state.loaded?['offline','Расписание офлайн','После первой загрузки расписание сохраняется на этом устройстве.']:!day.length?['sun','Сегодня без пар','В расписании на сегодня нет занятий.']:gaps.length?['coffee',`Окно ${gaps[0].minutes} минут`,`${clock(gaps[0].start)}–${clock(gaps[0].end)} · время между занятиями по расписанию.`]:['check','Занятия сегодня',`${day.length} ${declension(day.length,['занятие','занятия','занятий'])} сегодня.`];
  return `${pageHeading(formatDate(today,{weekday:'long',day:'numeric',month:'long'}),'Сегодня')}${nextHero()}${statusLine()}<div class="insight"><span class="insight-icon">${icon(info[0])}</span><div><h3>${info[1]}</h3><p>${info[2]}</p></div></div>
  ${section(previewDate===today?'План на сегодня':`Пары · ${dayRelative(previewDate).toLowerCase()}`,'schedule','Расписание')}${preview.length?lessonList(preview,previewDate,3):empty(state.loaded?'Сегодня нет пар':'Расписание пока не загружено',state.loaded?'В источнике нет занятий на этот день.':'Нажмите «Обновить», чтобы получить пары вашей группы.','book')}
  ${section('Сегодня в кампусе','events','Смотреть всё')}<div class="life-preview">${lifePreview.map(({type,item})=>type==='club'?clubCard(item):eventCard(item)).join('')}</div>
  <div class="mini-map-card">${mapSvg('7',true)}${btn('Карта кампуса '+icon('arrow'),'map','button light')}</div>`;
}
function declension(n,words){const x=n%100;return words[x>10&&x<20?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];}
function semesterSchedule(){
  const weeks=semesterWeeks(state.rows,state.data.config),current=academicWeek(state.date,state.data.config);
  if(!weeks.length)return empty('В семестре нет занятий','Обновите расписание или сверьтесь с источником.','calendar');
  return `<div class="semester-summary"><h2>Расписание за семестр</h2><p class="subtle">${formatDate(weeks[0].start)} — ${formatDate(weeks.at(-1).end,{day:'numeric',month:'long',year:'numeric'})} · ${weeks.length} учебных недель с занятиями</p><p class="subtle">Все недели из загруженного расписания. Нажмите на неделю, чтобы увидеть пары.</p></div><div class="semester-weeks">${weeks.map(w=>`<details class="semester-week" ${w.week===current?'open':''}><summary><strong>${w.week}-я неделя · ${formatDate(w.start,{day:'numeric',month:'short'})} — ${formatDate(w.end,{day:'numeric',month:'short'})}</strong><span>${w.count} ${declension(w.count,['занятие','занятия','занятий'])}</span></summary>${w.days.filter(d=>d.lessons.length).map(d=>`<section class="week-day"><h3>${formatDate(d.date,{weekday:'long',day:'numeric',month:'short'})}</h3>${lessonList(d.lessons,d.date)}</section>`).join('')}</details>`).join('')}</div>`;
}
function syncNotifications(){
  if(!notifications||!state.data)return;
  notifications.sync({rows:state.loaded?state.rows:[],events:state.data.events,favorites:state.favorites,group:group(),config:state.data.config});
}
function openReminder(item){
  if(!state.profile||!item||typeof item!=='object')return;
  if(validDate(item.date)&&item.date>=state.data.config.academicStart&&item.date<=state.data.config.academicEnd)state.date=item.date;
  state.scheduleView='day';
  if(item.tab==='events'){
    const event=state.data.events.find(e=>item.id===`event:${e.id}:${e.date}`);
    state.lifeSection=event&&eventKind(event)==='student'?'student':'official';state.eventFilter='all';
    navigate('events');if(event)showModal('event',event.id);
  }else navigate('schedule');
}
function notificationPanel(){
  const prefs=notifications.get(),status=notifications.status();
  const toggle=(key,title,description)=>`<label class="notification-option"><span><strong>${title}</strong><small>${description}</small></span><input type="checkbox" data-notification="${key}" ${prefs[key]?'checked':''}></label>`;
  const upcoming=notifications.items().slice(0,8);
  return `<h1>Уведомления</h1><p class="subtle">Напоминания по сохранённому расписанию и событиям. Время Уфы, UTC+5.</p>${toggle('enabled','Включить уведомления','Разрешение можно изменить в настройках устройства.')}
    ${prefs.enabled&&!status.enabled?`<div class="error-panel">${status.native||status.supported?'Уведомления заблокированы или разрешение ещё не выдано.':'В этом браузере системные уведомления недоступны.'}${status.native||status.supported?btn('Разрешить уведомления','notification-permission','button light'):''}</div>`:''}
    ${status.native?`<p class="subtle">${status.exact?'Точное время напоминаний разрешено.':'Android может задерживать напоминания. Для точного времени разрешите «Будильники и напоминания».'}</p>${!status.exact?btn('Разрешить точные напоминания','notification-exact','text-button'):''}${btn('Настройки Android','notification-system','text-button')}`:'<p class="insight compact">В браузере напоминания работают, пока эта страница открыта. Для фоновых уведомлений используйте Android-приложение.</p>'}
    <fieldset class="notification-options" ${prefs.enabled?'':'disabled'}><legend>Что напоминать</legend>${toggle('lessons','Учебные пары','Для выбранной учебной группы.')}${toggle('events','События','Избранные события и встречи, на которые вы записались.')}
    <label class="notification-option"><span>Напомнить заранее</span><select data-notification="leadMinutes" aria-label="За сколько минут напоминать">${[5,10,15,30,60].map(n=>`<option value="${n}" ${prefs.leadMinutes===n?'selected':''}>За ${n} мин</option>`).join('')}</select></label>
    ${toggle('quiet','Тихие часы','Напоминания в этот промежуток пропускаются. Одинаковое начало и конец отключает ограничение.')}
    <div class="notification-times"><label>С <input type="time" data-notification="quietStart" value="${prefs.quietStart}" ${prefs.quiet?'':'disabled'}></label><label>До <input type="time" data-notification="quietEnd" value="${prefs.quietEnd}" ${prefs.quiet?'':'disabled'}></label></div></fieldset>
    ${status.enabled?btn('Проверить уведомление','notification-test','button light'):''}
    <h2>Ближайшие напоминания</h2>${upcoming.length?`<ul class="notification-upcoming">${upcoming.map(item=>`<li><strong>${escape(item.title)}</strong><span>${item.at<=Date.now()?'Время напоминания наступило':`${formatDate(dateKey(new Date(item.at)),{day:'numeric',month:'short'})} · ${clock(minuteOfDay(new Date(item.at)))}`}</span><small>${escape(item.body)}</small></li>`).join('')}</ul>`:'<p class="subtle">Нет запланированных напоминаний. Выберите группу или сохраните событие с известным временем.</p>'}`;
}
function schedule(){
  if(!group())return `${pageHeading('','Расписание')}${empty('Выберите группу','Карта и события уже доступны. Группа нужна только для расписания.','calendar')}${btn('Выбрать группу','groups','button wide')}`;
  const mon=monday(state.date),week=academicWeek(state.date,state.data.config),list=currentLessons();
  return `${pageHeading('','Расписание',`${escape((group()?.title||'без выбранной группы'))} · время Уфы, UTC+5`)}<div class="schedule-heading">${btn('К сегодняшнему дню','today','text-button')}<input class="date-input" type="date" id="schedule-date" value="${state.date}" min="${state.data.config.academicStart}" max="${state.data.config.academicEnd}" aria-label="Выбрать дату расписания"></div>
  <div class="tabs" aria-label="Вид расписания">${btn('День','view-day',state.scheduleView==='day'?'active':'',`aria-pressed="${state.scheduleView==='day'}"`)}${btn('Неделя','view-week',state.scheduleView==='week'?'active':'',`aria-pressed="${state.scheduleView==='week'}"`)}${btn('Семестр','view-semester',state.scheduleView==='semester'?'active':'',`aria-pressed="${state.scheduleView==='semester'}"`)}</div>
  <div class="week-toolbar">${iconBtn('left','Предыдущая неделя','week-prev',mon<=state.data.config.academicStart?'disabled':'')}<div><strong>${formatDate(mon,{day:'numeric'})}–${formatDate(addDays(mon,6),{day:'numeric',month:'long'})}</strong><span class="week-subtitle">${week?`${week}-я учебная неделя`:'Вне учебного года'}</span></div>${iconBtn('chevron','Следующая неделя','week-next',addDays(mon,7)>state.data.config.academicEnd?'disabled':'')}</div>
  <div class="week-strip">${shortDays.map((name,i)=>{const d=addDays(mon,i);return `<button class="day-button ${d===state.date?'active':''} ${d===dateKey()?'today':''}" data-day="${d}" aria-label="${formatDate(d,{weekday:'long',day:'numeric',month:'long'})}" aria-pressed="${d===state.date}">${name}<strong>${Number(d.slice(-2))}</strong><span class="day-dot ${currentLessons(d).length?'':'empty'}"></span></button>`;}).join('')}</div>
  ${statusLine()}${state.error?`<div class="error-panel">${state.loaded?'Показаны сохранённые данные. Изменения пар пока проверить не удалось.':'Для этой группы ещё нет сохранённого расписания.'} ${btn('Открыть источник '+icon('external'),'schedule-source','text-button')}</div>`:''}
  ${!state.loaded?(state.busy?'<div class="skeleton" aria-label="Загрузка расписания"></div>':empty('Нужно первое обновление','Подключитесь к интернету и загрузите расписание.','offline','refresh','Попробовать снова')):state.scheduleView==='semester'?semesterSchedule():state.scheduleView==='day'?`<h2 class="day-heading">${formatDate(state.date,{weekday:'long',day:'numeric',month:'long'})}</h2>${list.length?lessonList(list,state.date):empty('Пар не запланировано','В загруженном расписании этот день свободен.','sun')}`:shortDays.map((_,i)=>{const d=addDays(mon,i),items=currentLessons(d);return `<section class="week-day"><h2 class="week-day-title">${formatDate(d,{weekday:'long',day:'numeric'})}<span>${items.length?items.length+' '+declension(items.length,['занятие','занятия','занятий']):'Без пар'}</span></h2>${items.length?lessonList(items,d):'<p class="subtle">Свободный день</p>'}</section>`;}).join('')}
  <p class="events-note">${btn('Сверить с расписанием УУНиТ '+icon('external'),'schedule-source','text-button')}<br>Учитываются учебные недели из источника. Изменения занятий появятся после обновления.</p>`;
}
function mapSvg(selected,mini=false){
  return `<svg class="campus-map" ${mini?'':'id="campus-map"'} viewBox="130 100 1450 730" role="group" aria-label="Схема корпусов кампуса УУНиТ на улице Карла Маркса"><defs><pattern id="${mini?'mini':'main'}-grid" width="45" height="45" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.5" fill="#b7c5aa" opacity=".5"/></pattern></defs><rect x="-500" y="-500" width="3000" height="2200" fill="url(#${mini?'mini':'main'}-grid)"/><g class="roads" fill="#dbe3d3"><rect x="60" y="60" width="1600" height="60" rx="20"/><rect x="67" y="40" width="64" height="870" rx="20"/><rect x="1582" y="40" width="64" height="870" rx="20"/></g><text class="map-road" x="770" y="101" text-anchor="middle">УЛИЦА КАРЛА МАРКСА</text><text class="map-road" transform="translate(110 650) rotate(-90)">ПУШКИНА</text><text class="map-road" transform="translate(1626 600) rotate(-90)">КОММУНИСТИЧЕСКАЯ</text>
  <g>${state.data.buildings.map(b=>`<path class="building-path ${b.id===selected?'selected':''}" d="${b.path}" ${mini?'':`data-building="${b.id}" tabindex="0" role="button" aria-label="Корпус ${b.id}" aria-pressed="${b.id===selected}"`}/>`).join('')}</g>
  ${state.data.buildings.map(b=>`<g ${mini?'':`data-building="${b.id}"`} class="map-marker"><circle cx="${b.center[0]}" cy="${b.center[1]}" r="${b.id===selected?54:43}" fill="${b.id===selected?'#dbf68b':'#f9fbf4'}" stroke="${b.id===selected?'#173b32':'#a6b993'}" stroke-width="3"/><text class="map-label ${b.id===selected?'selected':''}" x="${b.center[0]}" y="${b.center[1]}">${b.id}</text></g>`).join('')}
  <g fill="#7a8e6a"><path d="M813 422l21 12 28-2 4 6-24 6-12 25-5-1 3-25-21-13z"/><text x="868" y="463" font-size="17" letter-spacing="3" fill="#93a184">КАМПУС УУНИТ</text></g></svg>`;
}
function mapPage(){return '<div id="map-root"></div>';}
function cover(e){return `<div class="event-cover ${e.accent}"><span class="eyebrow">${escape(e.category)} · ${eventKind(e)==='student'?'ВСТРЕЧА':eventKind(e)==='imported'?'ПОДБОРКА':'УУНиТ'}</span><span class="cover-index">${e.date.slice(8)} / ${e.date.slice(5,7)}</span><div class="cover-title">${e.id.startsWith('kod-uust')?'КОД<br>УУНИТ':e.accent==='blue'?'В ДВИЖЕНИИ':escape(e.title.split(':')[0]).slice(0,35)}</div><span class="orbit"></span><span class="orbit"></span><span class="orbit"></span><span class="orb"></span></div>`;}
function eventCard(e){const fit=eventCompatibility(e,state.rows,state.loaded,state.data.config),saved=state.favorites.includes(e.id);return `<article class="event-card"><button class="event-open" data-event="${attrs(e.id)}" aria-label="Подробнее: ${attrs(e.title)}">${cover(e)}<div class="event-body">${kindBadge(e)}<div class="row">${e.demo?'<span class="chip demo">Демонстрация</span>':''}<span class="eyebrow">${formatDate(e.date,{day:'numeric',month:'long'})} · ${e.time||'Время уточняется'}</span></div><h3>${escape(e.title)}</h3><p>${escape(e.place||'Место уточняется')}</p><p class="life-organizer">${escape(e.organizer||e.authorName||e.sourceLabel)}${e.buildingId?' · корпус '+escape(e.buildingId):''}${e.room?' · ауд. '+escape(e.room):''}</p></div></button><div class="event-body" style="padding-top:0"><div class="event-bottom" style="margin-top:0"><span class="chip ${fit.kind}">${icon(fit.kind==='free'?'check':fit.kind==='conflict'?'clock':'info','small-icon')}${fit.kind==='unknown'?'Время или расписание уточняется':fit.label}</span>${btn(icon('heart'),'favorite',`icon-button ${saved?'favorite-on':''}`,`data-id="${attrs(e.id)}" aria-label="${saved?'Убрать событие из':'Сохранить событие в'} избранного" aria-pressed="${saved}"`)}</div>${community?.attendance(e)||''}</div></article>`;}
function eventsPage(){
  const clubs=state.lifeSection==='clubs';
  let events=state.data.events.filter(e=>eventKind(e)===(state.lifeSection==='student'?'student':'official')||state.lifeSection==='official'&&eventKind(e)==='imported');
  if(state.eventFilter==='saved')events=state.data.events.filter(e=>state.favorites.includes(e.id));
  else events=events.filter(e=>state.eventFilter==='past'?eventEnded(e):!eventEnded(e));
  if(state.eventFilter==='free')events=events.filter(e=>eventCompatibility(e,state.rows,state.loaded,state.data.config).kind==='free');
  const heading=`<header class="life-intro"><h1>Студенческая жизнь</h1></header>`;
  const tabs=`<div class="life-tabs" aria-label="Разделы студенческой жизни">${[['clubs','Клубы'],['official','События УУНиТ'],['student','От студентов']].map(([id,title])=>btn(title,'life-section',state.lifeSection===id?'active':'',`data-id="${id}" aria-pressed="${state.lifeSection===id}"`)).join('')}</div>`;
  if(clubs)return heading+tabs+`<label class="search-field">${icon('search')}<input id="club-search" type="search" placeholder="Найти клуб или направление" aria-label="Поиск клубов" value="${attrs(state.clubQuery)}"></label><label class="club-category-label">Направление <select id="club-category"><option value="all">Все направления</option>${[...new Set(state.data.clubs.map(c=>c.category))].sort((a,b)=>a.localeCompare(b,'ru')).map(c=>`<option value="${attrs(c)}" ${state.clubCategory===c?'selected':''}>${escape(c)}</option>`).join('')}</select></label><div id="club-results">${clubResults()}</div><p class="events-note">Полный каталог студенческих объединений УУНиТ. Контакты и страницы источников — в карточках.</p>`;
  return heading+tabs+`${community?.toolbar()||''}<div class="filters" aria-label="Фильтры событий">${[['all','Впереди'],['free','Без пересечений'],['saved','Избранное'],['past','Прошедшие']].map(([id,name])=>btn(name,'filter-events',`filter ${state.eventFilter===id?'active':''}`,`data-id="${id}" aria-pressed="${state.eventFilter===id}"`)).join('')}</div>
  ${state.eventFilter==='free'?'<p class="life-count">Сравниваем с загруженным расписанием. Время на дорогу не учтено.</p>':''}
  <div class="event-list">${events.length?events.map(eventCard).join(''):state.lifeSection==='student'&&state.eventFilter==='all'?`<section class="life-empty"><h2>Пока нет встреч</h2><p>Можно создать свою.</p><button class="button" data-community="create">Создать встречу</button></section>`:empty('Здесь пока нет событий','Выберите другой фильтр.','spark')}</div>
  ${state.lifeSection==='official'?`<p class="events-note">УУНиТ ✓ — анонс из источника университета или публикация организатора сервера. Перед посещением проверь условия участия.</p>${btn('Все объявления УУНиТ '+icon('external'),'all-events','text-button')}`:'<p class="events-note">Встречи создают участники сообщества. Счётчик показывает записавшихся, а не фактическую посещаемость.</p>'}`;
}
function clubResults(){
  const query=normalizeSearch(state.clubQuery),clubs=state.data.clubs.filter(c=>(state.clubCategory==='all'||c.category===state.clubCategory)&&normalizeSearch(c.name+' '+c.category+' '+c.summary).includes(query));
  return `<p class="life-count">${clubs.length} из ${state.data.clubs.length} объединений УУНиТ</p>${clubs.length?`<div class="club-list">${clubs.map(clubCard).join('')}</div>`:empty('Клубы не найдены','Измените запрос или направление.','search')}`;
}
function setting(ico,title,description,action){return `<button class="setting" data-action="${action}">${icon(ico)}<span><strong>${title}</strong><small>${description}</small></span>${icon('chevron')}</button>`;}

function mergeCommunity(events){
  if(!state.data)return;
  state.data.events=[...new Map([...(state.data.localEvents||[]),...events].map(e=>[e.id,e])).values()].sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  syncNotifications();
}
function themePicker(){const current=window.campusTheme?.get()||'purple';return `<div class="theme-options">${[['purple','Бело-фиолетовая','Цвета УУНиТ','uust-logo.png'],['green','Зелёная','Зелёные оттенки','uust-logo-green.png']].map(([id,title,sub,file])=>`<button class="theme-option" data-theme-choice="${id}" aria-pressed="${current===id}"><span class="theme-swatch ${id}"><img src="assets/${file}" alt=""><span></span></span><strong>${title}</strong><small>${sub}</small></button>`).join('')}</div>`;}

function profile(){const g=group()||{title:'Без группы',faculty:'Выбери группу для расписания'};return `${pageHeading('','Профиль')}<section class="profile-hero"><span class="avatar">${escape(g.title.split('-')[0].slice(0,2))}</span><div><h2>${escape(g.title)}</h2><p>${escape([g.faculty,g.course?g.course+' курс':'',g.city].filter(Boolean).join(' · '))}</p></div></section>
  <div class="settings-list">${setting('user','Учебная группа',escape(g.title)+' · можно изменить','groups')}${setting('heart','Сохранённые места',state.savedPlaces.length+' '+declension(state.savedPlaces.length,['корпус','корпуса','корпусов']),'saved-places')}${setting('spark','Избранные события',state.favorites.length+' '+declension(state.favorites.length,['событие','события','событий']),'saved-events')}</div>
  ${community?.accountCard()||''}${section('Цветовая тема')}${themePicker()}${section('Данные и настройки')}<div class="settings-list">${setting('bell','Уведомления',notifications?.get().enabled?'Напоминания включены':'Пары, события и тихие часы','notifications')}${setting('refresh','Обновить расписание',state.at?'Последняя загрузка: '+formatDate(dateKey(new Date(state.at))):'Для выбранной группы','refresh')}${setting('download','Импорт мероприятий','Обновить подборку из JSON-файла','import')}${setting('globe','Источники и точность','Откуда пары, события и карта','sources')}${setting('shield','Локальный профиль','Группа и избранное хранятся на устройстве','privacy')}</div>
  <div class="profile-note">Время Уфы · UTC+5<br>Карта доступна без интернета. Загруженное расписание сохраняется отдельно для каждой группы. Регистрация не требуется.</div><div class="version">Кампус · 0.3.2</div>`;}
function groupResults(){const matches=searchGroups(state.data.groups,state.groupQuery);return matches.length?matches.map(g=>`<button class="group-result ${state.selectedGroup?.id===g.id?'active':''}" data-pick-group="${g.id}"><span class="group-avatar">${escape(g.title.slice(0,2))}</span><span><strong>${escape(g.title)}</strong><small>${escape([g.faculty,g.course?g.course+' курс':'',g.city].filter(Boolean).join(' · '))}</small></span>${state.selectedGroup?.id===g.id?icon('check'):icon('chevron')}</button>`).join(''):`<div class="empty-state"><h3>Группа не найдена</h3><p>Попробуйте часть названия. Список содержит ${state.data.groups.length} групп из источника.</p>${btn('Обновить список','refresh-groups','text-button')}</div>`;}
function groupPicker(){return `<label class="search-field">${icon('search')}<input id="group-search" type="search" placeholder="Введите учебную группу" value="${attrs(state.groupQuery)}" autocomplete="off" aria-label="Поиск учебной группы"></label><div class="group-results" id="group-results">${groupResults()}</div>${btn(state.profile?'Сохранить группу '+icon('check'):'Это моя группа '+icon('arrow'),'save-group','button wide',`id="save-group" ${state.selectedGroup?'':'disabled'}`)}`;}
function onboarding(){return `<main class="intro"><div class="topbar">${wordmark()}</div><section class="intro-hero"><h1>Расписание, карта<br>и события</h1><div class="intro-map">${mapSvg('1',true)}</div></section><div class="intro-step"><h2>Учебная группа</h2></div>${groupPicker()}${btn('Продолжить без группы','guest','text-button guest-button')}<div class="intro-foot"><div class="privacy">${icon('shield')}Регистрация необязательна</div></div></main>`;}
function render(){
  const scroll=window.scrollY;
  syncNotifications();
  mapController?.unmount();
  $('#app').innerHTML=`<div class="app-shell ${state.tab==='map'&&state.profile?'map-active':''}">${!state.profile?onboarding():topbar()+`<main class="content" id="main-content">${({home,schedule,map:mapPage,events:eventsPage,profile}[state.tab])()}</main>`+nav()}</div>`;
  if(state.tab==='map'&&state.profile)mapController.mount($('#map-root'));
  window.scrollTo(0,scroll);
}
function navigate(tab){closeModal();state.tab=tab;render();window.scrollTo(0,0);if(tab==='events'||tab==='profile')community?.sync({quiet:true});}
function showModal(kind,payload){returnFocus=document.activeElement;state.modal={kind,payload};renderModal();document.body.classList.add('no-scroll');setTimeout(()=>$('#modal-root [data-action="close"]')?.focus(),30);}
function closeModal(){state.modal=null;$('#modal-root').innerHTML='';document.body.classList.remove('no-scroll');if(returnFocus?.isConnected)returnFocus.focus();}
function modalFrame(label,body){return `<div class="modal-overlay" data-overlay><section class="modal" role="dialog" aria-modal="true" aria-label="${attrs(label)}"><div class="modal-handle"></div><div class="modal-header"><span class="eyebrow">${label}</span>${iconBtn('close','Закрыть','close')}</div>${body}</section></div>`;}
function detailRow(ico,title,sub=''){return `<div class="detail-row">${icon(ico)}<div><strong>${escape(title)}</strong>${sub?`<small>${escape(sub)}</small>`:''}</div></div>`;}
function renderModal(){
  if(!state.modal)return;
  const modalScroll=$('#modal-root .modal')?.scrollTop||0;
  const {kind,payload}=state.modal;let body='',label='';
  if(kind==='notifications'){label='Напоминания';body=notificationPanel();}
  else if(kind==='lesson'){
    const l=payload;label='Занятие';
    body=`${tag(l.type)}<h1>${escape(l.subject)}</h1>${detailRow('calendar',formatDate(l.date,{weekday:'long',day:'numeric',month:'long'}),`${academicWeek(l.date,state.data.config)}-я учебная неделя`)}${detailRow('clock',l.start===null?'Время уточняется':`${clock(l.start)}–${clock(l.end)}`,'Время Уфы · UTC+5')}${detailRow('user',l.teacher||'Преподаватель не указан')}${detailRow('pin',l.room||'Аудитория не указана',l.buildingTitle||'Место уточняется')}${l.comment?`<p>${escape(l.comment)}</p>`:''}${!l.buildingId?'<div class="insight compact">'+icon('info')+'<p>Это место пока не сопоставлено со схемой кампуса. Сверьтесь с исходным адресом и указателями университета.</p></div>':''}<div class="modal-actions">${l.buildingId||l.locationId?btn('Показать место '+icon('map'),'lesson-map','button wide'):''}${l.start!==null?btn(icon('bell')+' Добавить в календарь','lesson-calendar','button light wide'):''}${btn('Расписание в источнике '+icon('external'),'schedule-source','button outline wide')}</div><p class="source-line">Данные: schedule.uust.ru · ${state.source==='live'?'загруженная версия':'сохранённая версия'}. Изменения проверяются при обновлении.</p>`;
  } else if(kind==='event'){
    const e=state.data.events.find(e=>e.id===payload);if(!e){closeModal();return;}
    const fit=eventCompatibility(e,state.rows,state.loaded,state.data.config);label=e.demo?'Демонстрационное событие':'Жизнь кампуса';
    body=`${cover(e)}${kindBadge(e)}<h1>${escape(e.title)}</h1>${detailRow('calendar',formatDate(e.date,{day:'numeric',month:'long',year:'numeric'}),e.time?`${e.time}${e.endTime?'–'+e.endTime:''} · время Уфы`:'Время начала не опубликовано')}${detailRow('user',e.organizer||e.authorName||e.sourceLabel,'Организатор')}${detailRow('pin',e.place||'Место уточняется',[e.buildingId?'Корпус '+e.buildingId:'',e.room?'Аудитория '+e.room:'',state.data.mapPack.floors.find(f=>f.id===e.floorId)?.name||''].filter(Boolean).join(' · '))}${community?.attendance(e)||''}
    <div class="insight compact">${icon(fit.kind==='free'?'check':'info')}<div><h3>${fit.label}</h3><p>${fit.kind==='conflict'?fit.lessons.map(l=>escape(l.subject)+' · '+clock(l.start)+'–'+clock(l.end)).join('<br>'):fit.kind==='free'?'Сравнено с загруженным расписанием. Время на дорогу не учтено.':'Для точного сравнения нужны начало и конец события, а также расписание на этот день.'}</p></div></div><p class="life-description">${escape(e.description)}</p>
    <div class="modal-actions">${e.buildingId||e.locationId?btn('Показать маршрут '+icon('arrow'),'event-map','button wide'):''}${btn(icon('heart')+(state.favorites.includes(e.id)?' В избранном':' Сохранить событие'),'favorite',`button ${state.favorites.includes(e.id)?'light':'outline'} wide`,`data-id="${attrs(e.id)}"`)}${e.time&&e.endTime?btn(icon('bell')+' Добавить в календарь','event-calendar','button light wide'):''}${e.source?btn('Условия участия и регистрация '+icon('external'),'event-source','button outline wide'):''}</div><p class="source-line">${escape(e.sourceLabel)}${e.community?e.kind==='student'?' · встреча студента':' · публикация организатора':e.imported?' · данные добавлены командой':'. Редакционная подборка по официальному анонсу.'}</p>${community?.controls(e)||''}`;
  } else if(kind==='club'){const club=state.data.clubs.find(c=>c.id===payload);if(!club){closeModal();return;}label='Студенческий клуб';body=clubDetail(club);
  } else if(kind==='groups'){label='Учебная группа';body='<h1>Учебная группа</h1>'+groupPicker();}
  else if(kind==='saved-places'){label='Избранные места';const places=state.data.buildings.filter(b=>state.savedPlaces.includes(b.id));body='<h1>Сохранённые корпуса</h1>'+ (places.length?`<div class="saved-list">${places.map(b=>setting('pin',b.name,b.address,'saved-place-'+b.id)).join('')}</div>`:empty('Нет сохранённых корпусов','Нажми на сердечко в карточке корпуса на карте.','map'));}
  else if(kind==='import'){label='Обновление подборки';body=`<h1>События от команды</h1><p>Выбери JSON-файл с мероприятиями. Он заменит текущую подборку на этом устройстве. Названия и даты проверим до сохранения.</p><label class="field-label" for="events-file">Файл мероприятий</label><input id="events-file" type="file" accept=".json,application/json"><div id="import-result"></div><p class="source-line">Формат: schemaVersion: 1 и массив events. Шаблон и инструкция находятся в исходном проекте. Импорт будет подписан «Импорт команды».</p>${btn('Вернуть подборку УУНиТ','restore-events','button light wide')}`;}
  else if(kind==='privacy'){label='Приватность';body=`<h1>Приватность</h1>${detailRow('shield','Вход по желанию','Картой, расписанием и афишей можно пользоваться без аккаунта.')}${detailRow('user','Аккаунт сообщества','При регистрации выбранному серверу передаются имя, логин и пароль. Сервер хранит хеш пароля, опубликованные события и записи об участии; публичен только счётчик участников; сессия хранится на устройстве.')}${detailRow('user','Локальное хранение','Группа, избранное и расписание сохраняются внутри приложения.')}${detailRow('globe','Обновление расписания','Сервису расписания передаётся идентификатор выбранной группы. Сервер источника видит обычные сетевые метаданные запроса.')}${detailRow('map','Без разрешения на GPS','Схема не привязана к координатам. Доступ к геолокации не запрашивается.')}${detailRow('calendar','Календарь','Событие сохраняется после подтверждения в календаре.')}`;}
  else if(kind==='original-map'){label='Материалы команды';body='<h1>Исходная схема</h1><img src="assets/original-map.jpg" alt="Исходная схема расположения корпусов из архива команды" style="width:100%;border-radius:18px"><p>Из этой схемы взяты взаимное расположение корпусов и их контуры. Обозначенные в исходнике входы не проверены на местности.</p>';}
  else if(kind==='sources'){label='Источники и ограничения';body=`<h1>Источники данных</h1><div class="sources-list"><article class="source-item"><h3>Расписание</h3><p>schedule.uust.ru, учебный год 2026/2027. Обновление при запуске и вручную.</p>${btn('Открыть сервис '+icon('external'),'schedule-source','text-button')}</article><article class="source-item"><h3>Кампус</h3><p>Схема территории, планы CampusWay и фотографии планов этажей команды. Географической привязки нет. Доступность проходов требует проверки.</p></article><article class="source-item"><h3>События</h3><p>Объявления uust.ru и события подключённого сервера. Источник указан в карточке.</p>${btn('Объявления УУНиТ '+icon('external'),'all-events','text-button')}</article><article class="source-item"><h3>О приложении</h3><p>Студенческий проект для хакатона. Не является официальным приложением университета. Не все площадки УУНиТ входят в схему на Карла Маркса.</p></article></div>`;}
  $('#modal-root').innerHTML=modalFrame(label,body);
  $('#modal-root .modal').scrollTop=modalScroll;
}
async function refresh(){
  if(!group()||state.busy)return;
  const ticket=++state.request,id=group().id;state.busy=true;state.error=null;render();
  try {const result=await refreshSchedule(id,state.data.config,state.data);if(ticket!==state.request || group().id!==id)return;Object.assign(state,result);if(result.persisted===false)toast('Расписание загружено, но память устройства заполнена');}
  catch(e){if(ticket!==state.request)return;state.error=e.message||'Не удалось обновить';}
  finally{if(ticket===state.request){state.busy=false;render();if(state.modal?.kind==='event'||state.modal?.kind==='lesson')renderModal();}}
}
function openBuilding(id,context=null){mapController.open({...context,buildingId:id});navigate('map');}
function calendar(item){
  if(!item.date || item.start===null || item.end===null)return;
  const start=ufaTimestamp(item.date,typeof item.start==='number'?clock(item.start):item.start),end=ufaTimestamp(item.date,typeof item.end==='number'?clock(item.end):item.end);
  const details={title:item.title||item.subject,location:item.location||item.buildingTitle||'',description:item.description||'Расписание УУНиТ · '+(group()?.title||'без выбранной группы'),start,end};
  if(window.CampusAndroid){window.CampusAndroid.addCalendar(JSON.stringify(details));return;}
  const stamp=n=>new Date(n).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const icsEscape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UUST Campus//RU','BEGIN:VEVENT',`UID:${Date.now()}@campus.local`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${icsEscape(details.title)}`,`LOCATION:${icsEscape(details.location)}`,`DESCRIPTION:${icsEscape(details.description)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campus-event.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Файл для календаря сохранён');
}
async function action(name,el){
  if(name==='notifications'){showModal('notifications');return;}
  if(name==='notification-permission'){await notifications.request();syncNotifications();renderModal();return;}
  if(name==='notification-system'){notifications.systemSettings();return;}
  if(name==='notification-exact'){notifications.exactSettings();return;}
  if(name==='notification-test'){try{notifications.test();toast('Тестовое уведомление отправлено');}catch(error){toast(error.message);}return;}
  if(name==='life-section'){state.lifeSection=el.dataset.id;state.eventFilter='all';render();if(state.lifeSection!=='clubs')community?.sync({quiet:true});return;}
  if(name==='club-detail'){showModal('club',el.dataset.id);return;}
  if(name==='club-link'){const club=state.data.clubs.find(c=>c.id===el.dataset.id);if(club&&['vk','telegram','source'].includes(el.dataset.link))external(club[el.dataset.link]);return;}
  const next=()=>nextLesson(state.rows,new Date(),state.data.config);
  const event=()=>state.data.events.find(e=>e.id===state.modal?.payload);
  if(['home','schedule','map','events','profile'].includes(name)){navigate(name);return;}
  if(name==='close'){closeModal();return;}
  if(name==='guest'){state.profile={guest:true,group:null};storage.write('profile',state.profile);navigate('map');return;}
  if(name==='groups'){state.groupQuery=group()?.title||'ТОП-106Б';state.selectedGroup=group();showModal('groups');return;}
  if(name==='save-group'){
    if(!state.selectedGroup)return;state.profile={group:state.selectedGroup};if(!storage.write('profile',state.profile))toast('Не удалось сохранить профиль на устройстве');
    state.request++;state.busy=false;state.error=null;Object.assign(state,loadSavedSchedule(group().id,state.data));state.date=dateKey();navigate('home');refresh();return;
  }
  if(name==='refresh'){refresh();return;}
  if(name==='refresh-groups'){el.disabled=true;try{state.data.groups=await refreshGroups();$('#group-results').innerHTML=groupResults();toast('Список групп обновлён');}catch{toast('Источник недоступен. Используем сохранённый список.');el.disabled=false;}return;}
  if(name==='next-map'){const l=next();if(l?.buildingId||l?.locationId)openBuilding(l.buildingId,{...l,title:l.subject});return;}
  if(name==='next-detail'){const l=next();if(l)showModal('lesson',l);return;}
  if(name==='next-calendar'){const l=next();if(l)calendar(l);return;}
  if(name==='today'){state.date=dateKey();render();return;}
  if(name.startsWith('view-')){state.scheduleView=['day','week','semester'].includes(name.slice(5))?name.slice(5):'day';render();return;}
  if(name==='week-prev'||name==='week-next'){const nextDate=addDays(state.date,name==='week-prev'?-7:7);if(nextDate<state.data.config.academicStart)state.date=state.data.config.academicStart;else if(nextDate>state.data.config.academicEnd)state.date=state.data.config.academicEnd;else state.date=nextDate;render();return;}
  if(name==='building-external'){const b=state.data.buildings.find(b=>b.id===el.dataset.id);external('https://yandex.ru/maps/?text='+encodeURIComponent(`УУНиТ Уфа Карла Маркса 12 ${b.name}`));return;}
  if(name==='save-place'){const id=el.dataset.id;state.savedPlaces=state.savedPlaces.includes(id)?state.savedPlaces.filter(x=>x!==id):[...state.savedPlaces,id];storage.write('places',state.savedPlaces);render();return;}
  if(name==='filter-events'){state.eventFilter=el.dataset.id;render();return;}
  if(name==='favorite'){const id=el.dataset.id;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];storage.write('favorites',state.favorites);render();if(state.modal)renderModal();return;}
  if(name==='saved-events'){state.lifeSection='official';state.eventFilter='saved';navigate('events');return;}
  if(name.startsWith('saved-place-')){openBuilding(name.replace('saved-place-',''));return;}
  if(['sources','privacy','import','saved-places','original-map'].includes(name)){showModal(name);return;}
  if(name==='schedule-source'){external(`https://schedule.uust.ru/schedule?type=0&id=${group()?.id||14381}`);return;}
  if(name==='all-events'){external('https://uust.ru/events/');return;}
  if(name==='lesson-map'){const l=state.modal.payload;openBuilding(l.buildingId,{...l,title:l.subject});return;}
  if(name==='lesson-calendar'){calendar(state.modal.payload);return;}
  if(name==='event-map'){const e=event();openBuilding(e.buildingId,{...e,room:e.room||e.place,planRoute:true});return;}
  if(name==='event-calendar'){const e=event();calendar({...e,start:e.time,end:e.endTime,location:e.place,description:e.source});return;}
  if(name==='event-source'){external(event().source);return;}
  if(name==='restore-events'){storage.remove('events');state.data.localEvents=validateEvents(state.data.bundledEvents);mergeCommunity(community?.events()||[]);state.data.eventsUpdated=state.data.bundledEvents.updatedAt;closeModal();render();toast('Подборка УУНиТ восстановлена');}
}
document.addEventListener('click',e=>{
  if(e.target.matches('[data-overlay]')){closeModal();return;}
  const el=e.target.closest('[data-action],[data-tab],[data-lesson],[data-event],[data-day],[data-pick-group],[data-building]');if(!el)return;
  if(el.dataset.action){action(el.dataset.action,el);return;}
  if(el.dataset.tab){navigate(el.dataset.tab);return;}
  if(el.dataset.lesson){const lesson=state.rows.find(l=>l.id===el.dataset.lesson);if(lesson)showModal('lesson',{...lesson,date:el.dataset.date});return;}
  if(el.dataset.event){showModal('event',el.dataset.event);return;}
  if(el.dataset.day){state.date=el.dataset.day;state.scheduleView='day';render();return;}
  if(el.dataset.pickGroup){state.selectedGroup=state.data.groups.find(g=>g.id===+el.dataset.pickGroup);$('#group-results').innerHTML=groupResults();$('#save-group').disabled=false;return;}
});
document.addEventListener('input',e=>{
  if(e.target.id==='club-search'){state.clubQuery=e.target.value;$('#club-results').innerHTML=clubResults();}
  if(e.target.id==='group-search'){state.groupQuery=e.target.value;state.selectedGroup=null;$('#group-results').innerHTML=groupResults();$('#save-group').disabled=true;}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='club-category'){state.clubCategory=e.target.value;$('#club-results').innerHTML=clubResults();return;}
  if(e.target.dataset.notification){const key=e.target.dataset.notification,prefs=notifications.get();prefs[key]=e.target.type==='checkbox'?e.target.checked:key==='leadMinutes'?Number(e.target.value):e.target.value;if(!notifications.save(prefs)){toast('Не удалось сохранить настройки');renderModal();return;}syncNotifications();if(key==='enabled'&&prefs.enabled)await notifications.request();renderModal();return;}
  if(e.target.id==='schedule-date'){if(e.target.value&&e.target.validity.valid){state.date=e.target.value;render();}return;}
  if(e.target.id==='events-file'){
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>512*1024)throw new Error('Файл больше 512 КБ');const payload=JSON.parse(await file.text()),events=validateEvents(payload,true);const saved={...payload,updatedAt:dateKey()};if(!storage.write('events',saved))throw new Error('Недостаточно места для сохранения');state.data.localEvents=events;mergeCommunity(community?.events()||[]);state.data.eventsUpdated=saved.updatedAt;closeModal();state.lifeSection='official';state.eventFilter='all';navigate('events');toast(`Импортировано событий: ${events.length}`);}
    catch(error){$('#import-result').innerHTML=`<div class="error-panel" role="alert">Импорт не выполнен. ${escape(error.message)}</div>`;}
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&state.modal){closeModal();return;}
  if(e.key==='Tab'&&state.modal){const focusable=[...document.querySelectorAll('.modal button:not([disabled]),.modal input:not([disabled]),.modal select:not([disabled]),.modal a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
window.campusBack=()=>{if(community?.close())return true;if(state.tab==='map'&&mapController.back())return true;if(state.modal){closeModal();return true;}if(state.tab!=='home'){navigate('home');return true;}return false;};
async function boot(){
  try{
    state.data=await initialData();
    notifications=createNotifications({storage,onError:toast,onOpen:openReminder});
    window.campusNotificationChanged=()=>{syncNotifications();if(state.modal?.kind==='notifications')renderModal();};
    window.campusOpenReminder=openReminder;
    state.data.localEvents=[...state.data.events];
    community=createCommunity({onPublished:kind=>{state.lifeSection=kind==='official'?'official':'student';state.eventFilter='all';navigate('events');},mapData:createMapData(state.data.mapPack,state.data.buildings),toast,closeMainModal:closeModal,onEvents:events=>mergeCommunity(events),onChange:()=>{if(state.data&&state.profile&&!community?.dialogOpen()&&['home','events','profile'].includes(state.tab)){if(state.modal?.kind==='event'){const focused=document.activeElement?.dataset.community;render();renderModal();if(focused)$('#modal-root [data-community="'+focused+'"]')?.focus();}else if(!state.modal)render();}}});
    mergeCommunity(community.events());
    mapController=createMapController({buildings:state.data.buildings,bundledPack:state.data.mapPack,storage,external,isFavorite:id=>state.savedPlaces.includes(id),onFavorite:id=>{state.savedPlaces=state.savedPlaces.includes(id)?state.savedPlaces.filter(x=>x!==id):[...state.savedPlaces,id];storage.write('places',state.savedPlaces);}});
    if(state.profile?.group && !state.data.groups.some(g=>g.id===state.profile.group.id))state.profile=null;
    if(state.profile && !state.profile.group && !state.profile.guest)state.profile=null;
    state.selectedGroup=state.profile?.group||state.data.groups.find(g=>g.id===14381);
    if(group())Object.assign(state,loadSavedSchedule(group().id,state.data));
    render();community.sync({quiet:true});if(group())refresh();
    if(typeof window.CampusAndroid?.consumeReminderTarget==='function'){try{const target=JSON.parse(window.CampusAndroid.consumeReminderTarget());if(target)window.campusOpenReminder(target);}catch{}}
    refreshGroups().then(groups=>{state.data.groups=groups;}).catch(()=>{});
  }catch(error){$('#app').innerHTML=`<div class="boot"><span class="brand-symbol">к.</span><h1>Не удалось открыть приложение</h1><p>${escape(error.message)}</p><p>Перезапустите приложение. Если ошибка повторяется, установите APK заново.</p></div>`;}
}
window.addEventListener('online',()=>{if(group()&&!state.busy)refresh();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.data&&group()){render();if(!state.at||Date.now()-Date.parse(state.at)>15*60*1000)refresh();}});
// Re-evaluate the nearest class at a minute boundary without interrupting dialogs or typing.
setInterval(()=>{if(state.data&&state.profile&&state.tab==='home'&&!state.modal&&document.visibilityState==='visible')render();},60000);
boot();
