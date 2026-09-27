import {usableEdge} from './routing.js';

export const CAMPUS_ID='uust-karl-marx';
const types=['room','entrance','stairs','lift','toilet','cafe','library','landmark'];
const idOK = v => typeof v==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(v);
const pointOK = p => Array.isArray(p) && p.length===2 && p.every(n=>Number.isFinite(n) && Math.abs(n)<=100000);
const dateOK = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v && v<=new Date().toISOString().slice(0,10);
const samePoint=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1])<0.01;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment=(a,b,p)=>Math.abs(cross(a,b,p))<1e-7 && p[0]>=Math.min(a[0],b[0])-1e-7 && p[0]<=Math.max(a[0],b[0])+1e-7 && p[1]>=Math.min(a[1],b[1])-1e-7 && p[1]<=Math.max(a[1],b[1])+1e-7;
function inPolygon(p,polygon) {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];if(onSegment(a,b,p))return true;
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function intersects(a,b,c,d) {
  return cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0 || onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}

/** Reject a whole pack before touching persisted data. No external assets or executable SVG. */
export function validateMapPack(pack, buildings, {allowSynthetic=false}={}) {
  const errors=[];
  const check=(condition,message)=>{if(!condition && errors.length<60)errors.push(message);};
  if (!pack || typeof pack!=='object') throw new Error('Нужен JSON-объект набора карт');
  check(pack.schemaVersion===1,'Поддерживается schemaVersion: 1');
  check(pack.campusId===CAMPUS_ID,'Неверный campusId');
  check(pack.synthetic===false || allowSynthetic && pack.synthetic===true,'Синтетический набор нельзя импортировать на карту университета');
  check(typeof pack.dataVersion==='string' && pack.dataVersion.length>0 && pack.dataVersion.length<100,'Нужна dataVersion');
  check(typeof pack.source==='string' && pack.source.trim().length>0 && pack.source.length<1000,'Нужен источник набора');
  check(pack.verifiedAt===null || dateOK(pack.verifiedAt),'Некорректная дата проверки');
  const limits={floors:80,locations:3000,nodes:5000,edges:12000,routeOrigins:100,declaredTargets:3000};
  for (const [key,max] of Object.entries(limits)) check(Array.isArray(pack[key]) && pack[key].length<=max,`${key}: нужен массив, максимум ${max}`);
  if(errors.length)throw new Error(errors.join('\n'));
  const ids=new Set(buildings.map(b=>'building:'+b.id));
  const unique=(items,kind)=>{for(const x of items){check(x && idOK(x.id) && !ids.has(x.id),`${kind}: неверный или повторный id ${x?.id}`);if(x)ids.add(x.id);}};
  for(const key of ['floors','locations','nodes','edges'])unique(pack[key],key);
  if(errors.length)throw new Error(errors.join('\n'));
  const bIds=new Set(buildings.map(b=>b.id)), floors=new Map(pack.floors.map(f=>[f.id,f])), nodes=new Map(pack.nodes.map(n=>[n.id,n]));
  const locations=new Map(pack.locations.map(l=>[l.id,l]));
  const label=(v)=>typeof v==='string' && v.trim().length>0 && v.length<=240;
  const archive=pack.verification==='archive';
  const evidence=(v,kind)=>{check(label(v.source),`${kind}: нужен источник`);check(dateOK(v.verifiedAt)||archive&&v.verifiedAt===null,`${kind}: нужна дата проверки`);};
  const inside=(p,f)=>pointOK(p) && f && p[0]>=f.viewBox[0] && p[1]>=f.viewBox[1] && p[0]<=f.viewBox[0]+f.viewBox[2] && p[1]<=f.viewBox[1]+f.viewBox[3];
  for(const f of pack.floors) {
    check(bIds.has(f.buildingId) && f.campusId===pack.campusId,`${f.id}: неизвестный корпус/кампус`);
    check(label(f.name) && Number.isFinite(f.order),`${f.id}: нужны название и order этажа`);
    check(Array.isArray(f.viewBox) && f.viewBox.length===4 && f.viewBox.every(Number.isFinite) && f.viewBox[2]>0 && f.viewBox[3]>0,`${f.id}: неверный viewBox`);
    check(Array.isArray(f.areas) && f.areas.length<=3000 && Array.isArray(f.walls) && f.walls.length<=10000 && Array.isArray(f.doors) && f.doors.length<=3000,`${f.id}: нужны areas, walls, doors`);
    evidence(f,f.id);
    if(f.image)check(/^assets\/campusway\/floor-6-[345]\.(png|jpg)$/.test(f.image)&&Array.isArray(f.imageSize)&&f.imageSize.length===2&&f.imageSize.every(n=>Number.isFinite(n)&&n>0&&n<10000),`${f.id}: неизвестная подложка`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  const doors=new Map(), areas=new Map();
  for(const f of pack.floors) {
    unique(f.areas,'area'); unique(f.doors,'door');
    if(errors.length)throw new Error(errors.join('\n'));
    for(const a of f.areas) {
      check(['room','corridor'].includes(a.kind),`${a.id}: неверный kind`);
      check(Array.isArray(a.points) && a.points.length>=3 && a.points.length<=500 && a.points.every(p=>inside(p,f)),`${a.id}: неверный полигон`);
      if(a.locationId)check(locations.get(a.locationId)?.floorId===f.id,`${a.id}: неизвестное помещение`);
      areas.set(a.id,{...a,floorId:f.id});
    }
    for(const wall of f.walls)check(Array.isArray(wall) && wall.length>=2 && wall.length<=500 && wall.every(p=>inside(p,f)),`${f.id}: неверная стена`);
    for(const d of f.doors) {
      check(Array.isArray(d.points) && d.points.length===2 && d.points.every(p=>inside(p,f)),`${d.id}: дверь задаётся двумя точками`);
      const n=nodes.get(d.nodeId);
      check(n?.type==='door' && n.floorId===f.id,`${d.id}: нужен узел двери на том же этаже`);
      if(n && pointOK(n.point) && d.points?.length===2 && d.points.every(pointOK)) check(samePoint(n.point,[(d.points[0][0]+d.points[1][0])/2,(d.points[0][1]+d.points[1][1])/2]),`${d.id}: узел должен находиться в середине дверного проёма`);
      doors.set(d.id,{...d,floorId:f.id});
    }
  }
  for(const n of pack.nodes) {
    const f=floors.get(n.floorId);
    check(f && n.buildingId===f.buildingId && n.campusId===pack.campusId,`${n.id}: неверные ссылки на этаж/корпус/кампус`);
    check(['entrance','junction','door','stairs','lift','landmark'].includes(n.type) && label(n.name) && inside(n.point,f),`${n.id}: неверные тип, название или точка`);
    if(['stairs','lift'].includes(n.type))check(idOK(n.connectorId),`${n.id}: нужен connectorId`);
  }
  for(const l of pack.locations) {
    const f=floors.get(l.floorId), n=nodes.get(l.nodeId);
    check(f && l.buildingId===f.buildingId && l.campusId===pack.campusId,`${l.id}: неверные ссылки на этаж/корпус/кампус`);
    check(types.includes(l.type) && label(l.name) && inside(l.point,f),`${l.id}: неверные тип, название или точка`);
    check(Array.isArray(l.aliases) && l.aliases.length<=30 && l.aliases.every(label),`${l.id}: неверные aliases`);
    check(l.nodeId===null || n && n.floorId===l.floorId,`${l.id}: неверный узел маршрута`);
    if(l.type==='room') {
      check(typeof l.number==='string' && label(l.number),`${l.id}: номер аудитории должен быть строкой`);
      check(areas.get(l.areaId)?.floorId===l.floorId && areas.get(l.areaId)?.locationId===l.id,`${l.id}: нужна область помещения с обратной ссылкой`);
      check(l.nodeId===null&&!l.doorId || n?.type==='door' && doors.get(l.doorId)?.nodeId===l.nodeId && doors.get(l.doorId)?.floorId===l.floorId,`${l.id}: нужна дверь, связанная с узлом маршрута`);
      const a=areas.get(l.areaId),d=doors.get(l.doorId);
      if(a && d && !errors.length){
        check(inPolygon(l.point,a.points),`${l.id}: подпись помещения вне его области`);
        check(a.points.some((p,i)=>d.points.every(dp=>onSegment(p,a.points[(i+1)%a.points.length],dp))),`${l.id}: дверь должна находиться на границе помещения`);
      }
    }
  }
  if(errors.length)throw new Error(errors.join('\n'));
  let intersectionBudget=2000000;
  for(const e of pack.edges) {
    const a=nodes.get(e.from), b=nodes.get(e.to);
    check(a && b && a.id!==b.id,`${e.id}: неверные концы ребра`);
    check(Number.isFinite(e.weight) && e.weight>=0,`${e.id}: вес должен быть неотрицательным`);
    check(['corridor','door','stairs','lift'].includes(e.kind) && ['both','forward'].includes(e.direction),`${e.id}: неверный тип или направление`);
    check((['open','closed','staff','unknown'].includes(e.status)||archive&&e.status==='plan') && [true,false,null].includes(e.stepFree),`${e.id}: нужны status и stepFree`);
    evidence(e,e.id);
    if(!a || !b)continue;
    check(a.buildingId===b.buildingId,`${e.id}: наружные переходы пока не поддерживаются`);
    if(a.floorId!==b.floorId) {
      check(['stairs','lift'].includes(e.kind) && a.type===e.kind && b.type===e.kind && a.connectorId===b.connectorId,`${e.id}: этажи соединяются площадками одной лестницы/лифта`);
      check(e.geometry===null,`${e.id}: межэтажная связь не рисуется прямой линией`);
    } else {
      const f=floors.get(a.floorId), g=e.geometry;
      const valid=Array.isArray(g) && g.length>=2 && g.length<=500 && g.every(p=>inside(p,f));
      check(valid,`${e.id}: нужна линия прохода geometry`);
      if(valid) {
        check(samePoint(g[0],a.point) && samePoint(g.at(-1),b.point),`${e.id}: линия должна соединять узлы`);
        intersectionBudget-=(g.length-1)*f.walls.reduce((n,w)=>n+w.length-1,0);
        if(intersectionBudget<0)throw new Error('Слишком сложная геометрия: упростите стены и линии проходов');
        for(let i=1;i<g.length;i++)for(const wall of f.walls)for(let j=1;j<wall.length;j++) {
          check(!intersects(g[i-1],g[i],wall[j-1],wall[j]),`${e.id}: линия пересекает стену`);
        }
      }
    }
  }
  for(const key of ['routeOrigins','declaredTargets']) {
    check(new Set(pack[key]).size===pack[key].length,`${key}: повторные ссылки`);
    for(const id of pack[key])check(locations.get(id)?.nodeId,`${key}: неизвестная точка ${id}`);
  }
  if(errors.length)throw new Error(errors.join('\n'));
  const adjacent=new Map(pack.nodes.map(n=>[n.id,[]]));
  for(const e of pack.edges)if(usableEdge(e,false,archive)){adjacent.get(e.from).push(e.to);if(e.direction==='both')adjacent.get(e.to).push(e.from);}
  const queue=pack.routeOrigins.map(id=>locations.get(id).nodeId), reached=new Set(queue);
  for(let i=0;i<queue.length;i++)for(const id of adjacent.get(queue[i]))if(!reached.has(id)){reached.add(id);queue.push(id);}
  for(const id of pack.declaredTargets) check(reached.has(locations.get(id).nodeId),`${id}: заявленная цель недостижима от routeOrigins по открытым проходам`);
  if(pack.floors.length)check(dateOK(pack.verifiedAt)||archive&&pack.verifiedAt===null,'Для набора с этажами нужна дата проверки');
  if(errors.length)throw new Error(errors.join('\n'));
  return pack;
}

export function createMapData(pack, buildings, options) {
  validateMapPack(pack,buildings,options);
  return {...pack,buildings,locations:[...buildings.map(b=>({id:'building:'+b.id,campusId:pack.campusId,buildingId:b.id,floorId:null,type:'building',name:b.name,number:b.id,aliases:['корпус '+b.id],point:b.center,nodeId:null})),...pack.locations]};
}
