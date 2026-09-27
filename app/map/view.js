import {createMapData, validateMapPack} from './data.js';
import {searchPlaces, resolvePlace} from './search.js';
import {findRoute, routeSteps} from './routing.js';
import {campusSvg, floorSvg, campusBox, campusPoint, esc} from './svg.js';
import {bindGestures} from './gestures.js';
import {icon} from '../icons.js';

const button=(label,action,extra='',cls='map-button')=>`<button class="${cls}" data-map-action="${action}" ${extra}>${label}</button>`;
const iconButton=(name,label,action)=>button(icon(name),action,`aria-label="${label}" title="${label}"`,'map-icon-button');
export function createMapController({buildings,bundledPack,storage,external,onFavorite,isFavorite,testMode=false}) {
  let data, pack=bundledPack, error='';
  try {pack=storage.read('maps')||bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});}
  catch {pack=bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});error='Сохранённый набор карт повреждён. Открыта встроенная схема.';}
  const s={selected:null,floorId:null,query:'',filter:'all',expanded:false,context:null,exact:false,route:null,startId:'',targetId:'',planning:false,stepFree:false,panel:false,pending:null,error,searching:false,camera:null,sourcePlan:false};
  let root=null,gestures=null,resize=null;
  const selected=()=>data.locations.find(l=>l.id===s.selected);
  const floor=()=>data.floors.find(f=>f.id===s.floorId);
  const subtitle=l=>[buildings.find(b=>b.id===l.buildingId)?.name,data.floors.find(f=>f.id===l.floorId)?.name].filter(Boolean).join(' · ');
  const availableFloors=()=>data.floors.filter(f=>f.buildingId===selected()?.buildingId).sort((a,b)=>a.order-b.order);
  const routePlaces=()=>data.locations.filter(l=>l.nodeId && l.buildingId===data.locations.find(x=>x.id===s.targetId)?.buildingId);
  function setView(floorId, point=null) {
    s.floorId=floorId;const base=floor()?.viewBox||campusBox;s.camera={base:[...base],box:[...base],fit:true};
    if(point){const w=base[2]*.75,h=base[3]*.75;s.camera.box=[point[0]-w/2,point[1]-h/2,w,h];}
    else if(s.route && floorId) {
      const nodes=new Map(data.nodes.map(n=>[n.id,n]));
      const points=s.route.links.filter(l=>nodes.get(l.from).floorId===floorId && nodes.get(l.to).floorId===floorId).flatMap(l=>l.edge.geometry);
      if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);s.camera.box=[Math.min(...xs)-65,Math.min(...ys)-80,Math.max(200,Math.max(...xs)-Math.min(...xs)+130),Math.max(160,Math.max(...ys)-Math.min(...ys)+160)];}
    }
  }
  function choose(id,{context=null,exact=false}={}) {
    const l=data.locations.find(l=>l.id===id);if(!l){s.error='Место не найдено в текущем наборе карт.';draw();return;}
    s.selected=id;s.context=context;s.exact=exact;s.query='';s.searching=false;s.error='';s.panel=false;s.expanded=false;s.route=null;s.planning=false;
    setView(l.floorId,l.floorId?l.point:campusPoint(l.point));draw();
  }
  function results() {
    if(!s.query && !s.searching)return '';
    const list=searchPlaces(data,s.query,selected()?.buildingId,s.filter);
    return `<section class="map-results" aria-label="Результаты поиска"><div class="map-results-heading" role="status">${list.length?`Найдено: ${list.length}`:'Ничего не найдено'}${button('Закрыть','search-close','','map-text-button')}</div>${list.length?list.slice(0,100).map(l=>`<button class="map-search-result" data-map-pick="${esc(l.id)}"><span class="map-result-icon">${icon(l.type==='building'?'map':'pin')}</span><span><strong>${esc(l.name)}</strong><small>${esc(subtitle(l))}${l.type==='building'?' · схема территории':''}</small></span>${icon('chevron')}</button>`).join(''):`<div class="map-search-empty">Уточните корпус или название. Например: «3 корпус 412».<p>Поиск находит только размеченные объекты. Сейчас подключено этажей: ${data.floors.length}.</p></div>`}${list.length>100?'<p>Уточните запрос, чтобы увидеть остальные результаты.</p>':''}</section>`;
  }
  function routeCard() {
    const target=data.locations.find(l=>l.id===s.targetId);
    if(!target)return '';
    const routeOptions=routePlaces().map(l=>`<option value="${esc(l.id)}" ${l.id===s.startId?'selected':''}>${esc(l.name)} · ${esc(data.floors.find(f=>f.id===l.floorId)?.name)}</option>`).join('');
    const steps=routeSteps(data,s.route);
    const start=data.locations.find(l=>l.id===s.startId), transition=steps.find(step=>step.nextFloorId && step.floorId===s.floorId);
    return `<div class="map-route-head"><span class="map-kicker">${data.verification==='archive'?'ПО АРХИВНОМУ ПЛАНУ':'МАРШРУТ ПО ПЛАНУ'}</span>${button('Закрыть','route-close','','map-text-button')}</div><h2>К ${esc(target.name)}</h2><p class="map-muted">${esc(subtitle(target))}</p><details class="map-route-settings" ${s.route?'':'open'}><summary>${s.route?`Старт: ${esc(start?.name)} · изменить`:'Выберите начальную точку'}</summary><label class="map-field">Откуда вы начнёте<select id="map-route-start"><option value="">Выберите известную точку</option>${routeOptions}</select></label><label class="map-checkbox"><input id="map-step-free" type="checkbox" ${s.stepFree?'checked':''}> Только проверенные проходы без ступеней</label></details>${s.route?`<div class="map-route-note">А — выбранный старт · Б — цель<br>${data.verification==='archive'?'Проходы взяты из архивной схемы, на месте не проверены. ':''}Перемещение не отслеживается.</div>${transition?button(esc(transition.text)+' →','route-floor',`data-floor="${esc(transition.nextFloorId)}"`,'map-button map-next-floor'):''}<ol class="map-steps">${steps.map((step,i)=>`<li><span class="map-step-number">${i+1}</span><div>${esc(step.text)}${button(step.nextFloorId?'Показать следующий этаж':'Показать участок','route-floor',`data-floor="${esc(step.nextFloorId||step.floorId)}" data-node="${esc(step.nodeId)}"`,'map-text-button')}</div></li>`).join('')}</ol>`:`<p class="map-muted">${s.startId?'Нет размеченного пути с выбранными условиями. Попробуйте другую начальную точку.':'Старт задаётся вручную. Выбор корпуса или этажа не определяет ваше положение.'}</p>`}`;
  }
  function dataPanel() {
    return `<div class="map-route-head"><span class="map-kicker">ПЛАНЫ КОМАНДЫ</span>${button('Закрыть','data-close','','map-text-button')}</div><h2>Добавить планы</h2><p class="map-muted">Загрузите подготовленный JSON: помещения, двери и проверенные проходы. Набор заменит внутренние карты только на этом устройстве.</p><label class="map-field">Набор карт (JSON, до 2 МБ)<input type="file" id="map-import" accept=".json,application/json"></label>${s.pending?`<div class="map-import-preview"><strong>Проверка структуры пройдена</strong><p>Версия ${esc(s.pending.dataVersion)} · этажей ${s.pending.floors.length} · мест ${s.pending.locations.length}</p><p>Источник: ${esc(s.pending.source)}<br>Проверка по данным автора: ${esc(s.pending.verifiedAt||'не указана')}</p><p>Автоматическая проверка не подтверждает проходимость на месте.</p>${button('Сохранить на устройстве','import-apply','','map-button primary')}</div>`:''}<div class="map-data-meta"><strong>Текущий набор: ${esc(pack.dataVersion)}</strong><p>${esc(pack.source)}</p><p>Дата проверки: ${esc(pack.verifiedAt||'не подтверждена')}<br>Этажей: ${pack.floors.length} · объектов: ${pack.locations.length}</p></div>${pack!==bundledPack?button('Вернуть встроенную схему','import-reset','','map-text-button'):''}<p class="map-muted">Формат и инструкция — docs/MAPS.md в репозитории проекта. Сам файл JSON содержит всю геометрию: подключение к сети не требуется.</p>`;
  }
  function card() {
    if(s.panel)return dataPanel();
    if(s.planning)return routeCard();
    const l=selected();
    if(!l)return `<div class="map-welcome"><span class="map-kicker">КАРЛА МАРКСА, 12</span><h2>Куда направимся?</h2><p class="map-muted">Выберите корпус на схеме или найдите место.</p><div class="map-building-strip">${buildings.map(b=>button(b.id,'building',`data-id="${b.id}" aria-label="Корпус ${b.id}"`,'map-building-chip')).join('')}</div></div>`;
    const b=buildings.find(b=>b.id===l.buildingId),floors=availableFloors();
    return `<div class="map-card-title"><div><span class="map-kicker">${l.type==='building'?'ТЕРРИТОРИЯ':esc(subtitle(l))}</span><h2>${esc(l.name)}</h2></div><div class="map-card-tools">${iconButton('close','Закрыть карточку','card-close')}${button(icon('heart'),'favorite',`aria-label="Сохранить корпус" aria-pressed="${isFavorite(b.id)}"`,'map-icon-button')}</div></div>${s.context?`<div class="map-context"><strong>${esc(s.context.room||s.context.place||'Место из расписания')}</strong><span>${esc(s.context.title||s.context.subject||'')}</span>${!s.exact?'<small>Точное помещение не сопоставлено. Показан подтверждённый корпус.</small>':''}</div>`:''}
      ${l.type==='building'?`<p class="map-muted">${floors.length?`${floors.length} этажа с планами CampusWay`:'План корпуса пока не добавлен'} · входы на территории не проверены</p><div class="map-card-actions">${floors.length?button('Открыть этажи '+icon('arrow'),'open-floor','','map-button primary'):button('Добавить планы '+icon('plus'),'data-open','','map-button primary')}${button(icon('external')+' Городская карта','external','','map-button')}</div>`:`<div class="map-card-actions">${button(icon('arrow')+' Маршрут','route-to',l.nodeId?'':'disabled','map-button primary')}${button('Отсюда','route-from',l.nodeId?'':'disabled')}</div>${!l.nodeId?'<p class="map-muted">Точка ещё не подключена к графу маршрутов.</p>':''}`}
      ${button(s.expanded?'Свернуть подробности':'Подробнее о месте','card-toggle',`aria-expanded="${s.expanded}"`,'map-text-button')}${floor()?.image?`<div class="plan-note">Архив CampusWay · без проверки на месте</div>${button(s.sourcePlan?'Векторная схема':'Исходный план','source-plan','','map-text-button')}`:''}${l.photo&&/^assets\/campusway\/room-6-\d+\.png$/.test(l.photo)?`<img class="floor-photo" src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy">`:''}${s.expanded?`<div class="map-card-details">${l.type==='building'&&b.photo?`<img src="${esc(b.photo)}" alt="${esc(b.name)} из материалов команды">`:''}<p>${esc(l.type==='building'?b.description:floor()?.source||'План из набора команды')}</p><p>Схема не определяет местоположение. Внутренний маршрут требует известной точки старта.</p>${button('Набор карт и источник','data-open','','map-text-button')}</div>`:''}`;
  }
  function draw() {
    if(!root)return;
    const f=floor(),l=selected();
    if(!s.camera)setView(null);
    root.innerHTML=`<section class="map-module ${s.searching||s.query?'is-searching':''} ${l||s.panel||s.planning||s.error?'has-sheet':''}" aria-label="Карта кампуса"><header class="map-header"><div class="map-title-row"><div><h1>Карта кампуса</h1><span class="map-kicker">УУНИТ · КАРЛА МАРКСА, 12</span></div>${iconButton('download','Добавить планы','data-open')}</div><div class="map-search-field">${icon('search')}<input id="map-search" type="search" placeholder="Корпус, аудитория, место" value="${esc(s.query)}" aria-label="Поиск мест" autocomplete="off">${s.query?iconButton('close','Очистить поиск','search-clear'):''}</div><div class="map-filters" aria-label="Тип места">${[['all','Всё'],['room','Аудитории'],['entrance','Входы'],['cafe','Буфет'],['toilet','Туалет'],['library','Библиотека']].map(([id,label])=>button(label,'filter',`data-type="${id}" aria-pressed="${s.filter===id}"`,s.filter===id?'map-filter active':'map-filter')).join('')}</div></header>
      <div class="map-canvas"><div class="map-level-row">${button(f?`${icon('left')} Территория`:'Схема территории','territory','','map-level-button')}<span>${f?esc(f.name):'Без GPS-привязки'}</span></div><svg id="map-surface" viewBox="${s.camera.box.join(' ')}" role="group" tabindex="0" aria-label="${f?esc(f.name)+': помещения, двери и проходы':'Расположение девяти корпусов на территории'}">${f?floorSvg(data,f,l,s.route,s.filter,s.sourcePlan):campusSvg(data,l)}</svg>${f?`<div class="map-floor-switch" aria-label="Этаж для просмотра">${availableFloors().map(fl=>button(esc(fl.name),'floor',`data-floor="${esc(fl.id)}" aria-pressed="${f.id===fl.id}"`,f.id===fl.id?'active':'')).join('')}</div>`:''}<div class="map-zoom">${iconButton('plus','Увеличить','zoom-in')}${iconButton('minus','Уменьшить','zoom-out')}${iconButton('focus','Сбросить вид','zoom-reset')}</div><div class="map-canvas-caption">${f?(data.verification==='archive'?'CampusWay · архивный план':'План · '+esc(f.verifiedAt)):'9 корпусов · планы 3–5 этажей корпуса 6'}${data.synthetic?' · СИНТЕТИЧЕСКИЙ ТЕСТ':''}</div><div id="map-results-host">${results()}</div></div>
      <section class="map-sheet ${s.panel||s.planning||s.expanded?'expanded':''}" aria-label="Информация о месте">${s.error?`<p class="map-error" role="alert">${esc(s.error)}</p>`:''}${card()}</section></section>`;
    resize?.disconnect();
    gestures=bindGestures(root.querySelector('#map-surface'),s.camera,id=>choose(id));
    resize=new ResizeObserver(()=>{fitView();gestures.apply();});resize.observe(root.querySelector('.map-canvas'));
    fitView();
  }
  // UI is over the canvas. Fit content inside the visible window without shrinking the SVG.
  function fitView() {
    if(!root || !s.camera.fit)return;
    const svg=root.querySelector('#map-surface'),rect=svg.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    const header=root.querySelector('.map-header').getBoundingClientRect();
    const nav=root.closest('.app-shell')?.querySelector('.bottom-nav')?.getBoundingClientRect();
    const sheet=root.querySelector('.map-sheet');
    const sheetTop=sheet.offsetHeight&&getComputedStyle(sheet).display!=='none'?sheet.getBoundingClientRect().top:rect.bottom;
    const level=root.querySelector('.map-level-row').getBoundingClientRect();
    const top=Math.max(16,header.bottom-rect.top+22,level.bottom-rect.top+16);
    const bottom=Math.max(30,rect.bottom-Math.min(sheetTop,nav?.top??rect.bottom)+20);
    const usableHeight=Math.max(120,rect.height-top-bottom),usableWidth=Math.max(120,rect.width-56);
    const b=s.camera.box,scale=Math.min(usableWidth/b[2],usableHeight/b[3]);
    const width=rect.width/scale,height=rect.height/scale;
    s.camera.box=[b[0]+b[2]/2-width/2,b[1]+b[3]/2-(top+usableHeight/2)/scale,width,height];
    s.camera.home=[...s.camera.box];s.camera.fit=false;gestures.apply();
  }
  function calculate() {
    const start=data.locations.find(l=>l.id===s.startId),target=data.locations.find(l=>l.id===s.targetId);
    s.route=start?.nodeId&&target?.nodeId?findRoute(data,start.nodeId,target.nodeId,{stepFree:s.stepFree,allowArchive:data.verification==='archive'}):null;
    if(s.route)setView(start.floorId);
    draw();
  }
  function act(action,el) {
    const l=selected();
    if(action==='zoom-in'||action==='zoom-out'){gestures.zoom(action==='zoom-in'?1.35:1/1.35);return;}
    if(action==='zoom-reset'){gestures.reset();return;}
    if(action==='building'){choose('building:'+el.dataset.id);return;}
    if(action==='filter'){s.filter=el.dataset.type;s.searching=true;draw();return;}
    if(action==='search-clear'||action==='search-close'){s.query='';s.searching=false;s.filter='all';draw();return;}
    if(action==='card-close'){s.selected=null;s.context=null;s.error='';s.expanded=false;}
    if(action==='card-toggle')s.expanded=!s.expanded;
    if(action==='territory')setView(null);
    if(action==='source-plan')s.sourcePlan=!s.sourcePlan;
    if(action==='floor'||action==='route-floor'){setView(el.dataset.floor);}
    if(action==='open-floor')setView(availableFloors()[0]?.id||null);
    if(action==='external'){external('https://yandex.ru/maps/?text='+encodeURIComponent(`УУНиТ Уфа Карла Маркса 12 ${buildings.find(b=>b.id===l.buildingId).name}`));return;}
    if(action==='favorite')onFavorite(l.buildingId);
    if(action==='data-open'){s.panel=true;s.searching=false;s.query='';s.error='';}
    if(action==='data-close'){s.panel=false;s.pending=null;s.error='';}
    if(action==='route-to'){s.targetId=l.id;s.planning=true;s.route=null;calculate();return;}
    if(action==='route-from'){s.startId=l.id;s.route=null;s.error='Начало сохранено: '+l.name+'. Найдите цель и нажмите «Маршрут».';}
    if(action==='route-close'){s.planning=false;s.route=null;}
    if(action==='import-apply'&&s.pending){
      if(!storage.write('maps',s.pending)){s.error='Не хватило памяти. Текущий набор сохранён.';draw();return;}
      pack=s.pending;data=createMapData(pack,buildings);Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,error:'Набор сохранён. Можно искать помещения.',camera:null});
    }
    if(action==='import-reset'){
      if(!storage.write('maps',bundledPack)){s.error='Не удалось сохранить встроенный набор.';draw();return;}
      pack=bundledPack;data=createMapData(pack,buildings);Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,error:'',camera:null});
    }
    draw();
  }
  function onClick(e) {const pick=e.target.closest('[data-map-pick]'),el=e.target.closest('[data-map-action]');if(pick){document.activeElement?.blur();choose(pick.dataset.mapPick);}else if(el)act(el.dataset.mapAction,el);}
  function onInput(e) {if(e.target.id==='map-search'){s.query=e.target.value;s.searching=true;root.querySelector('.map-module').classList.add('is-searching');root.querySelector('#map-results-host').innerHTML=results();}}
  async function onChange(e) {
    if(e.target.id==='map-route-start'){s.startId=e.target.value;calculate();}
    if(e.target.id==='map-step-free'){s.stepFree=e.target.checked;calculate();}
    if(e.target.id==='map-import') {
      const file=e.target.files[0];if(!file)return;s.pending=null;s.error='';
      try{if(file.size>2*1024*1024)throw new Error('Размер набора превышает 2 МБ');const candidate=JSON.parse(await file.text());validateMapPack(candidate,buildings);s.pending=candidate;}
      catch(error){s.error='Набор не изменён: '+error.message;}
      draw();
    }
  }
  function onKey(e){if(e.key==='Escape'&&(s.searching||s.query)){s.searching=false;s.query='';draw();}}
  return {
    mount(element){this.unmount();root=element;root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('keydown',onKey);draw();},
    unmount(){resize?.disconnect();if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('keydown',onKey);}root=null;},
    open(context){s.route=null;s.planning=false;s.startId='';s.targetId='';const result=resolvePlace(data,context);if(result.location)choose(result.location.id,{context,exact:result.exact});else{Object.assign(s,{selected:null,floorId:null,camera:null,query:'',context:null,error:'Место не найдено: '+(context.room||context.place||context.locationId||'уточните корпус')});draw();}},
    back(){if(s.searching||s.query){s.searching=false;s.query='';draw();return true;}if(s.panel){s.panel=false;draw();return true;}if(s.planning){s.planning=false;s.route=null;draw();return true;}if(s.floorId){setView(null);draw();return true;}return false;},
  };
}
