export const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const points = list => list.map(p=>p.join(',')).join(' ');
import {projectPoint,projectLine} from './projection.js';
export const campusPoint = p => [p[1],1706-p[0]];
export const campusBox = [40,40,800,1630];
export const symbols={entrance:'↪',stairs:'↟',lift:'↕',toilet:'WC',cafe:'☕',library:'Б',landmark:'•'};
const targetAttrs = l => `data-map-place="${esc(l.id)}" tabindex="0" role="button" aria-label="${esc(l.name)}"`;

export function campusSvg(data, selected, route=null) {
  const nodes=new Map(data.campus.nodes.map(node=>[node.id,node]));
  const outside=(route?.nodeIds||[]).filter(id=>nodes.get(id)?.floorId===null);
  const endpoints=new Set(outside.length?[outside[0],outside.at(-1)]:[]);
  const lines=(route?.links||[]).filter(l=>l.edge.geometry&&nodes.get(l.from)?.floorId===null&&nodes.get(l.to)?.floorId===null);
  return `<g class="map-territory"><g transform="matrix(0 -1 1 0 0 1706)"><g class="map-streets"><path d="M90 55H1630V865M90 55V865"/></g>
    <g class="map-passages">${data.campus.edges.filter(edge=>edge.passage?.length).map(edge=>`<g class="map-passage ${edge.reported?'is-reported':''} ${edge.underground?'is-underground':''}"><title>${esc(edge.source)}${edge.reported?' · не проверен':''}</title><polyline class="map-passage-border" points="${points(edge.passage)}" stroke-width="${edge.width+6}"/><polyline class="map-passage-fill" points="${points(edge.passage)}" stroke-width="${edge.width}"/></g>`).join('')}</g>
    ${data.buildings.map(b=>`<path data-campus-building="${esc(b.id)}" class="map-building ${selected?.buildingId===b.id?'is-selected':''}" d="${esc(b.path)}" ${targetAttrs(data.locations.find(l=>l.id==='building:'+b.id))}/>`).join('')}
    <g class="route-halo">${lines.map(link=>`<polyline points="${points(link.edge.geometry)}"/>`).join('')}</g><g class="route-line">${lines.map(link=>`<polyline class="${link.edge.kind==='outdoor'?'outdoor-route':''}" points="${points(link.edge.geometry)}"/>`).join('')}</g></g>
    <text class="map-street-name" transform="translate(79 840) rotate(-90)" text-anchor="middle">КАРЛА МАРКСА</text><text class="map-street-name" x="435" y="57" text-anchor="middle">КОММУНИСТИЧЕСКАЯ</text><text class="map-street-name" x="435" y="1650" text-anchor="middle">ПУШКИНА</text>
    ${data.campus.edges.filter(e=>e.underground&&e.passage?.length).map(e=>{const a=e.passage[0],b=e.passage.at(-1),p=campusPoint([(a[0]+b[0])/2,(a[1]+b[1])/2]);return `<text class="map-passage-label" x="${p[0]+18}" y="${p[1]}" dy=".35em">Подземный 6–7</text>`;}).join('')}
    ${data.buildings.filter(building=>!endpoints.has('campus:building:'+building.id)).map(b=>{const p=campusPoint(b.center),on=selected?.buildingId===b.id;return `<g data-campus-building="${esc(b.id)}" class="map-number ${on?'is-selected':''}" ${targetAttrs(data.locations.find(l=>l.id==='building:'+b.id))}><circle cx="${p[0]}" cy="${p[1]}" r="${on?37:31}"/><text x="${p[0]}" y="${p[1]}" dy=".35em">${esc(b.id)}</text>${on?`<text class="selected-building-label" x="${p[0]}" y="${p[1]+65}">Корпус ${esc(b.id)}</text>`:''}</g>`;}).join('')}
    ${route?[...endpoints].map((id,index)=>{const point=campusPoint(nodes.get(id).point),label=endpoints.size===1?'А/Б':index===0?'А':'Б';return `<g data-campus-building="${esc(nodes.get(id).buildingId||'')}" class="route-endpoint ${index?'end':'start'}"><circle cx="${point[0]}" cy="${point[1]}" r="18"/><text x="${point[0]}" y="${point[1]}" dy=".35em">${label}</text></g>`;}).join(''):''}</g>`;
}

