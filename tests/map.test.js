import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMapData,validateMapPack} from '../app/map/data.js';
import {searchPlaces,resolvePlace,withPlaceReference} from '../app/map/search.js';
import {findRoute,routeSteps} from '../app/map/routing.js';
import {floorRooms,planJourney,journeySteps,journeyGraph} from '../app/map/journey.js';
import {floorSvg,campusSvg} from '../app/map/svg.js';
import {validateEvents,normalizeSchedule} from '../app/core.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const buildings=read('../app/data/buildings.json').buildings;
const fixture=read('./fixtures/map-pilot.json');
const data=createMapData(fixture,buildings,{allowSynthetic:true});
const start='test-3-1-entry',end='test-3-2-door';
const check=p=>validateMapPack(p,buildings,{allowSynthetic:true});
test('CampusWay archive has real source floors and rooms but no field-verified route',()=>{
  const pack=read('../app/data/maps.json');check(pack);
  const real=createMapData(pack,buildings);
  assert.equal(real.floors.filter(f=>f.id.startsWith('cw-')).length,3);assert.equal(real.verification,'archive');assert.equal(real.verifiedAt,null);
  assert.equal(searchPlaces(real,'6-416')[0].id,'cw-6-416');assert.equal(searchPlaces(real,'6 корпус 513')[0].id,'cw-6-513');
  assert.equal(resolvePlace(real,{buildingId:'3',room:'412'}).exact,false);
  const a=real.locations.find(l=>l.id==='cw-6-416').nodeId,b=real.locations.find(l=>l.id==='cw-6-513').nodeId;
  assert.equal(findRoute(real,a,b),null);
  assert.ok(findRoute(real,a,b,{allowArchive:true}));
  assert.equal(findRoute(real,a,b,{allowArchive:true,stepFree:true}),null);
  assert.ok(real.edges.every(e=>e.status==='plan'&&e.verifiedAt===null));
});
test('synthetic fixtures are rejected by production validation/import',()=>assert.throws(()=>validateMapPack(fixture,buildings),/Синтетический/));
test('building synonyms and exact room search do not choose an ambiguous building',()=>{
  for(const q of ['Корпус 3','3 корпус','корп. 3','к. 3'])assert.deepEqual(searchPlaces(data,q).map(l=>l.id),['building:3']);
  for(const q of ['412','Аудитория 412','Кабинет 412','ауд. 412'])assert.deepEqual(searchPlaces(data,q).map(l=>l.buildingId),['3','7']);
  for(const q of ['3 корпус 412','корпус 3 412','3 корпус ауд. 412'])assert.deepEqual(searchPlaces(data,q).map(l=>l.id),['test-3-2-place-room']);
  assert.equal(searchPlaces(data,'ауд 101а')[0].number,'101А');
  assert.equal(searchPlaces(data,'41').length,0);
  assert.equal(searchPlaces(data,'9 корпус 412').length,0);
  assert.equal(searchPlaces(data,'412','7')[0].buildingId,'7');
});
test('POI synonyms and filters return only mapped places',()=>{
  for(const q of ['Буфет','кафе','столовая'])assert.ok(searchPlaces(data,q).every(l=>l.type==='cafe'));
  for(const q of ['Туалет','WC','санузел'])assert.equal(searchPlaces(data,q).length,3);
  assert.equal(searchPlaces(data,'Библиотека').length,3);
  assert.equal(searchPlaces(data,'','3','entrance').length,3);
});
test('event/lesson references preserve source labels and never infer floor from room number',()=>{
  const room={buildingId:'3',room:'412'};
  assert.equal(resolvePlace(data,room).location.floorId,'test-3-f2');
  assert.equal(resolvePlace(data,{room:'412'}).location,null);
  assert.equal(resolvePlace(data,{buildingId:'7',room:'101А'}).location.id,'building:7');
  assert.equal(resolvePlace(data,{buildingId:'3',place:'Актовый зал'}).location.id,'building:3');
  assert.equal(resolvePlace(data,{buildingId:'3',locationId:'deleted'}).exact,false);
  assert.equal(resolvePlace(data,{buildingId:'7',locationId:'test-3-2-place-room'}).location.id,'building:7');
  assert.equal(resolvePlace(data,{buildingId:'3',room:'412',campusId:'another-campus'}).location,null);
  assert.equal(resolvePlace(data,{buildingId:'3',room:'412',floorId:'wrong-floor'}).exact,false);
  assert.equal(resolvePlace(data,{buildingId:'3',room:'412',floorId:'wrong-floor'}).location.id,'building:3');
  const linked=withPlaceReference(data,room);assert.equal(linked.locationId,'test-3-2-place-room');assert.equal(linked.room,'412');
  const event=validateEvents({schemaVersion:1,events:[{id:'e',title:'Test',date:'2026-09-28',place:'Исходная подпись',locationId:linked.locationId}]})[0];
  assert.equal(resolvePlace(data,event).location.id,linked.locationId);assert.equal(event.place,'Исходная подпись');
  const rows=normalizeSchedule(read('../app/data/schedule-14381-241.json'),14381);
  for(const l of rows){const mapped=withPlaceReference(data,l);assert.equal(mapped.room,l.room);}
});
test('Dijkstra uses door node, does not use the closed shortcut, and supports zero weights',()=>{
  const route=findRoute(data,start,'test-3-1-door');assert.ok(route);
  assert.equal(route.endId,'test-3-1-door');assert.equal(route.links.length,2);
  assert.ok(route.links.every(l=>l.edge.status==='open'));
  const changed=structuredClone(data);changed.edges.find(e=>e.id==='test-3-1-edge-entry').weight=0;
  assert.ok(findRoute(changed,start,'test-3-1-door'));
  assert.deepEqual(findRoute(data,start,start).links,[]);
});
test('two floors are connected through a specific stair and steps retain target',()=>{
  const route=findRoute(data,start,end);assert.ok(route);
  assert.equal(route.links.filter(l=>l.edge.kind==='stairs').length,1);
  const steps=routeSteps(data,route);assert.ok(steps.some(s=>s.nextFloorId==='test-3-f2'));
  assert.equal(steps.at(-1).nodeId,end);
  assert.equal(findRoute(data,start,end,{stepFree:true}),null);
});
test('closed, staff, unknown, disconnected and directed edges cannot create a route',()=>{
  for(const status of ['closed','staff','unknown']) {
    const p=structuredClone(data);p.edges.find(e=>e.id==='test-vertical').status=status;
    assert.equal(findRoute(p,start,end),null);
  }
  const p=structuredClone(data);p.edges.find(e=>e.id==='test-vertical').direction='forward';
  assert.ok(findRoute(p,start,end));assert.equal(findRoute(p,end,start),null);
  assert.equal(findRoute(data,start,'test-7-1-door'),null);
  assert.equal(findRoute(data,'unknown',end),null);
  const same=structuredClone(data);same.edges.find(e=>e.id==='test-3-1-edge-room').stepFree=null;
  assert.equal(findRoute(same,start,'test-3-1-door',{stepFree:true}),null);
});
test('validation catches duplicate IDs, bad references, geometry, evidence and unreachable targets',()=>{
  const corrupt=[
    p=>p.nodes.push(p.nodes[0]), p=>p.locations[0].floorId='bad',
    p=>p.locations.find(l=>l.type==='room').number=412,
    p=>p.locations.find(l=>l.type==='room').doorId='missing',
    p=>p.nodes.find(n=>n.id==='test-3-2-stairs').connectorId='different-stair',
    p=>p.edges[0].weight=-1,p=>p.edges[0].from='missing',p=>p.edges[0].geometry=[[40,40],[500,300]],
    p=>p.edges.find(e=>e.id==='test-vertical').status='closed',
    p=>p.floors[0].verifiedAt=null,p=>p.edges[0].verifiedAt='2099-01-01',
    p=>p.floors[0].walls.push([[100,200],[100,240]]),
    p=>p.floors[0].doors[0].points=[[118,180],[140,180]],
    p=>p.routeOrigins.push('missing'),p=>p.nodes[0].point=[NaN,0],
    p=>p.locations.find(l=>l.type==='room').point=[550,350],
  ];
  for(const mutate of corrupt){const pack=structuredClone(fixture);mutate(pack);assert.throws(()=>check(pack));}
});

