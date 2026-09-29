import {createMapData, validateMapPack} from './data.js';
import {searchPlaces, resolvePlace} from './search.js';
import {placeNode,journeyGraph,planJourney,journeySections} from './journey.js';
import {sceneSvg, campusBox, esc} from './svg.js';
import {createSceneLayout,scenePoint,boxPoints} from './scene.js';
import {bindGestures} from './gestures.js';
import {icon} from '../icons.js';

const button=(label,action,extra='',cls='map-button')=>`<button class="${cls}" data-map-action="${action}" ${extra}>${label}</button>`;
const iconButton=(name,label,action)=>button(icon(name),action,`aria-label="${label}" title="${label}"`,'map-icon-button');
export function createMapController({buildings,bundledPack,storage,external,onFavorite,isFavorite,testMode=false}) {
  let data, pack=bundledPack, error='';
  try {pack=storage.read('maps')||bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});}
  catch {pack=bundledPack;data=createMapData(pack,buildings,{allowSynthetic:testMode});error='Сохранённый набор карт повреждён. Открыта встроенная схема.';}
  const s={selected:null,floorId:null,query:'',filter:'all',expanded:false,context:null,exact:false,route:null,startId:'',targetId:'',planning:false,stepFree:false,panel:false,pending:null,error,searching:false,camera:null,sourcePlan:null,mode:'shortest',routeReason:'',graph:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null,floorChoices:{},floorCardHidden:false};
  let root=null,gestures=null,resize=null,layout=null,frame=null,pendingFocus={floorId:null};
  let visibleFloors=new Set();
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
  function shownFloors() {
    const byBuilding=new Map();
    for(const f of [...data.floors].sort((a,b)=>a.order-b.order))if(!byBuilding.has(f.buildingId))byBuilding.set(f.buildingId,f);
    for(const [buildingId,id] of Object.entries(s.floorChoices)){
      const f=data.floors.find(f=>f.id===id&&f.buildingId===buildingId);if(f)byBuilding.set(buildingId,f);
    }
    return [...byBuilding.values()];
  }
  function useFloor(floorId) {
    if(s.floorId!==floorId)s.floorCardHidden=false;
    s.floorId=floorId;
    const f=floor();if(f){s.viewBuildingId=f.buildingId;s.floorChoices[f.buildingId]=f.id;}
    if(s.route){const matches=sections().map((section,i)=>section.floorId===floorId?i:-1).filter(i=>i>=0);s.routeSection=matches.includes(s.routeSection)?s.routeSection:matches[0]??-1;}
  }
  function setView(floorId,point=null) {
    useFloor(floorId);s.floorCardHidden=false;pendingFocus={floorId,point};
  }
  function focusPlace(place) {
    if(place.floorId){setView(place.floorId,place.point);return;}
    const f=data.floors.find(f=>f.id===s.floorChoices[place.buildingId])||data.floors.filter(f=>f.buildingId===place.buildingId).sort((a,b)=>a.order-b.order)[0];
    setView(f?.id||null);if(!f)pendingFocus={buildingId:place.buildingId};
  }
  function choose(id,{context=null,exact=false}={}) {
    const l=data.locations.find(l=>l.id===id);if(!l){s.error='Место не найдено в текущем наборе карт.';draw();return;}
    if(s.route&&s.planning){
      s.selected=id;s.viewBuildingId=l.buildingId;closeSearch();s.error='';s.panel=false;
      if(l.type==='building'){
        const routeSections=sections(),next=routeSections.findIndex((section,i)=>i>=s.routeSection&&section.buildingId===l.buildingId);
        const index=next>=0?next:routeSections.findIndex(section=>section.buildingId===l.buildingId);
        if(index>=0){showSection(index);return;}
        focusPlace(l);
      }else focusPlace(l);
      draw();return;
    }
    s.selected=id;s.context=context;s.exact=exact;s.query='';s.searching=false;s.error='';s.panel=false;s.expanded=false;s.route=null;s.planning=false;
    s.endpoint=null;s.viewBuildingId=l.buildingId;s.routeEditing=false;s.graph=null;s.routeReason='';
    focusPlace(l);draw();
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
    return `<div class="map-card-title"><div><span class="map-kicker">КОРПУС ${esc(f.buildingId)}</span><h2>${esc(f.name)} · кабинеты</h2></div>${iconButton('close','Закрыть карточку','card-close')}</div>
      <div class="map-card-actions">${button('Найти кабинет','search-rooms','','map-button primary')}${button('Маршрут','route-open')}</div>
      ${f.navigationNote?`<p class="map-muted">${esc(f.navigationNote)}</p>`:''}${f.image?button(s.sourcePlan===s.floorId?'Схема':'Исходный план','source-plan','','map-text-button'):''}`;
  }
  function dataPanel() {
    return `<div class="map-route-head"><span class="map-kicker">ПЛАНЫ КОМАНДЫ</span>${button('Закрыть','data-close','','map-text-button')}</div><h2>Добавить планы</h2><p class="map-muted">Загрузите подготовленный JSON: помещения, двери и проверенные проходы. Набор заменит внутренние карты только на этом устройстве.</p><label class="map-field">Набор карт (JSON, до 2 МБ)<input type="file" id="map-import" accept=".json,application/json"></label>${s.pending?`<div class="map-import-preview"><strong>Проверка структуры пройдена</strong><p>Версия ${esc(s.pending.dataVersion)} · этажей ${s.pending.floors.length} · мест ${s.pending.locations.length}</p><p>Источник: ${esc(s.pending.source)}<br>Проверка по данным автора: ${esc(s.pending.verifiedAt||'не указана')}</p><p>Автоматическая проверка не подтверждает проходимость на месте.</p>${button('Сохранить на устройстве','import-apply','','map-button primary')}</div>`:''}<div class="map-data-meta"><strong>Текущий набор: ${esc(pack.dataVersion)}</strong><p>${esc(pack.source)}</p><p>Дата проверки: ${esc(pack.verifiedAt||'не подтверждена')}<br>Этажей: ${pack.floors.length} · объектов: ${pack.locations.length}</p></div>${pack!==bundledPack?button('Вернуть встроенную схему','import-reset','','map-text-button'):''}<p class="map-muted">Формат и инструкция — docs/MAPS.md в репозитории проекта. Сам файл JSON содержит всю геометрию: подключение к сети не требуется.</p>`;
  }
  function card() {
    if(s.panel)return dataPanel();
    if(s.planning)return routeCard();
    const l=selected();
    if(floor()&&(!l||l.type==='building'||l.floorId!==s.floorId))return s.floorCardHidden?'':floorCard();
    if(!l)return '';
    const b=buildings.find(b=>b.id===l.buildingId),floors=availableFloors();
    return `<div class="map-card-title"><div><span class="map-kicker">${l.type==='building'?'ТЕРРИТОРИЯ':esc(subtitle(l))}</span><h2>${esc(l.name)}</h2></div>${button(icon('heart'),'favorite',`aria-label="Сохранить корпус" aria-pressed="${isFavorite(b.id)}"`,'map-icon-button')}${iconButton('close','Закрыть карточку','card-close')}</div>${s.context?`<div class="map-context"><strong>${esc(s.context.room||s.context.place||'Место из расписания')}</strong><span>${esc(s.context.title||s.context.subject||'')}</span>${!s.exact?'<small>Кабинет не определён. Показан корпус.</small>':''}</div>`:''}
      ${l.type==='building'?`<p class="map-muted">${floors.length?`Планов этажей и участков: ${floors.length}`:'План корпуса пока не добавлен'}</p>`:''}<div class="map-card-actions">${button(icon('arrow')+' Маршрут','route-to',l.type==='building'||l.nodeId?'':'disabled','map-button primary')}${button('Отсюда','route-from',l.type==='building'||l.nodeId?'':'disabled')}</div>${l.type!=='building'&&!l.nodeId?'<p class="map-muted">Маршрут до этого места пока недоступен.</p>':''}
      <div class="map-card-links">${l.type==='building'?(floors.length?button('Открыть этажи','open-floor','','map-text-button'):button('Добавить планы','data-open','','map-text-button')):''}${button(s.expanded?'Свернуть':'Подробнее','card-toggle',`aria-expanded="${s.expanded}"`,'map-text-button')}</div>
      ${floor()?.navigationNote?`<p class="map-muted">${esc(floor().navigationNote)}</p>`:''}${floor()?.image?`<div class="plan-note">Архив CampusWay · без проверки на месте</div>${button(s.sourcePlan===s.floorId?'Векторная схема':'Исходный план','source-plan','','map-text-button')}`:''}${l.photo&&/^assets\/campusway\/room-6-\d+\.png$/.test(l.photo)?`<img class="floor-photo" src="${esc(l.photo)}" alt="${esc(l.name)}" loading="lazy">`:''}${s.expanded?`<div class="map-card-details">${l.type==='building'&&b.photo?`<img src="${esc(b.photo)}" alt="${esc(b.name)} из материалов команды">`:''}<p>${esc(l.type==='building'?b.description:floor()?.source||'План из набора команды')}</p><p>Геолокация не используется.</p>${l.type==='building'?button(icon('external')+' Городская карта','external','','map-text-button'):''}${button('Набор карт и источник','data-open','','map-text-button')}</div>`:''}`;
  }
  function levelMarkup() {
    const f=floor();
    return `<span>Кампус</span><span>${f?`Корпус ${esc(f.buildingId)} · ${esc(f.name)}`:'9 корпусов'}</span>`;
  }
  function floorButtons() {
    const f=floor();return f?availableFloors().map(fl=>button(esc(fl.name),'floor',`data-floor="${esc(fl.id)}" aria-pressed="${f.id===fl.id}"`,f.id===fl.id?'active':'')).join(''):'';
  }
  function observeSize() {
    resize?.disconnect();
    resize=new ResizeObserver(()=>keepSelectionVisible());
    for(const element of root.querySelectorAll('.map-canvas,.map-header,.map-sheet'))resize.observe(element);
  }
  function drawChrome() {
    if(!root)return;
    root.querySelector('.map-level-row').innerHTML=levelMarkup();
    const floors=root.querySelector('.map-floor-switch');floors.innerHTML=floorButtons();floors.hidden=!floor();
    floors.querySelector('.active')?.scrollIntoView({block:'nearest',inline:'nearest'});
    root.querySelector('.map-canvas-caption').textContent='Схема · совмещение планов условное'+(data.synthetic?' · СИНТЕТИЧЕСКИЙ ТЕСТ':'');
    const content=card();
    root.querySelector('#map-sheet-host').innerHTML=content||s.error?`<section class="map-sheet ${s.panel||s.routeEditing||s.expanded?'expanded':''} ${s.planning?'route-sheet':''}" aria-label="Информация о месте">${s.error?`<p class="map-error" role="alert">${esc(s.error)}</p>`:''}${content}</section>`:'';
    observeSize();
  }
  function queueCameraChange() {
    if(frame!==null)return;
    frame=requestAnimationFrame(()=>{frame=null;syncCamera();});
  }
  function syncCamera() {
    if(!root||!layout)return;
    const svg=root.querySelector('#map-surface'),matrix=svg.getScreenCTM();if(!matrix)return;
    const viewport=svg.getBoundingClientRect(),insets=s.camera.insets||{top:0,right:0,bottom:0,left:0};
    const left=viewport.left+insets.left,right=viewport.right-insets.right,top=viewport.top+insets.top,bottom=viewport.bottom-insets.bottom;
    const cx=(left+right)/2,cy=(top+bottom)/2,scale=Math.hypot(matrix.a,matrix.b);
    const threshold=Math.max(140,Math.min(280,(bottom-top)*.7)),visible=new Set(),candidates=[];
    for(const layer of svg.querySelectorAll('[data-scene-floor]')){
      const id=layer.dataset.sceneFloor,plan=layout.plans.get(id),[x,y,w,h]=plan.box;
      const px=x*matrix.a+matrix.e,py=y*matrix.d+matrix.f,pw=w*scale,ph=h*scale;
      const intersects=px+pw>left&&px<right&&py+ph>top&&py<bottom;
      const detailed=intersects&&Math.max(pw,ph)>=threshold*(visibleFloors.has(id)?0.78:1);
      layer.classList.toggle('is-visible',detailed);layer.setAttribute('aria-hidden',String(!detailed));
      if(detailed){
        visible.add(id);
        // Nearby plans may be visible together. The floor selector belongs to
        // the building under the viewport centre, not a distant edge of the map.
        if(cx>=px-16&&cx<=px+pw+16&&cy>=py-16&&cy<=py+ph+16)candidates.push({id,distance:Math.hypot(px+pw/2-cx,py+ph/2-cy)});
      }
      for(const marker of svg.querySelectorAll(`[data-campus-building="${plan.buildingId}"]`))marker.classList.toggle('is-detailed',detailed);
    }
    visibleFloors=visible;
    candidates.sort((a,b)=>a.distance-b.distance);
    const current=candidates.find(c=>c.id===s.floorId),nearest=candidates[0];
    const active=current&&(!nearest||current.distance<nearest.distance*1.25)?current:nearest;
    const id=active?.id||null;
    if(id!==s.floorId){useFloor(id);drawChrome();}
  }
  function draw() {
    if(!root)return;
    layout??=createSceneLayout(buildings,data.floors);
    s.camera??={base:[...campusBox],box:[...campusBox],minWidth:24,maxWidth:campusBox[2]*3};
    const l=selected();
    root.innerHTML=`<section class="map-module ${s.searching||s.query?'is-searching':''} ${s.endpoint?'is-endpoint-search':''}" aria-label="Карта кампуса"><header class="map-header"><div class="map-title-row"><div><span class="map-kicker">УУНИТ · КАРЛА МАРКСА</span><h1>Карта кампуса</h1></div>${iconButton('download','Добавить планы','data-open')}</div><div class="map-search-field">${icon('search')}<input id="map-search" type="search" placeholder="${s.endpoint==='start'?'Откуда: кабинет или корпус':s.endpoint==='target'?'Куда: кабинет или корпус':'Корпус, аудитория, место'}" value="${esc(s.query)}" aria-label="${s.endpoint==='start'?'Поиск начала маршрута':s.endpoint==='target'?'Поиск конца маршрута':'Поиск мест'}" autocomplete="off">${s.query?iconButton('close','Очистить поиск','search-clear'):''}</div><div class="map-filters" aria-label="Тип места">${[['all','Всё'],['room','Аудитории'],['entrance','Входы'],['cafe','Буфет'],['toilet','Туалет'],['library','Библиотека']].map(([id,label])=>button(label,'filter',`data-type="${id}" aria-pressed="${s.filter===id}"`,s.filter===id?'map-filter active':'map-filter')).join('')}</div></header>
      <div class="map-canvas"><div class="map-level-row"></div><svg id="map-surface" viewBox="${s.camera.box.join(' ')}" role="group" tabindex="0" aria-label="Единая карта кампуса: корпуса и планы этажей при приближении">${sceneSvg(routeData(),layout,shownFloors(),l,s.route,s.filter,s.sourcePlan)}</svg><div class="map-floor-switch" aria-label="Этаж корпуса в центре карты" hidden></div><div class="map-zoom">${iconButton('plus','Увеличить','zoom-in')}${iconButton('minus','Уменьшить','zoom-out')}${iconButton('focus','Показать весь кампус','zoom-reset')}</div><div class="map-canvas-caption"></div><div id="map-results-host">${results()}</div></div><div id="map-sheet-host"></div></section>`;
    gestures=bindGestures(root.querySelector('#map-surface'),s.camera,id=>choose(id),queueCameraChange);
    drawChrome();keepSelectionVisible();syncCamera();
  }
  function keepSelectionVisible(overview=false) {
    if(!root||!gestures)return;
    const module=root.querySelector('.map-module'),canvas=root.querySelector('.map-canvas').getBoundingClientRect();
    const header=root.querySelector('.map-header').getBoundingClientRect();
    module.style.setProperty('--map-top',Math.ceil(header.bottom-canvas.top)+'px');
    const sheet=root.querySelector('.map-sheet')?.getBoundingClientRect(),bottom=sheet?.height?canvas.bottom-sheet.top:0;
    module.style.setProperty('--map-bottom',Math.ceil(bottom)+'px');
    const insets={top:header.bottom-canvas.top+96,right:24,bottom:bottom+60,left:24};
    s.camera.insets=insets;
    if(overview)pendingFocus={overview:true,floorId:null};
    if(s.searching||s.query)return;
    const focus=pendingFocus;
    if(!focus){gestures.apply();return;}
    pendingFocus=null;
    let points=boxPoints(campusBox);
    if(focus.buildingId)points=boxPoints(layout.frames.get(focus.buildingId));
    else if(focus.floorId){
      const plan=layout.plans.get(focus.floorId);points=boxPoints(plan.box);
      if(focus.point){const p=scenePoint(layout,focus.floorId,focus.point),radius=Math.max(14,Math.min(45,plan.box[2]*.4));points=[[p[0]-radius,p[1]-radius],[p[0]+radius,p[1]+radius]];}
    }
    if(!focus.overview&&s.route&&!focus.point){
      const graph=routeData(),nodes=new Map(graph.nodes.map(node=>[node.id,node]));
      const relevant=n=>!focus.floorId||n.floorId===focus.floorId;
      const routePoints=s.route.nodeIds.map(id=>nodes.get(id)).filter(relevant).map(n=>scenePoint(layout,n.floorId,n.point));
      for(const link of s.route.links){const a=nodes.get(link.from),b=nodes.get(link.to);if(a.floorId===b.floorId&&relevant(a))routePoints.push(...(link.edge.geometry||[]).map(p=>scenePoint(layout,a.floorId,p)));}
      if(routePoints.length>1){
        // Give short routes enough surrounding map to stay readable.
        const xs=routePoints.map(p=>p[0]),ys=routePoints.map(p=>p[1]);
        points=[[Math.min(...xs)-12,Math.min(...ys)-12],[Math.max(...xs)+12,Math.max(...ys)+12]];
      }
    }
    gestures.fit(points,insets);
    if(!focus.floorId&&!focus.buildingId)s.camera.maxWidth=Math.max(campusBox[2]*3,s.camera.box[2]*1.5);
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
    if(action==='card-close'){s.selected=null;s.context=null;s.expanded=false;s.error='';s.floorCardHidden=true;}
    if(action==='territory')setView(null);
    if(action==='source-plan')s.sourcePlan=s.sourcePlan===s.floorId?null:s.floorId;
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
    if(action==='route-close'){s.planning=false;s.route=null;s.graph=null;s.routeEditing=false;s.routeReason='';closeSearch();const end=data.locations.find(p=>p.id===s.targetId)||l;if(end){s.selected=end.id;s.viewBuildingId=end.buildingId;focusPlace(end);}}
    if(action==='import-apply'&&s.pending){
      if(!storage.write('maps',s.pending)){s.error='Не хватило памяти. Текущий набор сохранён.';draw();return;}
      pack=s.pending;data=createMapData(pack,buildings);layout=null;visibleFloors.clear();pendingFocus={floorId:null};Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,graph:null,error:'Набор сохранён.',camera:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null,floorChoices:{},sourcePlan:null});
    }
    if(action==='import-reset'){
      if(!storage.write('maps',null)){s.error='Не удалось сохранить встроенный набор.';draw();return;}
      pack=bundledPack;data=createMapData(pack,buildings);layout=null;visibleFloors.clear();pendingFocus={floorId:null};Object.assign(s,{selected:null,floorId:null,route:null,planning:false,startId:'',targetId:'',context:null,pending:null,graph:null,error:'',camera:null,endpoint:null,routeEditing:false,routeSection:0,viewBuildingId:null,floorChoices:{},sourcePlan:null});
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
    unmount(){resize?.disconnect();if(frame!==null){cancelAnimationFrame(frame);frame=null;}if(root){root.removeEventListener('click',onClick);root.removeEventListener('input',onInput);root.removeEventListener('change',onChange);root.removeEventListener('keydown',onKey);}root=null;},
    open(context){s.route=null;s.graph=null;s.planning=false;s.startId='';s.targetId='';s.routeReason='';closeSearch();const result=resolvePlace(data,context);if(result.location){choose(result.location.id,{context,exact:result.exact});if(context.planRoute){s.targetId=result.location.id;s.planning=true;s.routeEditing=true;searchEndpoint('start');}}else{Object.assign(s,{selected:null,floorId:null,camera:null,query:'',context:null,error:'Место не найдено: '+(context.room||context.place||context.locationId||'уточните корпус')});draw();}},
    back(){if(s.searching||s.query){closeSearch();draw();return true;}if(s.panel){s.panel=false;draw();return true;}if(s.planning){if(s.routeEditing&&s.route){s.routeEditing=false;draw();return true;}act('route-close');return true;}if(s.selected){s.selected=null;s.context=null;s.error='';s.floorCardHidden=true;draw();return true;}if(s.floorId){setView(null);draw();return true;}return false;},
  };
}
