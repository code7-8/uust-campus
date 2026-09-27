import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMapData,validateMapPack} from '../app/map/data.js';
import {searchPlaces,resolvePlace,withPlaceReference} from '../app/map/search.js';
import {findRoute,routeSteps} from '../app/map/routing.js';
import {validateEvents,normalizeSchedule} from '../app/core.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const buildings=read('../app/data/buildings.json').buildings;
const fixture=read('./fixtures/map-pilot.json');
const data=createMapData(fixture,buildings,{allowSynthetic:true});
const start='test-3-1-entry',end='test-3-2-door';
const check=p=>validateMapPack(p,buildings,{allowSynthetic:true});
test('bundled campus is valid, has no invented floors, entrances or routes',()=>{
  const pack=read('../app/data/maps.json');check(pack);
  const real=createMapData(pack,buildings);
  assert.equal(real.locations.length,9);assert.equal(real.floors.length,0);assert.equal(real.edges.length,0);
  assert.equal(searchPlaces(real,'412').length,0);assert.equal(resolvePlace(real,{buildingId:'3',room:'412'}).exact,false);
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