const archive=createMapData(read('../app/data/maps.json'),buildings);

test('campus routes turn at corridor junctions instead of visiting and retracing building centres',()=>{
  for(const [a,b] of [['9','4'],['4','9'],['2','5'],['5','2'],['2','4'],['4','2']]){
    const j=planJourney(archive,'building:'+a,'building:'+b,{mode:'indoor'});
    assert.ok(j.route);
    assert.ok(!j.route.nodeIds.includes('campus:building:6'),`${a} → ${b} detours into building 6`);
    assert.ok(!j.route.nodeIds.includes('campus:building:3'),`${a} → ${b} detours into building 3`);
    const points=j.route.nodeIds.map(id=>j.graph.nodes.find(n=>n.id===id).point.join(','));
    assert.equal(new Set(points).size,points.length,'route must not retrace a corridor');
    assert.ok(j.route.cost<({'9-4':1791.87,'4-9':1791.87,'2-5':676,'5-2':676,'2-4':867,'4-2':867})[a+'-'+b]);
    assert.doesNotMatch(campusSvg({...archive,campus:j.graph},null,j.route),/NaN|undefined/);
  }
});

test('split campus passage segments stay connected to their drawn endpoints in both directions',()=>{
  const nodes=new Map(archive.campus.nodes.map(n=>[n.id,n]));
  for(const edge of archive.campus.edges.filter(e=>e.kind==='passage')){
    assert.deepEqual(edge.geometry[0],nodes.get(edge.from).point);
    assert.deepEqual(edge.geometry.at(-1),nodes.get(edge.to).point);
    assert.ok(edge.weight>0);
  }
  for(const a of buildings)for(const b of buildings){
    const forward=planJourney(archive,'building:'+a.id,'building:'+b.id,{mode:'indoor'}).route;
    const reverse=planJourney(archive,'building:'+b.id,'building:'+a.id,{mode:'indoor'}).route;
    assert.ok(forward);assert.ok(reverse);
    assert.ok(Math.abs(forward.cost-reverse.cost)<1e-6);
  }
});

