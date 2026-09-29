import {createMapData, validateMapPack} from './data.js';
import {searchPlaces, resolvePlace} from './search.js';
import {placeNode,journeyGraph,planJourney,journeySections} from './journey.js';
import {campusSvg, floorSvg, campusBox, campusPoint, esc} from './svg.js';
import {bindGestures} from './gestures.js';
import {icon} from '../icons.js';

const button=(label,action,extra='',cls='map-button')=>`<button class="${cls}" data-map-action="${action}" ${extra}>${label}</button>`;
const iconButton=(name,label,action)=>button(icon(name),action,`aria-label="${label}" title="${label}"`,'map-icon-button');
export function createMapController({buildings,bundledPack,storage,external,onFavorite,isFavorite,testMode=false}) {
  let data, pack=bundledPack, error='';
  try {pack=storage.read('maps')||bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});}
  catch {pack=bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});error='Сохранённый набор карт повреждён. Открыта встроенная схема.';}
  const s={selected:null,floorId:null,query:'',filter:'all',expanded:false,context:null,exact:false,route:null,startId:'',targetId:'',planning:false,stepFree:false,panel:false,pending:null,error,searching:false,camera:null,sourcePlan:false,mode:'shortest',routeReason:'',graph:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null};
  let root=null,gestures=null,resize=null;
  const selected=()=>data.locations.find(l=>l.id===s.selected);
  const floor=()=>data.floors.find(f=>f.id===s.floorId);
  const subtitle=l=>[buildings.find(b=>b.id===l.buildingId)?.name,data.floors.find(f=>f.id===l.floorId)?.name].filter(Boolean).join(' · ');
  const availableFloors=()=>data.floors.filter(f=>f.buildingId===(floor()?.buildingId||s.viewBuildingId||selected()?.buildingId)).sort((a,b)=>a.order-b.order);
  const routeData=()=>s.graph||journeyGraph(data,{mode:s.mode});
  const routePlaces=()=>data.locations.filter(l=>l.type==='building'||l.type==='room'||l.nodeId);
  const shortName=l=>l?.type==='room'?`${l.buildingId}-${l.number}`:l?.name||'';
  const sections=()=>journeySections(routeData(),s.route);
  function showSection(index) {
    const section=sections()[index];if(!section)return;
    s.routeSection=index;setView(section.floorId);s.selected=section.buildingId?'building:'+section.buildingId:null;
    s.query='';s.searching=false;s.endpoint=null;s.panel=false;s.routeEditing=false;s.expanded=false;s.error='';draw();
  }
  function searchEndpoint(which) {
    s.endpoint=which;s.query='';s.filter='all';s.searching=true;s.panel=false;s.error='';draw();
    root?.querySelector('#map-search')?.focus();
  }
  function closeSearch(){s.query='';s.searching=false;s.endpoint=null;s.filter='all';}
  function setView(floorId, point=null) {
    s.floorId=floorId;s.sourcePlan=false;if(floor())s.viewBuildingId=floor().buildingId;
    if(s.route){const matches=sections().map((section,i)=>section.floorId===floorId?i:-1).filter(i=>i>=0);s.routeSection=matches.includes(s.routeSection)?s.routeSection:matches[0]??-1;}
    const base=floor()?.viewBox||campusBox;s.camera={base:[...base],box:[...base]};
    if(point){const w=base[2]*.75,h=base[3]*.75;s.camera.box=[point[0]-w/2,point[1]-h/2,w,h];}
  }
  function choose(id,{context=null,exact=false}={}) {
    const l=data.locations.find(l=>l.id===id);if(!l){s.error='Место не найдено в текущем наборе карт.';draw();return;}
    if(s.route&&s.planning){
      s.selected=id;s.viewBuildingId=l.buildingId;closeSearch();s.error='';s.panel=false;
      if(l.type==='building'){
        const routeSections=sections(),next=routeSections.findIndex((section,i)=>i>=s.routeSection&&section.buildingId===l.buildingId);
        const index=next>=0?next:routeSections.findIndex(section=>section.buildingId===l.buildingId);
        if(index>=0){showSection(index);return;}
        setView(data.floors.filter(f=>f.buildingId===l.buildingId).sort((a,b)=>a.order-b.order)[0]?.id||null);
      }else setView(l.floorId,l.floorId?l.point:campusPoint(l.point));
      draw();return;
    }
    s.selected=id;s.context=context;s.exact=exact;s.query='';s.searching=false;s.error='';s.panel=false;s.expanded=false;s.route=null;s.planning=false;
    s.endpoint=null;s.viewBuildingId=l.buildingId;s.routeEditing=false;s.graph=null;s.routeReason='';
    setView(l.floorId,l.floorId?l.point:campusPoint(l.point));draw();
  }
  function results() {
    if(!s.query && !s.searching)return '';
    const needsQuery=!s.query.trim()&&(s.endpoint||['all','room'].includes(s.filter));
    const list=needsQuery?[]:searchPlaces(data,s.query,s.viewBuildingId,s.filter);
    return `<section class="map-results" aria-label="Результаты поиска"><div class="map-results-heading" role="status">${s.endpoint==='start'?'Откуда':s.endpoint==='target'?'Куда':'Поиск'}${button('Закрыть','search-close','','map-text-button')}</div>${list.slice(0,12).map(l=>`<button class="map-search-result" ${s.endpoint?'data-map-endpoint-pick':'data-map-pick'}="${esc(l.id)}" ${s.endpoint&&!placeNode(l)?'disabled':''}><span class="map-result-icon">${icon(l.type==='building'?'map':'pin')}</span><span><strong>${esc(l.name)}</strong><small>${esc(subtitle(l))}${s.endpoint&&!placeNode(l)?' · маршрут пока недоступен':''}</small></span>${icon('chevron')}</button>`).join('')}${!list.length?`<p class="map-search-empty">${needsQuery?'Введите номер, например 6-202, или название корпуса.':'Ничего не найдено'}</p>`:''}${list.length>12?'<p class="map-muted">Уточните корпус или номер.</p>':''}</section>`;
  }
  function routeCard() {
    const start=data.locations.find(l=>l.id===s.startId),target=data.locations.find(l=>l.id===s.targetId);
    const editing=s.routeEditing||!s.route;
    const head=`<div class="map-route-head"><h2>${s.route?`${esc(shortName(start))} → ${esc(shortName(target))}`:'Маршрут'}</h2>${button('Закрыть','route-close','','map-text-button')}</div>`;
    if(editing){
      const field=(which,label,place)=>button(`<small>${label}</small><strong>${esc(place?.name||'Найти кабинет или корпус')}</strong>${place?`<span>${esc(subtitle(place))}</span>`:''}`,'route-endpoint',`data-endpoint="${which}" aria-label="${label}: ${esc(place?.name||'поиск')}"`,'route-endpoint-field');
      return head+`<div class="route-endpoint-fields">${field('start','Откуда',start)}${button('⇅','route-swap','aria-label="Поменять начало и конец"','map-icon-button')}${field('target','Куда',target)}</div>
        <label class="map-field">Путь<select id="map-route-mode">${[['shortest','Короткий'],['indoor','Через переходы'],['outdoor','Через улицу']].map(([id,label])=>`<option value="${id}" ${s.mode===id?'selected':''}>${label}</option>`).join('')}</select></label>
        <details class="route-extra"><summary>Параметры</summary><label class="map-checkbox"><input id="map-step-free" type="checkbox" ${s.stepFree?'checked':''}> Без ступеней — только проверенные проходы</label></details>
        ${s.routeReason?`<p class="map-error" role="status">${esc(s.routeReason)}</p>`:''}
        <div class="map-card-actions">${button('Построить','route-build',start&&target?'':'disabled','map-button primary')}${s.route?button('К маршруту','route-resume') :''}</div>`;
    }
    const parts=sections(),index=s.routeSection,current=parts[index],next=parts[index+1];
    let transition='';
    if(current&&next){
      const link=s.route.links.find(l=>l.from===current.nodeIds.at(-1)&&l.to===next.nodeIds[0]);
      if(link?.edge.kind==='stairs'||link?.edge.kind==='lift')transition=`${link.edge.kind==='lift'?'Лифт':'Лестница'} → ${data.floors.find(f=>f.id===next.floorId)?.name||''}`;
      else if(!next.floorId)transition='Выход к территории';
      else transition=`Вход в корпус ${next.buildingId}`;
    }
    return head+`<div class="route-section-heading"><span>${current?`${index+1}/${parts.length} · ${esc(current.title)}`:'Просмотр карты'}</span>${button('Изменить','route-edit','','map-text-button')}</div>
      <nav class="route-sections" aria-label="Участки маршрута">${parts.map((part,i)=>button(esc(part.title),'route-section',`data-section="${i}" aria-current="${i===index?'step':'false'}"`,'route-section'+(i===index?' active':''))).join('')}</nav>
      ${transition?`<p class="route-transition">${esc(transition)}</p>`:''}
      <div class="route-section-actions">${current?button('Назад','route-section',`data-section="${index-1}" ${index===0?'disabled':''}`):''}${!current?button('К маршруту','route-resume','','map-button primary'):next?button(next.floorId?`Далее: корпус ${next.buildingId}, ${data.floors.find(f=>f.id===next.floorId)?.name}`:'Далее: территория','route-section',`data-section="${index+1}"`,'map-button primary'):button('Завершить','route-close','','map-button primary')}</div>
      <details class="route-extra"><summary>О маршруте</summary><p>По планам этажей. Проходы не проверены на месте.${s.route.partial?' Связь входов с территорией уточняется на месте.':''}${s.route.outdoor?' Уличная линия ориентировочная.':''} Геолокация не используется.</p></details>`;
  }
  function floorCard() {
    const f=floor();
    return `<div class="map-card-title"><div><span class="map-kicker">КОРПУС ${esc(f.buildingId)}</span><h2>${esc(f.name)} · кабинеты</h2></div>${button('Территория','territory','','map-text-button')}</div>
      <div class="map-card-actions">${button('Найти кабинет','search-rooms','','map-button primary')}${button('Маршрут','route-open')}</div>
      ${f.navigationNote?`<p class="map-muted">${esc(f.navigationNote)}</p>`:''}${f.image?button(s.sourcePlan?'Схема':'Исходный план','source-plan','','map-text-button'):''}`;
  }
  function dataPanel() {
    return `<div class="map-route-head"><span class="map-kicker">ПЛАНЫ КОМАНДЫ</span>${button('Закрыть','data-close','','map-text-button')}</div><h2>Добавить планы</h2><p class="map-muted">Загрузите подготовленный JSON: помещения, двери и проверенные проходы. Набор заменит внутренние карты только на этом устройстве.</p><label class="map-field">Набор карт (JSON, до 2 МБ)<input type="file" id="map-import" accept=".json,application/json"></label>${s.pending?`<div class="map-import-preview"><strong>Проверка структуры пройдена</strong><p>Версия ${esc(s.pending.dataVersion)} · этажей ${s.pending.floors.length} · мест ${s.pending.locations.length}</p><p>Источник: ${esc(s.pending.source)}<br>Проверка по данным автора: ${esc(s.pending.verifiedAt||'не указана')}</p><p>Автоматическая проверка не подтверждает проходимость на месте.</p>${button('Сохранить на устройстве','import-apply','','map-button primary')}</div>`:''}<div class="map-data-meta"><strong>Текущий набор: ${esc(pack.dataVersion)}</strong><p>${esc(pack.source)}</p><p>Дата проверки: ${esc(pack.verifiedAt||'не подтверждена')}<br>Этажей: ${pack.floors.length} · объектов: ${pack.locations.length}</p></div>${pack!==bundledPack?button('Вернуть встроенную схему','import-reset','','map-text-button'):''}<p class="map-muted">Формат и инструкция — docs/MAPS.md в репозитории проекта. Сам файл JSON содержит всю геометрию: подключение к сети не требуется.</p>`;
  }
  function card() {
    if(s.panel)return dataPanel();
    if(s.planning)return routeCard();
    const l=selected();
    if(floor()&&(!l||l.type==='building'||l.floorId!==s.floorId))return floorCard();
    if(!l)return '';
    const b=buildings.find(b=>b.id===l.buildingId),floors=availableFloors();
    return `<div class="map-card-title"><div><span class="map-kicker">${l.type==='building'?'ТЕРРИТОРИЯ':esc(subtitle(l))}</span><h2>${esc(l.name)}</h2></div>${button(icon('heart'),'favorite',`aria-label="Сохранить корпус" aria-pressed="${isFavorite(b.id)}"`,'map-icon-button')}${iconButton('close','Закрыть карточку','card-close')}</div>${s.context?`<div class="map-context"><strong>${esc(s.context.room||s.context.place||'Место из расписания')}</strong><span>${esc(s.context.title||s.context.subject||'')}</span>${!s.exact?'<small>Кабинет не определён. Показан корпус.</small>':''}</div>`:''}
      ${l.type==='building'?`<p class="map-muted">${floors.length?`Планов этажей и участков: ${floors.length}`:'План корпуса пока не добавлен'}</p>`:''}<div class="map-card-actions">${button(icon('arrow')+' Маршрут','route-to',l.type==='building'||l.nodeId?'':'disabled','map-button primary')}${button('Отсюда','route-from',l.type==='building'||l.nodeId?'':'disabled')}</div>${l.type!=='building'&&!l.nodeId?'<p class="map-muted">Маршрут до этого места пока недоступен.</p>':''}
      <div class="map-card-links">${l.type==='building'?(floors.length?button('Открыть этажи','open-floor','','map-text-button'):button('Добавить планы','data-open','','map-text-button')):''}${button(s.expanded?'Свернуть':'Подробнее','card-toggle',`aria-expanded="${s.expanded}"`,'map-text-button')}</div>
      ${floor()?.navigationNote?`<p class="map-muted">${esc(floor().navigationNote)}</p>`:''}${floor()?.image?`<div class="plan-note">Архив CampusWay · без проверки на месте</div>${button(s.sourcePlan?'Векторная схема':'Исходный план','source-plan','','map-text-button')}`:''}${l.photo&&/^assets\/campusway\/room-6-\d+\.png$/.test(l.photo)?`<img class="floor-photo" src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy">`:''}${s.expanded?`<div class="map-card-details">${l.type==='building'&&b.photo?`<img src="${esc(b.photo)}" alt="${esc(b.name)} из материалов команды">`:''}<p>${esc(l.type==='building'?b.description:floor()?.source||'План из набора команды')}</p><p>Геолокация не используется.</p>${l.type==='building'?button(icon('external')+' Городская карта','external','','map-text-button'):''}${button('Набор карт и источник','data-open','','map-text-button')}</div>`:''}`;
  }
  function draw() {
    if(!root)return;
    const f=floor(),l=selected(),content=card();
    if(!s.camera)setView(null);
    root.innerHTML=`<section class="map-module ${s.searching||s.query?'is-searching':''} ${s.endpoint?'is-endpoint-search':''}" aria-label="Карта кампуса"><header class="map-header"><div class="map-title-row"><div><span class="map-kicker">УУНИТ · КАРЛА МАРКСА</span><h1>Карта кампуса</h1></div>${iconButton('download','Добавить планы','data-open')}</div><div class="map-search-field">${icon('search')}<input id="map-search" type="search" placeholder="${s.endpoint==='start'?'Откуда: кабинет или корпус':s.endpoint==='target'?'Куда: кабинет или корпус':'Корпус, аудитория, место'}" value="${esc(s.query)}" aria-label="${s.endpoint==='start'?'Поиск начала маршрута':s.endpoint==='target'?'Поиск конца маршрута':'Поиск мест'}" autocomplete="off">${s.query?iconButton('close','Очистить поиск','search-clear'):''}</div><div class="map-filters" aria-label="Тип места">${[['all','Всё'],['room','Аудитории'],['entrance','Входы'],['cafe','Буфет'],['toilet','Туалет'],['library','Библиотека']].map(([id,label])=>button(label,'filter',`data-type="${id}" aria-pressed="${s.filter===id}"`,s.filter===id?'map-filter active':'map-filter')).join('')}</div></header>
      <div class="map-canvas"><div class="map-level-row">${button(f?`${icon('left')} Территория`:'Схема территории','territory','','map-level-button')}<span>${f?`Корпус ${esc(f.buildingId)} · ${esc(f.name)}`:'9 корпусов'}</span></div><svg id="map-surface" viewBox="${s.camera.box.join(' ')}" role="group" tabindex="0" aria-label="${f?esc(f.name)+': помещения, двери и проходы':'Расположение девяти корпусов на территории'}">${f?floorSvg(routeData(),f,l,s.route,s.filter,s.sourcePlan):campusSvg({...data,campus:routeData()},l,s.route)}</svg>${f?`<div class="map-floor-switch" aria-label="Этаж для просмотра">${availableFloors().map(fl=>button(esc(fl.name),'floor',`data-floor="${esc(fl.id)}" aria-pressed="${f.id===fl.id}"`,f.id===fl.id?'active':'')).join('')}</div>`:''}<div class="map-zoom">${iconButton('plus','Увеличить','zoom-in')}${iconButton('minus','Уменьшить','zoom-out')}${iconButton('focus','Сбросить вид','zoom-reset')}</div><div class="map-canvas-caption">${f?esc(f.sourceLabel||(f.verifiedAt?'План · '+f.verifiedAt:'План · без проверки на месте')):'Схема · входы и проходы не проверены'}${data.synthetic?' · СИНТЕТИЧЕСКИЙ ТЕСТ':''}</div><div id="map-results-host">${results()}</div></div>
      ${content||s.error?`<section class="map-sheet ${s.panel||s.routeEditing||s.expanded?'expanded':''} ${s.planning?'route-sheet':''}" aria-label="Информация о месте">${s.error?`<p class="map-error" role="alert">${esc(s.error)}</p>`:''}${content}</section>`:''}</section>`;
    gestures=bindGestures(root.querySelector('#map-surface'),s.camera,id=>choose(id));
    resize?.disconnect();resize=new ResizeObserver(()=>keepSelectionVisible());
    for(const element of root.querySelectorAll('.map-canvas,.map-header,.map-sheet'))resize.observe(element);
    keepSelectionVisible();
  }
  function keepSelectionVisible(overview=false) {
    if(!root)return;
    const module=root.querySelector('.map-module'),canvas=root.querySelector('.map-canvas').getBoundingClientRect();
    const header=root.querySelector('.map-header').getBoundingClientRect();
    module.style.setProperty('--map-top',Math.ceil(header.bottom-canvas.top)+'px');
    const sheet=root.querySelector('.map-sheet')?.getBoundingClientRect(),bottom=sheet?.height?canvas.bottom-sheet.top:0;
    module.style.setProperty('--map-bottom',Math.ceil(bottom)+'px');
    if(s.searching||s.query)return;
    const insets={top:header.bottom-canvas.top+(floor()?96:48),right:24,bottom:bottom+60,left:24};
    const current=selected(),base=s.camera.base;
    let points=[[base[0],base[1]],[base[0]+base[2],base[1]+base[3]]],keepScale=false;
    if(!overview && s.route) {
      const graph=routeData(),nodes=new Map(graph.nodes.map(node=>[node.id,node]));
      const routePoints=s.route.links.filter(link=>nodes.get(link.from).floorId===s.floorId&&nodes.get(link.to).floorId===s.floorId).flatMap(link=>link.edge.geometry||[]);
      routePoints.push(...s.route.nodeIds.map(id=>nodes.get(id)).filter(node=>node.floorId===s.floorId).map(node=>node.point));
      if(routePoints.length)points=s.floorId?routePoints:routePoints.map(campusPoint);
      if(s.route.startId===s.route.endId)keepScale=true;
    } else if(!overview && current && current.floorId===s.floorId) {
      points=[current.floorId?current.point:campusPoint(current.point)];keepScale=true;
    }
    gestures.fit(points,insets,keepScale);
  }
  function calculate() {
    if(!s.startId||!s.targetId){s.route=null;s.routeEditing=true;s.routeReason='';draw();return;}
    const result=planJourney(data,s.startId,s.targetId,{stepFree:s.stepFree,mode:s.mode});
    s.route=result.route;s.graph=result.graph;s.routeReason=result.reason;
    s.routeEditing=!s.route;s.routeSection=0;s.expanded=false;
    const start=data.locations.find(l=>l.id===s.startId);
    if(s.route)setView(start?.floorId||null);
    draw();
  }
  function act(action,el) {
    const l=selected();
    if(action==='zoom-in'||action==='zoom-out'){gestures.zoom(action==='zoom-in'?1.35:1/1.35);return;}
    if(action==='zoom-reset'){keepSelectionVisible(true);return;}
    if(action==='building'){choose('building:'+el.dataset.id);return;}
    if(action==='filter'){s.filter=el.dataset.type;s.searching=true;draw();if(s.filter==='room')root?.querySelector('#map-search')?.focus();return;}
    if(action==='search-clear'||action==='search-close'){closeSearch();draw();return;}
    if(action==='search-rooms'){s.query='';s.filter='room';s.searching=true;draw();root?.querySelector('#map-search')?.focus();return;}
    if(action==='route-endpoint'){searchEndpoint(el.dataset.endpoint);return;}
    if(action==='route-section'){showSection(Number(el.dataset.section));return;}
    if(action==='route-resume'){showSection(Math.max(0,s.routeSection));return;}
    if(action==='route-edit'){s.routeEditing=true;draw();return;}
    if(action==='route-build'){document.activeElement?.blur();closeSearch();calculate();return;}
    if(action==='card-toggle')s.expanded=!s.expanded;
    if(action==='card-close'){s.selected=null;s.context=null;s.expanded=false;s.error='';}
    if(action==='territory')setView(null);
    if(action==='source-plan')s.sourcePlan=!s.sourcePlan;
    if(action==='floor'||action==='route-floor'){setView(el.dataset.floor||null);if(action==='floor'){s.selected='building:'+floor().buildingId;s.expanded=false;}}
    if(action==='open-floor'){setView(availableFloors()[0]?.id||null);s.expanded=false;}
    if(action==='external'){external('https://yandex.ru/maps/?text='+encodeURIComponent(`УУНиТ Уфа Карла Маркса 12 ${buildings.find(b=>b.id===l.buildingId).name}`));return;}
    if(action==='favorite')onFavorite(l.buildingId);
    if(action==='data-open'){s.panel=true;closeSearch();s.error='';}
    if(action==='data-close'){s.panel=false;s.pending=null;s.error='';}
    if(action==='route-open'){s.planning=true;s.routeEditing=true;s.targetId='';s.route=null;s.graph=null;s.routeReason='';draw();return;}
    if(action==='route-swap'){[s.startId,s.targetId]=[s.targetId,s.startId];s.route=null;s.graph=null;s.routeReason='';draw();return;}
    if(action==='route-to'){s.targetId=l.id;s.planning=true;s.routeEditing=true;s.route=null;s.graph=null;s.routeReason='';s.error='';if(!routePlaces().some(location=>location.id===s.startId))s.startId='';if(!s.startId){searchEndpoint('start');return;}}
    if(action==='route-from'){s.startId=l.id;s.targetId='';s.route=null;s.graph=null;s.routeReason='';s.planning=true;s.routeEditing=true;searchEndpoint('target');return;}
    if(action==='route-close'){s.planning=false;s.route=null;s.graph=null;s.routeEditing=false;s.routeReason='';closeSearch();const end=data.locations.find(p=>p.id===s.targetId)||l;if(end){s.selected=end.id;s.viewBuildingId=end.buildingId;setView(end.floorId,end.floorId?end.point:campusPoint(end.point));}}
    if(action==='import-apply'&&s.pending){
      if(!storage.write('maps',s.pending)){s.error='Не хватило памяти. Текущий набор сохранён.';draw();return;}
      pack=s.pending;data=createMapData(pack,buildings);Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,graph:null,error:'Набор сохранён.',camera:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null});
    }
    if(action==='import-reset'){
      if(!storage.write('maps',null)){s.error='Не удалось сохранить встроенный набор.';draw();return;}
      pack=bundledPack;data=createMapData(pack,buildings);Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,graph:null,error:'',camera:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null});
    }
    draw();
  }
  function onClick(e) {
    const endpoint=e.target.closest('[data-map-endpoint-pick]'),pick=e.target.closest('[data-map-pick]'),el=e.target.closest('[data-map-action]');
    if(endpoint&&s.endpoint){
      const place=data.locations.find(l=>l.id===endpoint.dataset.mapEndpointPick);if(!placeNode(place))return;
      if(s.endpoint==='start')s.startId=place.id;else s.targetId=place.id;
      document.activeElement?.blur();closeSearch();s.route=null;s.graph=null;s.routeReason='';s.routeEditing=true;s.planning=true;draw();
    }else if(pick){document.activeElement?.blur();choose(pick.dataset.mapPick);}else if(el)act(el.dataset.mapAction,el);
  }
  function onInput(e) {if(e.target.id==='map-search'){s.query=e.target.value;s.searching=true;root.querySelector('.map-module').classList.add('is-searching');root.querySelector('#map-results-host').innerHTML=results();}}
  async function onChange(e) {
    if(e.target.id==='map-route-mode'){s.mode=e.target.value;s.route=null;s.graph=null;s.routeReason='';draw();}
    if(e.target.id==='map-step-free'){s.stepFree=e.target.checked;s.route=null;s.graph=null;s.routeReason='';draw();}
    if(e.target.id==='map-import') {
      const file=e.target.files[0];if(!file)return;s.pending=null;s.error='';
      try{if(file.size>2*1024*1024)throw new Error('Размер набора превышает 2 МБ');const candidate=JSON.parse(await file.text());validateMapPack(candidate,buildings);s.pending=candidate;}
      catch(error){s.error='Набор не изменён: '+error.message;}
      draw();
    }
  }
  function onKey(e){if(e.key==='Escape'&&(s.searching||s.query)){closeSearch();draw();}}
  return {
    mount(element){this.unmount();root=element;root.addEventListener('click',onClick);root.addEventListener('input',onInput);root.addEventListener('change',onChange);root.addEventListener('keydown',onKey);draw();},
    unmount(){resize?.disconnect();if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('keydown',onKey);}root=null;},
    open(context){s.route=null;s.graph=null;s.planning=false;s.startId='';s.targetId='';s.routeReason='';closeSearch();const result=resolvePlace(data,context);if(result.location){choose(result.location.id,{context,exact:result.exact});if(context.planRoute){s.targetId=result.location.id;s.planning=true;s.routeEditing=true;searchEndpoint('start');}}else{Object.assign(s,{selected:null,floorId:null,camera:null,query:'',context:null,error:'Место не найдено: '+(context.room||context.place||context.locationId||'уточните корпус')});draw();}},
    back(){if(s.searching||s.query){closeSearch();draw();return true;}if(s.panel){s.panel=false;draw();return true;}if(s.planning){if(s.routeEditing&&s.route){s.routeEditing=false;draw();return true;}act('route-close');return true;}if(s.selected){s.selected=null;s.context=null;s.error='';draw();return true;}if(s.floorId){setView(null);draw();return true;}return false;},
  };
}
