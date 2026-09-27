// Weights are relative costs, never metres or minutes.
export function usableEdge(edge, stepFree = false, allowArchive = false) {
  return (edge.status === 'open' || allowArchive && edge.status === 'plan') && (!stepFree || (edge.stepFree === true && edge.kind !== 'stairs'));
}

export function findRoute(data, startId, endId, {stepFree = false,allowArchive=false} = {}) {
  const nodes = new Map(data.nodes.map(n => [n.id, n]));
  if (!nodes.has(startId) || !nodes.has(endId)) return null;
  const adjacency = new Map(data.nodes.map(n => [n.id, []]));
  for (const e of data.edges) {
    if (!usableEdge(e, stepFree,allowArchive) || !Number.isFinite(e.weight) || e.weight < 0) continue;
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    adjacency.get(e.from).push({to:e.to, edge:e, reverse:false});
    if (e.direction === 'both') adjacency.get(e.to).push({to:e.from, edge:e, reverse:true});
  }
  const distance = new Map([[startId, 0]]), previous = new Map(), visited = new Set();
  while (true) {
    let current = null, best = Infinity;
    for (const [id, cost] of distance) if (!visited.has(id) && cost < best) {current=id; best=cost;}
    if (current === null) return null;
    if (current === endId) break;
    visited.add(current);
    for (const link of adjacency.get(current)) {
      const cost = best + link.edge.weight;
      if (!visited.has(link.to) && cost < (distance.get(link.to) ?? Infinity)) {
        distance.set(link.to, cost); previous.set(link.to, {from:current, ...link});
      }
    }
  }
  const links = [];
  for (let id=endId; id!==startId;) {const p=previous.get(id); links.unshift(p); id=p.from;}
  return {startId, endId, links, nodeIds:[startId, ...links.map(l => l.to)], stepFree};
}

export function routeSteps(data, route) {
  if (!route) return [];
  const nodes = new Map(data.nodes.map(n => [n.id,n]));
  if(data.kind==='campus')return route.nodeIds.filter(id=>nodes.get(id).buildingId).map((id,index,ids)=>({
    text:ids.length===1?'Старт и цель: '+nodes.get(id).name:(index===0?'Начало: ':index===ids.length-1?'Цель: ':'Через: ')+nodes.get(id).name,
    floorId:null,nodeId:id
  }));
  const floorName = id => data.floors.find(f => f.id===id)?.name || id;
  const name = id => data.locations.find(l => l.nodeId===id)?.name || nodes.get(id)?.name || 'ориентир';
  const steps = [{text:`Начало: ${name(route.startId)}`, floorId:nodes.get(route.startId).floorId, nodeId:route.startId}];
  for (const link of route.links) {
    const from=nodes.get(link.from), to=nodes.get(link.to);
    if (from.floorId!==to.floorId) steps.push({
      text:`${link.edge.kind==='lift'?'На лифте':'По лестнице'} «${from.name}» → ${floorName(to.floorId)}`,
      floorId:from.floorId, nextFloorId:to.floorId, nodeId:from.id
    });
    else if (link.to!==route.endId && ['junction','stairs','lift'].includes(to.type)) {
      steps.push({text:`Следуйте по линии до: ${name(to.id)}`, floorId:to.floorId, nodeId:to.id});
    }
  }
  steps.push({text:`Цель: ${name(route.endId)}`, floorId:nodes.get(route.endId).floorId, nodeId:route.endId});
  return steps;
}