export function floorSvg(data, floor, selected, route, typeFilter='all',sourcePlan=false) {
  sourcePlan=sourcePlan&&!!(floor.image||floor.sceneSourceImage);
  const places=data.locations.filter(l=>l.floorId===floor.id);
  const nodes=new Map(data.nodes.map(n=>[n.id,n]));
  const activeLines=(route?.links||[]).filter(l=>l.edge.geometry && nodes.get(l.from)?.floorId===floor.id && nodes.get(l.to)?.floorId===floor.id);
  // POIs use a spatial priority filter; selection and route landmarks are always retained.
  const accepted=[];
  const pois=places.filter(l=>l.type!=='room' && (typeFilter==='all'||l.type===typeFilter||l.id===selected?.id))
    .sort((a,b)=>(b.id===selected?.id)-(a.id===selected?.id) || ['entrance','stairs','lift'].includes(b.type)-['entrance','stairs','lift'].includes(a.type))
    .filter(l=>{const special=l.id===selected?.id || route?.nodeIds.includes(l.nodeId);if(!special && accepted.some(p=>Math.hypot(p[0]-l.point[0],p[1]-l.point[1])<(floor.sceneCoordinates?8:38)))return false;accepted.push(l.point);return true;});
  return `<g class="map-floor ${sourcePlan?'source-plan':''}">${sourcePlan&&floor.image?`<image class="floor-source-image" href="${esc(floor.image)}" width="${floor.imageSize[0]}" height="${floor.imageSize[1]}" transform="matrix(0 -1 1 0 0 ${floor.imageSize[0]})"/>`:''}<g class="floor-areas">${floor.areas.map(a=>{const l=places.find(l=>l.id===a.locationId);return `<polygon points="${points(a.points)}" class="floor-area ${a.kind} ${l&&l.id===selected?.id?'is-selected':''}" ${l?targetAttrs(l):''}/>`;}).join('')}</g>
    <g class="floor-walls">${floor.walls.map(w=>`<polyline points="${points(w)}"/>`).join('')}</g>
    <g class="floor-doors">${floor.doors.map(d=>`<polyline points="${points(d.points)}"/>`).join('')}</g>
    <g class="route-halo">${activeLines.map(l=>`<polyline points="${points(l.edge.geometry)}"/>`).join('')}</g><g class="route-line">${activeLines.map(l=>`<polyline points="${points(l.edge.geometry)}"/>`).join('')}</g>
    ${places.filter(l=>l.type==='room').map(l=>`<text data-room-width="${Math.max(...floor.areas.find(a=>a.id===l.areaId).points.map(p=>p[0]))-Math.min(...floor.areas.find(a=>a.id===l.areaId).points.map(p=>p[0]))}" class="room-label ${l.id===selected?.id?'is-selected':''}" x="${l.point[0]}" y="${l.point[1]}" dy=".35em">${esc(l.number)}</text>`).join('')}
    ${pois.filter(l=>!route||![route.startId,route.endId].includes(l.nodeId)).map(l=>`<g class="floor-poi ${l.id===selected?.id?'is-selected':''} ${route?.nodeIds.includes(l.nodeId)?'on-route':''}" ${targetAttrs(l)}><circle cx="${l.point[0]}" cy="${l.point[1]}" r="13"/><text x="${l.point[0]}" y="${l.point[1]}" dy=".35em">${symbols[l.type]||'•'}</text></g>`).join('')}
    ${route?[['start',route.startId,'А'],['end',route.endId,'Б']].map(([kind,id,label])=>{const n=nodes.get(id);return n.floorId===floor.id?`<g class="route-endpoint ${kind}"><${kind==='start'?'circle':'rect'} ${kind==='start'?`cx="${n.point[0]}" cy="${n.point[1]}" r="12"`:`x="${n.point[0]-12}" y="${n.point[1]-12}" width="24" height="24" rx="4"`}/><text x="${n.point[0]}" y="${n.point[1]}" dy=".35em">${label}</text></g>`:'';}).join(''):''}
    ${selected?.floorId===floor.id?`<g class="selection-caption"><text x="${selected.point[0]}" y="${selected.point[1]-24}" data-caption-y="${selected.point[1]}" text-anchor="middle">${esc(selected.name)}</text></g>`:''}</g>`;
}