test('every floor lists its rooms in numeric order; unmapped doors remain explicit',()=>{
  assert.deepEqual(archive.floors.filter(f=>f.id.startsWith('cw-')).map(f=>floorRooms(archive,f.id).length),[21,14,12]);
  assert.equal(floorRooms(archive,'cw-6-f3')[0].number,'301');
  const rooms=archive.locations.filter(l=>l.type==='room'&&l.id.startsWith('cw-'));
  assert.equal(rooms.filter(l=>l.nodeId).length,44);
  for(const l of rooms.filter(l=>!l.nodeId))assert.equal(planJourney(archive,'building:6',l.id).route,null);
});
test('room-to-room routes across all three floors are continuous, without uncharted ground-floor shortcuts',()=>{
  const rooms=archive.locations.filter(l=>l.type==='room'&&l.nodeId&&l.id.startsWith('cw-'));
  for(const a of rooms)for(const b of rooms){
    const {route}=planJourney(archive,a.id,b.id);
    assert.ok(route,`${a.id} → ${b.id}`);
    assert.equal(route.startId,a.nodeId);assert.equal(route.endId,b.nodeId);
    assert.equal(route.partial,false);assert.equal(route.outdoor,false);
    assert.ok(route.links.every(l=>l.edge.geometry||l.edge.kind==='stairs'));
  }
  const j=planJourney(archive,'cw-6-301','cw-6-513');
  assert.deepEqual(journeySteps(j.graph,j.route).filter(s=>s.nextFloorId).map(s=>s.nextFloorId),['cw-6-f4','cw-6-f5']);
});
test('underground 6–7 passage beats the street detour and respects route modes',()=>{
  const shortest=planJourney(archive,'building:6','building:7');
  const indoor=planJourney(archive,'building:6','building:7',{mode:'indoor'});
  const outside=planJourney(archive,'building:6','building:8',{mode:'outdoor'});
  assert.equal(shortest.route.outdoor,false);assert.equal(shortest.route.cost,indoor.route.cost);
  assert.ok(shortest.route.links.some(l=>l.edge.underground));
  assert.ok(journeySteps(indoor.graph,indoor.route).some(s=>s.text.includes('Подземный переход')));
  const detour=planJourney(archive,'building:6','building:7',{mode:'outdoor'});
  assert.ok(detour.route.outdoor);assert.ok(shortest.route.cost<detour.route.cost);
  assert.ok(indoor.route.links.every(l=>!['outdoor','access'].includes(l.edge.kind)));
  assert.ok(outside.route.links.every(l=>l.edge.kind!=='passage'));
  assert.equal(planJourney(archive,'building:6','building:7',{stepFree:true}).route,null);
});
test('building/room routes work in both directions and mark manual entrance handoffs without geometry',()=>{
  for(const [a,b] of [['building:7','cw-6-416'],['cw-6-513','building:2']]){
    const j=planJourney(archive,a,b);assert.ok(j.route);assert.equal(j.route.partial,true);
    assert.ok(j.route.links.some(l=>l.edge.kind==='handoff'));
    assert.ok(j.route.links.filter(l=>l.edge.manual).every(l=>l.edge.geometry===null));
    assert.ok(journeySteps(j.graph,j.route).some(s=>s.manual));
    assert.match(campusSvg({...archive,campus:j.graph},null,j.route),/map-territory/);
    for(const floor of archive.floors){const svg=floorSvg(j.graph,floor,null,j.route);assert.doesNotMatch(svg,/NaN|undefined/);}
  }
});
test('same endpoint and disconnected graph are handled without inventing a route',()=>{
  const j=planJourney(archive,'cw-6-416','cw-6-416');assert.equal(j.route.links.length,0);assert.equal(journeySteps(j.graph,j.route).length,1);
  assert.equal(planJourney(archive,'missing','cw-6-416').route,null);
  const changed={...archive,edges:[]};assert.equal(planJourney(changed,'cw-6-416','cw-6-513').route,null);
});

