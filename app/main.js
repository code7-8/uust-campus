import {TIME_ZONE,dateKey,minuteOfDay,addDays,monday,academicWeek,formatDate,clock,lessonsOn,nextLesson,freeGaps,eventCompatibility,searchGroups,searchBuildings,validateEvents,ufaTimestamp} from './core.js';
import {initialData,loadSavedSchedule,refreshSchedule,refreshGroups,storage} from './repository.js';
import {icon} from './icons.js';

const $ = s=>document.querySelector(s);
const escape = value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrs = escape;
const shortDays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const state={tab:'home',profile:storage.read('profile'),data:null,rows:[],loaded:false,source:null,at:null,error:null,busy:false,
  date:dateKey(),scheduleView:'day',eventFilter:'all',mapId:'1',mapQuery:'',mapContext:null,mapZoom:1,mapView:null,
  favorites:storage.read('favorites',[]),savedPlaces:storage.read('places',[]),modal:null,groupQuery:'ТОП-106Б',selectedGroup:null,request:0};
let toastTimer,returnFocus;
function toast(text) {clearTimeout(toastTimer);const el=$('#toast');el.textContent=text;el.classList.add('visible');toastTimer=setTimeout(()=>el.classList.remove('visible'),3500);}
const btn=(text,action,cls='button',more='')=>`<button class="${cls}" data-action="${action}" ${more}>${text}</button>`;
const iconBtn=(name,label,action,more='')=>btn(icon(name),action,'icon-button',`aria-label="${attrs(label)}" ${more}`);
function external(url) {if(!/^https:\/\//.test(url))return; if(window.CampusAndroid)window.CampusAndroid.openExternal(url);else window.open(url,'_blank','noopener,noreferrer');}
function group() {return state.profile?.group;}
function currentLessons(date=state.date) {return lessonsOn(state.rows,date,state.data.config);}
function tag(type) {const cls=/Лекц/.test(type)?'lecture':/Лаб/.test(type)?'lab':'practice';return `<span class="chip ${cls}">${escape(type?.replace(' (семинар)','')||'Занятие')}</span>`;}
const wordmark=()=>`<div class="wordmark"><span class="brand-symbol">к.</span><span><strong>кампус.</strong><small>УУНИТ · УФА</small></span></div>`;
function topbar(){return `<header class="topbar">${wordmark()}${btn(`${icon('user')} ${escape(group()?.title)} ${icon('chevron')}`,'groups','group-chip','aria-label="Изменить учебную группу"')}</header>`;}
function nav(){return `<nav class="bottom-nav" aria-label="Основная навигация">${[['home','home','Сегодня'],['schedule','calendar','Расписание'],['map','map','Карта'],['events','spark','События'],['profile','user','Профиль']].map(([id,ico,label])=>`<button class="nav-item ${state.tab===id?'active':''}" data-tab="${id}" ${state.tab===id?'aria-current="page"':''}><span class="nav-icon">${icon(ico)}</span>${label}</button>`).join('')}</nav>`;}
function statusLine(){
  const stamp=state.at?new Intl.DateTimeFormat('ru-RU',{timeZone:TIME_ZONE,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(state.at)):null;
  let text=state.loaded?`${state.source==='bundled'?'Снимок':'Обновлено'} ${stamp}`:'Расписание ещё не сохранено';
  if(state.busy)text+=' · обновляем';
  if(state.error)text=state.loaded?`Нет обновления · данные от ${stamp}`:'Не удалось связаться с источником';
  const stale=state.at && Date.now()-Date.parse(state.at)>86400000;
  if(stale && !state.error)text+=' · проверьте актуальность';
  return `<div class="status-line ${state.error||stale?'warning':''}"><span class="status-dot"></span><span>${escape(text)}</span>${btn(icon('refresh',state.busy?'motion-spin':'')+(state.busy?'':' Обновить'),'refresh','text-button',state.busy?'disabled':'')}</div>`;
}
function pageHeading(kicker,title,subtitle=''){return `<div class="page-heading"><div class="eyebrow">${kicker}</div><h1>${title}</h1>${subtitle?`<p class="subtle">${subtitle}</p>`:''}</div>`;}
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
  const next=nextLesson(state.rows,new Date(),state.data.config);
  if(!state.loaded){return `<section class="hero hero-empty"><div class="eyebrow">Твоё расписание</div><h2>${state.busy?'Ищем ближайшую пару…':'Подключим твой учебный день'}</h2><p>${state.busy?'Получаем расписание с сервиса УУНиТ.':'Нужен интернет для первой загрузки. После этого пары будут доступны офлайн.'}</p>${btn('Загрузить расписание '+icon('refresh'),'refresh','button lime',state.busy?'disabled':'')}</section>`;}
  if(!next)return `<section class="hero hero-empty"><div class="eyebrow">Можно выдохнуть</div><h2>Впереди свободное время</h2><p>В загруженном расписании нет пар с известным временем на ближайшие 6 недель. Проверьте расписание и обновления источника.</p>${btn('Открыть расписание '+icon('arrow'),'schedule','button lime')}</section>`;
  return `<section class="hero"><div class="hero-top"><span class="eyebrow">${next.ongoing?'Сейчас идёт':'Ближайшая пара'}</span><span class="chip">${dayRelative(next.date)} · ${clock(next.start)}</span></div><h2>${escape(next.subject)}</h2><div class="hero-meta"><span>${icon('clock')}${clock(next.start)}–${clock(next.end)}</span><span>${icon('pin')}${escape(next.room||'Место уточняется')}</span></div><div class="hero-footer">${next.buildingId?btn(`К корпусу ${next.buildingId} ${icon('arrow')}`,'next-map','button lime'):btn('О паре '+icon('arrow'),'next-detail','button lime')}${iconBtn('bell','Добавить ближайшую пару в календарь','next-calendar')}</div></section>`;
}
function home(){
  const today=dateKey(),now=new Date(),day=lessonsOn(state.rows,today,state.data.config),next=nextLesson(state.rows,now,state.data.config);
  const previewDate=day.length?today:next?.date||today,preview=currentLessons(previewDate),gaps=freeGaps(day);
  const upcoming=state.data.events.find(e=>e.date>=today);
  const info=!state.loaded?['offline','Пары останутся с тобой','После первой загрузки расписание сохраняется на этом устройстве.']:!day.length?['sun','Сегодня без пар','Хороший момент спланировать неделю и найти что-то интересное в кампусе.']:gaps.length?['coffee',`Окно ${gaps[0].minutes} минут`,`${clock(gaps[0].start)}–${clock(gaps[0].end)} · время между занятиями по расписанию.`]:['check','День собран',`${day.length} ${declension(day.length,['занятие','занятия','занятий'])} сегодня. Аудитории и корпуса — в одном касании.`];
  return `${pageHeading(formatDate(today,{weekday:'long',day:'numeric',month:'long'}),'Твой день,<br>без суеты.')}${nextHero()}${statusLine()}<div class="insight"><span class="insight-icon">${icon(info[0])}</span><div><h3>${info[1]}</h3><p>${info[2]}</p></div></div>
  ${section(previewDate===today?'План на сегодня':`Пары · ${dayRelative(previewDate).toLowerCase()}`,'schedule','Расписание')}${preview.length?lessonList(preview,previewDate,3):empty(state.loaded?'Сегодня можно выдохнуть':'Расписание пока не загружено',state.loaded?'В источнике нет занятий на этот день.':'Нажмите «Обновить», чтобы получить пары вашей группы.','book')}
  ${section('За пределами пар','events','Все события')}${upcoming?eventCard(upcoming):empty('Новые встречи впереди','Пока в подборке нет будущих событий. Загляните в объявления университета.','spark')}
  <div class="mini-map-card">${mapSvg('7',true)}${btn('Исследовать кампус '+icon('arrow'),'map','button light')}</div>`;
}
function declension(n,words){const x=n%100;return words[x>10&&x<20?2:n%10===1?0:n%10>=2&&n%10<=4?1:2];}
function schedule(){
  const mon=monday(state.date),week=academicWeek(state.date,state.data.config),list=currentLessons();
  return `${pageHeading('Учёба в своём ритме','Расписание',`${escape(group().title)} · время Уфы, UTC+5`)}<div class="schedule-heading">${btn('К сегодняшнему дню','today','text-button')}<input class="date-input" type="date" id="schedule-date" value="${state.date}" min="${state.data.config.academicStart}" max="${state.data.config.academicEnd}" aria-label="Выбрать дату расписания"></div>
  <div class="tabs" aria-label="Вид расписания">${btn('День','view-day',state.scheduleView==='day'?'active':'',`aria-pressed="${state.scheduleView==='day'}"`)}${btn('Неделя','view-week',state.scheduleView==='week'?'active':'',`aria-pressed="${state.scheduleView==='week'}"`)}</div>
  <div class="week-toolbar">${iconBtn('left','Предыдущая неделя','week-prev',mon<=state.data.config.academicStart?'disabled':'')}<div><strong>${formatDate(mon,{day:'numeric'})}–${formatDate(addDays(mon,6),{day:'numeric',month:'long'})}</strong><span class="week-subtitle">${week?`${week}-я учебная неделя`:'Вне учебного года'}</span></div>${iconBtn('chevron','Следующая неделя','week-next',addDays(mon,7)>state.data.config.academicEnd?'disabled':'')}</div>
  <div class="week-strip">${shortDays.map((name,i)=>{const d=addDays(mon,i);return `<button class="day-button ${d===state.date?'active':''} ${d===dateKey()?'today':''}" data-day="${d}" aria-label="${formatDate(d,{weekday:'long',day:'numeric',month:'long'})}" aria-pressed="${d===state.date}">${name}<strong>${Number(d.slice(-2))}</strong><span class="day-dot ${currentLessons(d).length?'':'empty'}"></span></button>`;}).join('')}</div>
  ${statusLine()}${state.error?`<div class="error-panel">${state.loaded?'Показаны сохранённые данные. Изменения пар пока проверить не удалось.':'Для этой группы ещё нет сохранённого расписания.'} ${btn('Открыть источник '+icon('external'),'schedule-source','text-button')}</div>`:''}
  ${!state.loaded?(state.busy?'<div class="skeleton" aria-label="Загрузка расписания"></div>':empty('Нужно первое обновление','Подключитесь к интернету и загрузите расписание.','offline','refresh','Попробовать снова')):state.scheduleView==='day'?`<h2 class="day-heading">${formatDate(state.date,{weekday:'long',day:'numeric',month:'long'})}</h2>${list.length?lessonList(list,state.date):empty('Пар не запланировано','В загруженном расписании этот день свободен.','sun')}`:shortDays.map((_,i)=>{const d=addDays(mon,i),items=currentLessons(d);return `<section class="week-day"><h2 class="week-day-title">${formatDate(d,{weekday:'long',day:'numeric'})}<span>${items.length?items.length+' '+declension(items.length,['занятие','занятия','занятий']):'Без пар'}</span></h2>${items.length?lessonList(items,d):'<p class="subtle">Свободный день</p>'}</section>`;}).join('')}
  <p class="events-note">${btn('Сверить с расписанием УУНиТ '+icon('external'),'schedule-source','text-button')}<br>Учитываются учебные недели из источника. Изменения занятий появятся после обновления.</p>`;
}
function mapSvg(selected,mini=false){
  return `<svg class="campus-map" ${mini?'':'id="campus-map"'} viewBox="130 100 1450 730" role="group" aria-label="Схема корпусов кампуса УУНиТ на улице Карла Маркса"><defs><pattern id="${mini?'mini':'main'}-grid" width="45" height="45" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.5" fill="#b7c5aa" opacity=".5"/></pattern></defs><rect x="-500" y="-500" width="3000" height="2200" fill="url(#${mini?'mini':'main'}-grid)"/><g class="roads" fill="#dbe3d3"><rect x="60" y="60" width="1600" height="60" rx="20"/><rect x="67" y="40" width="64" height="870" rx="20"/><rect x="1582" y="40" width="64" height="870" rx="20"/></g><text class="map-road" x="770" y="101" text-anchor="middle">УЛИЦА КАРЛА МАРКСА</text><text class="map-road" transform="translate(110 650) rotate(-90)">ПУШКИНА</text><text class="map-road" transform="translate(1626 600) rotate(-90)">КОММУНИСТИЧЕСКАЯ</text>
  <g>${state.data.buildings.map(b=>`<path class="building-path ${b.id===selected?'selected':''}" d="${b.path}" ${mini?'':`data-building="${b.id}" tabindex="0" role="button" aria-label="Корпус ${b.id}" aria-pressed="${b.id===selected}"`}/>`).join('')}</g>
  ${state.data.buildings.map(b=>`<g ${mini?'':`data-building="${b.id}"`} class="map-marker"><circle cx="${b.center[0]}" cy="${b.center[1]}" r="${b.id===selected?54:43}" fill="${b.id===selected?'#dbf68b':'#f9fbf4'}" stroke="${b.id===selected?'#173b32':'#a6b993'}" stroke-width="3"/><text class="map-label ${b.id===selected?'selected':''}" x="${b.center[0]}" y="${b.center[1]}">${b.id}</text></g>`).join('')}
  <g fill="#7a8e6a"><path d="M813 422l21 12 28-2 4 6-24 6-12 25-5-1 3-25-21-13z"/><text x="868" y="463" font-size="17" letter-spacing="3" fill="#93a184">КАМПУС УУНИТ</text></g></svg>`;
}
function buildingCard(b){return `<article class="place-card">${b.photo?`<img class="place-photo" src="${attrs(b.photo)}" alt="${escape(b.name)} — фотография из материалов команды">`:''}<div class="place-body"><div class="row between"><h2>${b.name}</h2><span class="chip">На схеме</span></div><p class="subtle">${b.address}</p>${state.mapContext?.buildingId===b.id?`<div class="insight compact">${icon('pin')}<div><strong>${escape(state.mapContext.room||state.mapContext.place||'Место события')}</strong><p>${escape(state.mapContext.title)}</p></div></div>`:''}<p class="description">${b.description}</p><div class="place-actions">${btn(`${icon('external')} В городских картах`,'building-external','button light',`data-id="${b.id}"`)}${btn(icon('heart'), 'save-place',`button outline ${state.savedPlaces.includes(b.id)?'favorite-on':''}`,`data-id="${b.id}" aria-label="${state.savedPlaces.includes(b.id)?'Убрать из':'Добавить в'} избранные места" aria-pressed="${state.savedPlaces.includes(b.id)}"`)}</div></div></article>`;}
function mapPage(){const b=state.data.buildings.find(x=>x.id===state.mapId)||state.data.buildings[0],results=searchBuildings(state.data.buildings,state.mapQuery);return `${pageHeading('Знакомое место','Твой кампус','Карла Маркса, 12 · схема корпусов')}<label class="search-field">${icon('search')}<input id="building-search" placeholder="Найти корпус, например: корпус 3" value="${attrs(state.mapQuery)}" autocomplete="off" aria-label="Найти корпус"></label>
  <div id="building-results">${buildingResults(results)}</div><div class="map-frame"><span class="map-badge">СХЕМА · БЕЗ ГЕОПРИВЯЗКИ</span>${mapSvg(b.id)}<div class="map-controls">${iconBtn('plus','Увеличить карту','zoom-in')}${iconBtn('minus','Уменьшить карту','zoom-out')}${iconBtn('focus','Показать весь кампус','zoom-reset')}</div></div><p class="map-caption">Перемещай и увеличивай схему. Нажми на корпус.</p>${buildingCard(b)}
  <div class="insight compact">${icon('info')}<p>Маршрут до входа пока не проверен. Для подхода к кампусу открой городскую карту; внутри территории ориентируйся по указателям.</p></div>${section('Все корпуса')}<div class="building-grid">${state.data.buildings.map(x=>btn(x.name,'select-building',`building-button ${x.id===b.id?'active':''}`,`data-id="${x.id}"`)).join('')}</div>${btn('Открыть исходную схему '+icon('external'),'original-map','text-button')}`;}
function buildingResults(results){if(!state.mapQuery)return '';return `<div class="map-result-summary">${results.length?'Найдено: '+results.length:'Корпус не найден. Попробуйте номер от 1 до 9.'}</div><div class="filters" style="margin-top:8px;margin-bottom:4px">${results.map(b=>btn(b.name,'select-building','filter',`data-id="${b.id}"`)).join('')}</div>`;}
function cover(e){return `<div class="event-cover ${e.accent}"><span class="eyebrow">${escape(e.category)} · УУНиТ</span><span class="cover-index">${e.date.slice(8)} / ${e.date.slice(5,7)}</span><div class="cover-title">${e.id.startsWith('kod-uust')?'КОД<br>УУНИТ':e.accent==='blue'?'В ДВИЖЕНИИ':escape(e.title.split(':')[0]).slice(0,35)}</div><span class="orbit"></span><span class="orbit"></span><span class="orbit"></span><span class="orb"></span></div>`;}
function eventCard(e){const fit=eventCompatibility(e,state.rows,state.loaded,state.data.config),saved=state.favorites.includes(e.id);return `<article class="event-card"><button class="event-open" data-event="${attrs(e.id)}" aria-label="Подробнее: ${attrs(e.title)}">${cover(e)}<div class="event-body"><div class="row">${e.demo?'<span class="chip demo">Демонстрация</span>':''}<span class="eyebrow">${formatDate(e.date,{day:'numeric',month:'long'})} · ${e.time||'Время уточняется'}</span></div><h3>${escape(e.title)}</h3><p>${escape(e.place||'Место уточняется')}</p></div></button><div class="event-body" style="padding-top:0"><div class="event-bottom" style="margin-top:0"><span class="chip ${fit.kind}">${icon(fit.kind==='free'?'check':fit.kind==='conflict'?'clock':'info','small-icon')}${fit.kind==='unknown'?'Время или расписание уточняется':fit.label}</span>${btn(icon('heart'),'favorite',`icon-button ${saved?'favorite-on':''}`,`data-id="${attrs(e.id)}" aria-label="${saved?'Убрать событие из':'Сохранить событие в'} избранного" aria-pressed="${saved}"`)}</div></div></article>`;}
function eventsPage(){
  let events=state.data.events.filter(e=>state.eventFilter==='past'?e.date<dateKey():e.date>=dateKey());
  if(state.eventFilter==='saved')events=state.data.events.filter(e=>state.favorites.includes(e.id));
  if(state.eventFilter==='free')events=events.filter(e=>eventCompatibility(e,state.rows,state.loaded,state.data.config).kind==='free');
  return `${pageHeading('Больше, чем учёба','Жизнь кампуса','Встречи, идеи и люди рядом.')}<div class="filters" aria-label="Фильтры событий">${[['all','Впереди'],['free','Без пересечений'],['saved','Избранное'],['past','Прошедшие']].map(([id,name])=>btn(name,'filter-events',`filter ${state.eventFilter===id?'active':''}`,`data-id="${id}" aria-pressed="${state.eventFilter===id}"`)).join('')}</div>
  ${state.eventFilter==='free'?`<div class="insight compact">${icon('spark')}<p>Сравниваем время событий с ${state.source==='live'?'загруженным':'сохранённым'} расписанием ${escape(group().title)}. Время на дорогу не учтено.</p></div>`:''}
  <div class="event-list">${events.length?events.map(eventCard).join(''):empty(state.eventFilter==='saved'?'Сохраняй то, что интересно':'Подходящих событий пока нет',state.eventFilter==='saved'?'Нажми на сердечко у события, чтобы вернуться к нему позже.':'Другие встречи доступны во вкладке «Впереди». Для части событий время ещё не опубликовано.','spark')}</div>
  <p class="events-note">Подборка обновлена ${escape(state.data.eventsUpdated)}. Даты взяты из текста анонсов. Перед посещением проверь условия у организатора.</p>${btn('Все объявления УУНиТ '+icon('external'),'all-events','text-button')}`;
}
function setting(ico,title,description,action){return `<button class="setting" data-action="${action}">${icon(ico)}<span><strong>${title}</strong><small>${description}</small></span>${icon('chevron')}</button>`;}
function profile(){const g=group();return `${pageHeading('Всё на своих местах','Твой профиль')}<section class="profile-hero"><span class="avatar">${escape(g.title.split('-')[0].slice(0,2))}</span><div><h2>${escape(g.title)}</h2><p>${escape([g.faculty,g.course?g.course+' курс':'',g.city].filter(Boolean).join(' · '))}</p></div></section>
  <div class="settings-list">${setting('user','Учебная группа',escape(g.title)+' · можно изменить','groups')}${setting('heart','Сохранённые места',state.savedPlaces.length+' '+declension(state.savedPlaces.length,['корпус','корпуса','корпусов']),'saved-places')}${setting('spark','Избранные события',state.favorites.length+' '+declension(state.favorites.length,['событие','события','событий']),'saved-events')}</div>
  ${section('Данные и настройки')}<div class="settings-list">${setting('refresh','Обновить расписание',state.at?'Последняя загрузка: '+formatDate(dateKey(new Date(state.at))):'Для выбранной группы','refresh')}${setting('download','Импорт мероприятий','Обновить подборку из JSON-файла','import')}${setting('globe','Источники и точность','Откуда пары, события и карта','sources')}${setting('shield','Локальный профиль','Группа и избранное хранятся на устройстве','privacy')}</div>
  <div class="profile-note">Время Уфы · UTC+5<br>Карта доступна без интернета. Загруженное расписание сохраняется отдельно для каждой группы. Регистрация не требуется.</div><div class="version">КАМПУС УУНИТ · 0.1.0<br>Сделано для студенческого хакатона</div>`;}
function groupResults(){const matches=searchGroups(state.data.groups,state.groupQuery);return matches.length?matches.map(g=>`<button class="group-result ${state.selectedGroup?.id===g.id?'active':''}" data-pick-group="${g.id}"><span class="group-avatar">${escape(g.title.slice(0,2))}</span><span><strong>${escape(g.title)}</strong><small>${escape([g.faculty,g.course?g.course+' курс':'',g.city].filter(Boolean).join(' · '))}</small></span>${state.selectedGroup?.id===g.id?icon('check'):icon('chevron')}</button>`).join(''):`<div class="empty-state"><h3>Группа не найдена</h3><p>Попробуйте часть названия. Список содержит ${state.data.groups.length} групп из источника.</p>${btn('Обновить список','refresh-groups','text-button')}</div>`;}
function groupPicker(){return `<label class="search-field">${icon('search')}<input id="group-search" type="search" placeholder="Введите учебную группу" value="${attrs(state.groupQuery)}" autocomplete="off" aria-label="Поиск учебной группы"></label><div class="group-results" id="group-results">${groupResults()}</div>${btn(state.profile?'Сохранить группу '+icon('check'):'Это моя группа '+icon('arrow'),'save-group','button wide',`id="save-group" ${state.selectedGroup?'':'disabled'}`)}`;}
function onboarding(){return `<main class="intro"><div class="topbar">${wordmark()}<span class="step-number">ДОБРО ПОЖАЛОВАТЬ</span></div><section class="intro-hero"><div class="eyebrow">Твой помощник в университете</div><h1>Учёба ближе.<br>Кампус понятнее.</h1><p>Пары, корпуса и всё интересное вокруг — в одном месте.</p><div class="intro-map">${mapSvg('1',true)}</div></section><div class="intro-step"><h2>Начнём с группы</h2><span class="step-number">01 / 01</span></div><p class="intro-description">Выбери свою — мы соберём твой учебный день.</p>${groupPicker()}<div class="intro-foot"><div class="privacy">${icon('shield')}Без регистрации. Выбор останется на устройстве.</div></div></main>`;}
function render(){
  const scroll=window.scrollY;
  $('#app').innerHTML=`<div class="app-shell">${!state.profile?onboarding():topbar()+`<main class="content" id="main-content">${({home,schedule,map:mapPage,events:eventsPage,profile}[state.tab])()}</main>`+nav()}</div>`;
  if(state.tab==='map'&&state.profile)bindMap();
  window.scrollTo(0,scroll);
}
function navigate(tab){closeModal();state.tab=tab;render();window.scrollTo(0,0);}
function showModal(kind,payload){returnFocus=document.activeElement;state.modal={kind,payload};renderModal();document.body.classList.add('no-scroll');setTimeout(()=>$('#modal-root [data-action="close"]')?.focus(),30);}
function closeModal(){state.modal=null;$('#modal-root').innerHTML='';document.body.classList.remove('no-scroll');if(returnFocus?.isConnected)returnFocus.focus();}
function modalFrame(label,body){return `<div class="modal-overlay" data-overlay><section class="modal" role="dialog" aria-modal="true" aria-label="${attrs(label)}"><div class="modal-handle"></div><div class="modal-header"><span class="eyebrow">${label}</span>${iconBtn('close','Закрыть','close')}</div>${body}</section></div>`;}
function detailRow(ico,title,sub=''){return `<div class="detail-row">${icon(ico)}<div><strong>${escape(title)}</strong>${sub?`<small>${escape(sub)}</small>`:''}</div></div>`;}
function renderModal(){
  if(!state.modal)return;
  const {kind,payload}=state.modal;let body='',label='';
  if(kind==='lesson'){
    const l=payload;label='Твоя пара';
    body=`${tag(l.type)}<h1>${escape(l.subject)}</h1>${detailRow('calendar',formatDate(l.date,{weekday:'long',day:'numeric',month:'long'}),`${academicWeek(l.date,state.data.config)}-я учебная неделя`)}${detailRow('clock',l.start===null?'Время уточняется':`${clock(l.start)}–${clock(l.end)}`,'Время Уфы · UTC+5')}${detailRow('user',l.teacher||'Преподаватель не указан')}${detailRow('pin',l.room||'Аудитория не указана',l.buildingTitle||'Место уточняется')}${l.comment?`<p>${escape(l.comment)}</p>`:''}${!l.buildingId?'<div class="insight compact">'+icon('info')+'<p>Это место пока не сопоставлено со схемой кампуса. Сверьтесь с исходным адресом и указателями университета.</p></div>':''}<div class="modal-actions">${l.buildingId?btn('Показать корпус '+l.buildingId+' '+icon('map'),'lesson-map','button wide'):''}${l.start!==null?btn(icon('bell')+' Добавить в календарь','lesson-calendar','button light wide'):''}${btn('Расписание в источнике '+icon('external'),'schedule-source','button outline wide')}</div><p class="source-line">Данные: schedule.uust.ru · ${state.source==='live'?'загруженная версия':'сохранённая версия'}. Изменения проверяются при обновлении.</p>`;
  } else if(kind==='event'){
    const e=state.data.events.find(e=>e.id===payload);if(!e){closeModal();return;}
    const fit=eventCompatibility(e,state.rows,state.loaded,state.data.config);label=e.demo?'Демонстрационное событие':'Жизнь кампуса';
    body=`${cover(e)}<h1>${escape(e.title)}</h1>${detailRow('calendar',formatDate(e.date,{day:'numeric',month:'long',year:'numeric'}),e.time?`${e.time}${e.endTime?'–'+e.endTime:''} · время Уфы`:'Время начала не опубликовано')}${detailRow('pin',e.place||'Место уточняется')}
    <div class="insight compact">${icon(fit.kind==='free'?'check':'info')}<div><h3>${fit.label}</h3><p>${fit.kind==='conflict'?fit.lessons.map(l=>escape(l.subject)+' · '+clock(l.start)+'–'+clock(l.end)).join('<br>'):fit.kind==='free'?'Сравнено с загруженным расписанием. Время на дорогу не учтено.':'Для точного сравнения нужны начало и конец события, а также расписание на этот день.'}</p></div></div><p>${escape(e.description)}</p>
    <div class="modal-actions">${e.buildingId?btn('К корпусу '+e.buildingId+' '+icon('arrow'),'event-map','button wide'):''}${btn(icon('heart')+(state.favorites.includes(e.id)?' В избранном':' Сохранить событие'),'favorite',`button ${state.favorites.includes(e.id)?'light':'outline'} wide`,`data-id="${attrs(e.id)}"`)}${e.time&&e.endTime?btn(icon('bell')+' Добавить в календарь','event-calendar','button light wide'):''}${e.source?btn('Условия участия и регистрация '+icon('external'),'event-source','button outline wide'):''}</div><p class="source-line">${escape(e.sourceLabel)}${e.imported?' · данные добавлены командой':'. Редакционная подборка по официальному анонсу.'}</p>`;
  } else if(kind==='groups'){label='Учебная группа';body='<h1>Твой учебный ритм</h1><p>Начни вводить название и выбери группу из списка университета.</p>'+groupPicker();}
  else if(kind==='saved-places'){label='Избранные места';const places=state.data.buildings.filter(b=>state.savedPlaces.includes(b.id));body='<h1>Знакомые места</h1>'+ (places.length?`<div class="saved-list">${places.map(b=>setting('pin',b.name,b.address,'saved-place-'+b.id)).join('')}</div>`:empty('Сохрани первый корпус','Нажми на сердечко в карточке корпуса на карте.','map'));}
  else if(kind==='import'){label='Обновление подборки';body=`<h1>События от команды</h1><p>Выбери JSON-файл с мероприятиями. Он заменит текущую подборку на этом устройстве. Названия и даты проверим до сохранения.</p><label class="field-label" for="events-file">Файл мероприятий</label><input id="events-file" type="file" accept=".json,application/json"><div id="import-result"></div><p class="source-line">Формат: schemaVersion: 1 и массив events. Шаблон и инструкция находятся в исходном проекте. Импорт будет подписан «Импорт команды».</p>${btn('Вернуть подборку УУНиТ','restore-events','button light wide')}`;}
  else if(kind==='privacy'){label='Приватность';body=`<h1>Только нужное</h1>${detailRow('shield','Без аккаунта','Мы не запрашиваем имя, телефон или почту.')}${detailRow('user','Локальное хранение','Группа, избранное и расписание сохраняются внутри приложения.')}${detailRow('globe','Обновление расписания','Сервису расписания передаётся идентификатор выбранной группы. Сервер источника видит обычные сетевые метаданные запроса.')}${detailRow('map','Без разрешения на GPS','Схема не привязана к координатам. Доступ к геолокации не запрашивается.')}${detailRow('calendar','Календарь по твоему выбору','Открываем форму события в приложении календаря. Сохранение и напоминание подтверждаешь там.')}`;}
  else if(kind==='original-map'){label='Материалы команды';body='<h1>Исходная схема</h1><img src="assets/original-map.jpg" alt="Исходная схема расположения корпусов из архива команды" style="width:100%;border-radius:18px"><p>Из этой схемы взяты взаимное расположение корпусов и их контуры. Обозначенные в исходнике входы не проверены на местности.</p>';}
  else if(kind==='sources'){label='Источники и ограничения';body=`<h1>За каждой карточкой — источник</h1><div class="sources-list"><article class="source-item"><h3>Расписание</h3><p>Публичный JSON-интерфейс сервиса schedule.uust.ru. Учебный год 2026/2027, идентификатор 241. Первая учебная неделя начинается 31 августа 2026. ТОП-106Б: 14381. Данные обновляются при запуске и вручную.</p>${btn('Открыть сервис '+icon('external'),'schedule-source','text-button')}</article><article class="source-item"><h3>Кампус</h3><p>Контуры и фотографии из архива ugatu_interactive_map_1.rar команды. Схема показывает взаимное расположение корпусов, не географические координаты. Входы, проходы и доступность предстоит проверить.</p></article><article class="source-item"><h3>События</h3><p>Редакционная подборка по официальным объявлениям uust.ru. В каждой карточке есть ссылка. Автоматического обновления афиши нет: команда может импортировать JSON без изменения экранов.</p>${btn('Объявления УУНиТ '+icon('external'),'all-events','text-button')}</article><article class="source-item"><h3>О приложении</h3><p>Студенческий проект для хакатона. Не является официальным приложением университета. Не все площадки УУНиТ входят в схему на Карла Маркса.</p></article></div>`;}
  $('#modal-root').innerHTML=modalFrame(label,body);
}
async function refresh(){
  if(!group()||state.busy)return;
  const ticket=++state.request,id=group().id;state.busy=true;state.error=null;render();
  try {const result=await refreshSchedule(id,state.data.config);if(ticket!==state.request || group().id!==id)return;Object.assign(state,result);if(result.persisted===false)toast('Расписание загружено, но память устройства заполнена');}
  catch(e){if(ticket!==state.request)return;state.error=e.message||'Не удалось обновить';}
  finally{if(ticket===state.request){state.busy=false;render();if(state.modal?.kind==='event'||state.modal?.kind==='lesson')renderModal();}}
}
function openBuilding(id,context=null){state.mapId=id;state.mapContext=context;state.mapQuery='';state.mapZoom=1;state.mapView=null;navigate('map');}
function calendar(item){
  if(!item.date || item.start===null || item.end===null)return;
  const start=ufaTimestamp(item.date,typeof item.start==='number'?clock(item.start):item.start),end=ufaTimestamp(item.date,typeof item.end==='number'?clock(item.end):item.end);
  const details={title:item.title||item.subject,location:item.location||item.buildingTitle||'',description:item.description||'Расписание УУНиТ · '+group().title,start,end};
  if(window.CampusAndroid){window.CampusAndroid.addCalendar(JSON.stringify(details));return;}
  const stamp=n=>new Date(n).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const icsEscape=s=>String(s).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const text=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//UUST Campus//RU','BEGIN:VEVENT',`UID:${Date.now()}@campus.local`,`DTSTAMP:${stamp(Date.now())}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(end)}`,`SUMMARY:${icsEscape(details.title)}`,`LOCATION:${icsEscape(details.location)}`,`DESCRIPTION:${icsEscape(details.description)}`,'END:VEVENT','END:VCALENDAR'].join('\r\n');
  const url=URL.createObjectURL(new Blob([text],{type:'text/calendar;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='campus-event.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);toast('Файл для календаря сохранён');
}
async function action(name,el){
  const next=()=>nextLesson(state.rows,new Date(),state.data.config);
  const event=()=>state.data.events.find(e=>e.id===state.modal?.payload);
  if(['home','schedule','map','events','profile'].includes(name)){navigate(name);return;}
  if(name==='close'){closeModal();return;}
  if(name==='groups'){state.groupQuery=group()?.title||'ТОП-106Б';state.selectedGroup=group();showModal('groups');return;}
  if(name==='save-group'){
    if(!state.selectedGroup)return;state.profile={group:state.selectedGroup};if(!storage.write('profile',state.profile))toast('Не удалось сохранить профиль на устройстве');
    state.request++;state.busy=false;state.error=null;Object.assign(state,loadSavedSchedule(group().id,state.data));state.date=dateKey();navigate('home');refresh();return;
  }
  if(name==='refresh'){refresh();return;}
  if(name==='refresh-groups'){el.disabled=true;try{state.data.groups=await refreshGroups();$('#group-results').innerHTML=groupResults();toast('Список групп обновлён');}catch{toast('Источник недоступен. Используем сохранённый список.');el.disabled=false;}return;}
  if(name==='next-map'){const l=next();if(l?.buildingId)openBuilding(l.buildingId,{...l,title:l.subject});return;}
  if(name==='next-detail'){const l=next();if(l)showModal('lesson',l);return;}
  if(name==='next-calendar'){const l=next();if(l)calendar(l);return;}
  if(name==='today'){state.date=dateKey();render();return;}
  if(name.startsWith('view-')){state.scheduleView=name==='view-day'?'day':'week';render();return;}
  if(name==='week-prev'||name==='week-next'){const nextDate=addDays(state.date,name==='week-prev'?-7:7);if(nextDate<state.data.config.academicStart)state.date=state.data.config.academicStart;else if(nextDate>state.data.config.academicEnd)state.date=state.data.config.academicEnd;else state.date=nextDate;render();return;}
  if(name==='select-building'){state.mapId=el.dataset.id;state.mapView=null;state.mapZoom=1;render();return;}
  if(name==='building-external'){const b=state.data.buildings.find(b=>b.id===el.dataset.id);external('https://yandex.ru/maps/?text='+encodeURIComponent(`УУНиТ Уфа Карла Маркса 12 ${b.name}`));return;}
  if(name==='save-place'){const id=el.dataset.id;state.savedPlaces=state.savedPlaces.includes(id)?state.savedPlaces.filter(x=>x!==id):[...state.savedPlaces,id];storage.write('places',state.savedPlaces);render();return;}
  if(name.startsWith('zoom-')){updateZoom(name==='zoom-in'?1.4:name==='zoom-out'?1/1.4:0);return;}
  if(name==='filter-events'){state.eventFilter=el.dataset.id;render();return;}
  if(name==='favorite'){const id=el.dataset.id;state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];storage.write('favorites',state.favorites);render();if(state.modal)renderModal();return;}
  if(name==='saved-events'){state.eventFilter='saved';navigate('events');return;}
  if(name.startsWith('saved-place-')){openBuilding(name.replace('saved-place-',''));return;}
  if(['sources','privacy','import','saved-places','original-map'].includes(name)){showModal(name);return;}
  if(name==='schedule-source'){external(`https://schedule.uust.ru/schedule?type=0&id=${group()?.id||14381}`);return;}
  if(name==='all-events'){external('https://uust.ru/events/');return;}
  if(name==='lesson-map'){const l=state.modal.payload;openBuilding(l.buildingId,{...l,title:l.subject});return;}
  if(name==='lesson-calendar'){calendar(state.modal.payload);return;}
  if(name==='event-map'){const e=event();openBuilding(e.buildingId,{...e,room:e.place});return;}
  if(name==='event-calendar'){const e=event();calendar({...e,start:e.time,end:e.endTime,location:e.place,description:e.source});return;}
  if(name==='event-source'){external(event().source);return;}
  if(name==='restore-events'){storage.remove('events');state.data.events=validateEvents(state.data.bundledEvents);state.data.eventsUpdated=state.data.bundledEvents.updatedAt;closeModal();render();toast('Подборка УУНиТ восстановлена');}
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
  if(el.dataset.building){if(mapDragged){mapDragged=false;return;}state.mapId=el.dataset.building;render();}
});
document.addEventListener('input',e=>{
  if(e.target.id==='group-search'){state.groupQuery=e.target.value;state.selectedGroup=null;$('#group-results').innerHTML=groupResults();$('#save-group').disabled=true;}
  if(e.target.id==='building-search'){state.mapQuery=e.target.value;$('#building-results').innerHTML=buildingResults(searchBuildings(state.data.buildings,state.mapQuery));}
});
document.addEventListener('change',async e=>{
  if(e.target.id==='schedule-date'){if(e.target.value&&e.target.validity.valid){state.date=e.target.value;render();}return;}
  if(e.target.id==='events-file'){
    const file=e.target.files[0];if(!file)return;
    try{if(file.size>512*1024)throw new Error('Файл больше 512 КБ');const payload=JSON.parse(await file.text()),events=validateEvents(payload,true);const saved={...payload,updatedAt:dateKey()};if(!storage.write('events',saved))throw new Error('Недостаточно места для сохранения');state.data.events=events;state.data.eventsUpdated=saved.updatedAt;closeModal();state.eventFilter='all';navigate('events');toast(`Импортировано событий: ${events.length}`);}
    catch(error){$('#import-result').innerHTML=`<div class="error-panel" role="alert">Импорт не выполнен. ${escape(error.message)}</div>`;}
  }
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&state.modal){closeModal();return;}
  if((e.key==='Enter'||e.key===' ')&&e.target.matches('[data-building]')){e.preventDefault();state.mapId=e.target.dataset.building;render();}
  if(e.key==='Tab'&&state.modal){const focusable=[...document.querySelectorAll('.modal button:not([disabled]),.modal input,.modal a[href]')];const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
});
let mapDragged=false;
function updateZoom(factor){
  if(factor===0){state.mapZoom=1;state.mapView=[130,100,1450,730];}
  else{const old=state.mapView||[130,100,1450,730],zoom=Math.max(.85,Math.min(3.5,state.mapZoom*factor)),ratio=state.mapZoom/zoom;state.mapZoom=zoom;state.mapView=[old[0]+old[2]*(1-ratio)/2,old[1]+old[3]*(1-ratio)/2,old[2]*ratio,old[3]*ratio];}
  $('#campus-map')?.setAttribute('viewBox',state.mapView.join(' '));
}
function bindMap(){
  const svg=$('#campus-map');if(!svg)return;
  if(state.mapView)svg.setAttribute('viewBox',state.mapView.join(' '));
  const pointers=new Map();let last=null,baseDistance=0,tapBuilding=null;
  svg.addEventListener('pointerdown',e=>{mapDragged=false;tapBuilding=e.target.closest('[data-building]')?.dataset.building;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});last={x:e.clientX,y:e.clientY};svg.setPointerCapture(e.pointerId);if(pointers.size===2){const p=[...pointers.values()];baseDistance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);}});
  svg.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const point={x:e.clientX,y:e.clientY};pointers.set(e.pointerId,point);
    if(pointers.size===2){const p=[...pointers.values()],distance=Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);if(baseDistance>0)updateZoom(distance/baseDistance);baseDistance=distance;mapDragged=true;return;}
    if(last){const dx=e.clientX-last.x,dy=e.clientY-last.y;if(Math.abs(dx)+Math.abs(dy)>2){mapDragged=true;const v=state.mapView||[130,100,1450,730],rect=svg.getBoundingClientRect(),scale=Math.max(v[2]/rect.width,v[3]/rect.height);state.mapView=[Math.max(-350,Math.min(1500,v[0]-dx*scale)),Math.max(-300,Math.min(900,v[1]-dy*scale)),v[2],v[3]];svg.setAttribute('viewBox',state.mapView.join(' '));last=point;}}
  });
  const release=e=>{const picked=!mapDragged&&pointers.size===1&&tapBuilding&&e.type==='pointerup';pointers.delete(e.pointerId);last=pointers.size?[...pointers.values()][0]:null;try{svg.releasePointerCapture(e.pointerId);}catch{};if(picked){state.mapId=tapBuilding;render();}setTimeout(()=>{mapDragged=false;},100);};
  svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);
  svg.addEventListener('wheel',e=>{e.preventDefault();updateZoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
}
window.campusBack=()=>{if(state.modal){closeModal();return true;}if(state.tab!=='home'){navigate('home');return true;}return false;};
async function boot(){
  try{
    state.data=await initialData();
    if(state.profile?.group && !state.data.groups.some(g=>g.id===state.profile.group.id))state.profile=null;
    if(!state.profile?.group)state.profile=null;
    state.selectedGroup=state.profile?.group||state.data.groups.find(g=>g.id===14381);
    if(group())Object.assign(state,loadSavedSchedule(group().id,state.data));
    render();if(group())refresh();
    refreshGroups().then(groups=>{state.data.groups=groups;}).catch(()=>{});
  }catch(error){$('#app').innerHTML=`<div class="boot"><span class="brand-symbol">к.</span><h1>Не удалось открыть приложение</h1><p>${escape(error.message)}</p><p>Перезапустите приложение. Если ошибка повторяется, установите APK заново.</p></div>`;}
}
window.addEventListener('online',()=>{if(group()&&!state.busy)refresh();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.data&&group()){render();if(!state.at||Date.now()-Date.parse(state.at)>15*60*1000)refresh();}});
// Re-evaluate the nearest class at a minute boundary without interrupting dialogs or typing.
setInterval(()=>{if(state.data&&state.profile&&state.tab==='home'&&!state.modal&&document.visibilityState==='visible')render();},60000);
boot();