// Every floor is drawn in the same campus coordinate space. Zoom changes only
// layer visibility; it never replaces the territory or the gesture surface.
export function sceneSvg(data,layout,shownFloors,selected,route,typeFilter,sourceFloorId=null) {
  return campusSvg({...data,campus:data},selected,route)+shownFloors.map(floor=>{
    const p=layout.plans.get(floor.id);if(!p)return '';
    const point=q=>projectPoint(p,q),clip='plan-clip-'+floor.id;
    const sourceShown=sourceFloorId===floor.id&&!!floor.image;
    const plan={...floor,image:null,sceneSourceImage:sourceShown,sceneCoordinates:true,areas:floor.areas.map(a=>({...a,points:projectLine(p,a.points,true)})),walls:floor.walls.map(w=>projectLine(p,w)),doors:floor.doors.map(d=>({...d,points:projectLine(p,d.points)}))};
    const item=l=>l.floorId===floor.id?{...l,point:point(l.point)}:l;
    const projected={...data,locations:data.locations.map(item),nodes:data.nodes.map(item)};
    const nodes=new Map(data.nodes.map(n=>[n.id,n]));
    const projectedRoute=route?{...route,links:route.links.map(l=>({...l,edge:{...l.edge,geometry:l.edge.geometry&&nodes.get(l.from)?.floorId===floor.id&&nodes.get(l.to)?.floorId===floor.id?projectLine(p,l.edge.geometry):l.edge.geometry}}))}:null;
    const building=data.buildings.find(b=>b.id===floor.buildingId);
    const outline=floor.placement?.box?`<rect x="${p.box[0]}" y="${p.box[1]}" width="${p.box[2]}" height="${p.box[3]}"/>`:`<path d="${esc(building.path)}" transform="matrix(0 -1 1 0 0 1706)"/>`;
    const image=sourceShown?(p.tiles||[p]).filter(t=>!t.target||t.target[2]>0).map((t,i)=>{
      const tileClip=clip+'-image-'+i,rect=t.target?`<rect x="${t.target[0]}" y="${t.target[1]}" width="${t.target[2]}" height="${t.target[3]}"/>`:outline;
      return `<defs><clipPath id="${tileClip}">${rect}</clipPath></defs><g clip-path="url(#${tileClip})"><image class="floor-source-image" href="${esc(floor.image)}" width="${floor.imageSize[0]}" height="${floor.imageSize[1]}" transform="matrix(${t.sx} ${t.yx||0} ${t.xy||0} ${t.sy} ${t.tx} ${t.ty}) matrix(0 -1 1 0 0 ${floor.imageSize[0]})"/></g>`;
    }).join(''):'';
    return `<g class="map-indoor-layer" data-scene-floor="${esc(floor.id)}" data-scene-building="${esc(floor.buildingId)}" aria-hidden="true"><defs><clipPath id="${esc(clip)}">${outline}</clipPath></defs><g class="indoor-background">${outline}</g><g clip-path="url(#${esc(clip)})">${image}${floorSvg(projected,plan,selected?item(selected):null,projectedRoute,typeFilter,sourceShown)}</g></g>`;
  }).join('');
}