test('survey plans extend both buildings and every mapped room connects to its building or isolated annex',()=>{
  assert.deepEqual(archive.floors.filter(f=>f.buildingId==='6').map(f=>f.order),[1,2,3,4,4.5,5]);
  assert.deepEqual(archive.floors.filter(f=>f.buildingId==='7').map(f=>f.order),[1,2,3,4]);
  assert.equal(archive.locations.filter(l=>l.type==='room').length,121);
  for(const room of archive.locations.filter(l=>l.type==='room'&&l.nodeId)){
    const start=room.floorId==='sv-6-f4-annex'?'sv-6-401a':room.buildingId==='6'?'sv-6-101':'sv-7-101';
    for(const [a,b] of [[start,room.id],[room.id,start]]){
      const {route}=planJourney(archive,a,b);assert.ok(route,`${a} → ${b}`);
      assert.equal(route.partial,false);assert.equal(route.outdoor,false);
    }
    const svg=floorSvg(archive,archive.floors.find(f=>f.id===room.floorId),room,null);
    assert.match(svg,new RegExp(room.id));assert.doesNotMatch(svg,/NaN|undefined/);
  }
  const {graph,route}=planJourney(archive,'sv-6-101','cw-6-513');
  assert.deepEqual(journeySteps(graph,route).filter(s=>s.nextFloorId).map(s=>s.nextFloorId),['sv-6-f2','cw-6-f3','cw-6-f4','cw-6-f5']);
  const across=planJourney(archive,'sv-7-101','sv-7-407');
  assert.equal(across.route.links.filter(l=>l.edge.kind==='stairs').length,3);
});

test('known entrance anchors replace upper-floor teleportation and do not connect the ambiguous annex',()=>{
  const g=journeyGraph(archive);
  assert.equal(g.edges.filter(e=>e.kind==='handoff').length,2);
  for(const e of g.edges.filter(e=>e.kind==='handoff'))assert.equal(archive.floors.find(f=>f.id===g.nodes.find(n=>n.id===e.to).floorId).order,1);
  for(const start of ['building:6','building:7','cw-6-416','cw-6-513'])assert.equal(planJourney(archive,start,'sv-6-401a').route,null);
  assert.ok(planJourney(archive,'sv-6-401a','sv-6-407').route);
  assert.ok(planJourney(archive,'sv-6-101','sv-7-407').route);
  for(const mutate of [p=>p.campusAnchors.push('sv-6-401a'),p=>p.floors[0].costScale=-1]){
    const p=read('../app/data/maps.json');mutate(p);assert.throws(()=>check(p));
  }
});

test('duplicate printed room numbers stay ambiguous and removed buffet is not searchable',()=>{
  for(const [building,number] of [['6','216'],['7','205'],['7','206'],['7','109']]){
    assert.equal(searchPlaces(archive,building+'-'+number).length,2);
    assert.equal(resolvePlace(archive,{buildingId:building,room:number}).exact,false);
  }
  for(const q of ['Буфет','кафе','столовая'])assert.equal(searchPlaces(archive,q,'6').length,0);
  assert.equal(resolvePlace(archive,{buildingId:'7',room:'407'}).location.id,'sv-7-407');
  assert.ok(searchPlaces(archive,'библиотека').some(l=>l.id==='sv-7-115'));
  assert.equal(archive.floors.some(f=>f.buildingId==='6'&&f.order===6),false);
});

test('source-plan toggle cannot make vector-only floors invisible',()=>{
  const f=archive.floors.find(f=>f.id==='sv-6-f1');
  assert.doesNotMatch(floorSvg(archive,f,null,null,'all',true),/class="map-floor source-plan"/);
  assert.match(floorSvg(archive,archive.floors.find(f=>f.id==='cw-6-f3'),null,null,'all',true),/floor-source-image/);
});
