import {findRoute} from './routing.js';

export const placeNode=place=>place?.type==='building'?'campus:building:'+place.buildingId:place?.nodeId;
export const floorRooms=(data,id)=>data.locations.filter(l=>l.floorId===id&&l.type==='room')
  .sort((a,b)=>a.number.localeCompare(b.number,'ru',{numeric:true}));

export function journeyGraph(data,{mode='shortest'}={}) {
  // Image pixels differ between floors. Compare relative cost using wing length,
  // including a stair penalty, never advertise these costs as metres or minutes.
  const scale=floorId=>{
    const f=data.floors.find(f=>f.id===floorId);
    return f?.costScale??(f?.imageSize?315/(f.imageSize[0]-(f.order===3?280:0)):1);
  };
  const nodes=[...data.campus.nodes,...data.nodes];
  const byId=new Map(nodes.map(n=>[n.id,n]));
  const edges=[...data.campus.edges.filter(e=>mode==='indoor'?!['outdoor','access'].includes(e.kind):mode==='outdoor'?e.kind!=='passage':true),
    ...data.edges.map(e=>({...e,weight:e.kind==='stairs'?60:e.kind==='lift'?75:e.weight*scale(byId.get(e.from).floorId)}))];
  // New packs explicitly name campus anchors. Do not teleport to every stair
  // or to an unconnected annex; older imported packs retain their handoffs.
  for(const id of data.campusAnchors??data.routeOrigins){
    const place=data.locations.find(l=>l.id===id),n=byId.get(place?.nodeId);
    if(!n||!['stairs','entrance','lift'].includes(n.type))continue;
    const f=data.floors.find(f=>f.id===n.floorId);
    edges.push({id:'handoff:'+n.id,from:'campus:building:'+n.buildingId,to:n.id,kind:'handoff',direction:'both',
      weight:120+60*Math.abs((f?.order||1)-1),status:'plan',stepFree:null,geometry:null,manual:true});
  }
  return {...data,kind:'journey',nodes,edges};
}

export function planJourney(data,startPlaceId,endPlaceId,options={}) {
  const start=data.locations.find(l=>l.id===startPlaceId),end=data.locations.find(l=>l.id===endPlaceId);
  const graph=journeyGraph(data,options),a=placeNode(start),b=placeNode(end);
  if(!a||!b)return {graph,route:null,reason:'Для этого кабинета ещё не размечена дверь. Его можно посмотреть на плане.'};
  // Indoor routes within one building must not invent a shortcut through an
  // uncharted ground floor. Prefer continuous mapped corridors and staircases.
  const sameInterior=start.type!=='building'&&end.type!=='building'&&start.buildingId===end.buildingId;
  const routingData=sameInterior?{...graph,edges:graph.edges.filter(e=>e.kind!=='handoff')}:graph;
  const route=findRoute(routingData,a,b,{stepFree:options.stepFree,allowArchive:true});
  if(route){
    route.partial=route.links.some(l=>l.edge.manual);
    route.outdoor=route.links.some(l=>l.edge.kind==='outdoor');
    route.cost=route.links.reduce((n,l)=>n+l.edge.weight,0);
  }
  return {graph,route,reason:route?'':options.stepFree?'Нет полностью проверенного пути без ступеней.':'Нет размеченного пути с выбранными условиями.'};
}

export function journeySteps(graph,route) {
  if(!route)return [];
  const nodes=new Map(graph.nodes.map(n=>[n.id,n]));
  const floorName=id=>graph.floors.find(f=>f.id===id)?.name||'';
  const name=id=>graph.locations.find(l=>placeNode(l)===id)?.name||nodes.get(id)?.name||'Ориентир';
  const step=(text,node,extra={})=>({text,nodeId:node.id,floorId:node.floorId,...extra});
  if(route.startId===route.endId)return [step('Вы уже в выбранной точке: '+name(route.endId),nodes.get(route.endId))];
  const result=[step('Начало: '+name(route.startId),nodes.get(route.startId))];
  for(let i=0;i<route.links.length;i++){
    const link=route.links[i],from=nodes.get(link.from),to=nodes.get(link.to),kind=link.edge.kind;
    if(kind==='handoff'){
      const entering=!!to.floorId,indoor=entering?to:from;
      result.push(step(entering?`Корпус ${indoor.buildingId}: самостоятельно найдите «${indoor.name}», ${floorName(indoor.floorId)}. Отсюда начинается линия по этажу.`:
        `От «${indoor.name}» выйдите к территории корпуса ${indoor.buildingId}. Связь входа с наружной схемой ещё не размечена.`,entering?to:from,{manual:true,nextFloorId:to.floorId}));
    }else if(kind==='access'){
      result.push(step(from.buildingId?`Выйдите из корпуса ${from.buildingId} на улицу. Точное место выхода на схеме не отмечено.`:
        `Найдите открытый вход в корпус ${to.buildingId}. Место входа нужно уточнить на месте.`,to,{manual:true}));
    }else if(kind==='outdoor'){
      if(route.links[i-1]?.edge.kind!=='outdoor')result.push(step('Уличный участок: ориентировочный обход по схеме. Дорожки и ограждения не проверены.',from,{approximate:true}));
    }else if(kind==='passage'){
      if(to.buildingId)result.push(step('По переходам: '+name(to.id),to));
    }else if(from.floorId!==to.floorId){
      const direction=(graph.floors.find(f=>f.id===to.floorId)?.order||0)>(graph.floors.find(f=>f.id===from.floorId)?.order||0)?'Поднимитесь':'Спуститесь';
      result.push(step(`${direction} ${kind==='lift'?'на лифте':'по лестнице'} → ${floorName(to.floorId)}`,from,{nextFloorId:to.floorId}));
    }
  }
  result.push(step('Цель: '+name(route.endId),nodes.get(route.endId)));
  return result;
}
