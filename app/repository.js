import {normalizeSchedule,normalizeGroups,validateEvents} from './core.js';
import {createMapData} from './map/data.js';
import {withPlaceReference} from './map/search.js';
const prefix='uust.campus.v1.';
export const storage = {
  read(key,fallback=null) {try {const value=localStorage.getItem(prefix+key);return value===null?fallback:JSON.parse(value);} catch {return fallback;}},
  write(key,value) {try {localStorage.setItem(prefix+key,JSON.stringify(value));return true;} catch {return false;}},
  remove(key) {try {localStorage.removeItem(prefix+key);} catch {}}
};
export async function json(url, timeout=22000) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),timeout);
  try {const response=await fetch(url,{signal:controller.signal,cache:'no-store'});if(!response.ok){console.warn('Campus data load failed',url,response.status);throw new Error('Источник временно недоступен');}return await response.json();}
  finally {clearTimeout(timer);}
}
export async function initialData() {
  const [config, buildings, bundledEvents, groups, snapshot, raw, mapPack, clubs] = await Promise.all([
    json('data/config.json'),json('data/buildings.json'),json('data/events.json'),json('data/groups.json'),json('data/snapshot.json'),json('data/schedule-14381-241.json'),json('data/maps.json'),json('data/clubs.json'),json('data/clubs.json')
  ]);
  const saved=storage.read('events');
  let events;
  try {events=saved?validateEvents(saved,true):validateEvents(bundledEvents);} catch {events=validateEvents(bundledEvents);}
  let groupList;
  try{groupList=normalizeGroups(storage.read('groups')||groups);}catch{groupList=normalizeGroups(groups);}
  return {config,mapPack,clubs:clubs.clubs,buildings:buildings.buildings,events,bundledEvents,groups:groupList,snapshot,seedRaw:raw,eventsUpdated:saved?.updatedAt||bundledEvents.updatedAt};
}
export function loadSavedSchedule(groupId, data) {
  const key=`schedule.${data.config.semester}.${groupId}`, saved=storage.read(key);
  if(saved) {try{return {rows:linkSchedule(normalizeSchedule(saved.raw,groupId),data),loaded:true,at:saved.at,source:'cache'};}catch{storage.remove(key);}}
  if(+groupId===data.snapshot.groupId && data.config.semester===data.snapshot.semester) return {rows:linkSchedule(normalizeSchedule(data.seedRaw,groupId),data),loaded:true,at:data.snapshot.capturedAt,source:'bundled'};
  return {rows:[],loaded:false,at:null,source:null};
}
function linkSchedule(rows,data) {
  if(!data)return rows;
  let map;
  try{map=createMapData(storage.read('maps')||data.mapPack,data.buildings);}catch{map=createMapData(data.mapPack,data.buildings);}
  return rows.map(row=>withPlaceReference(map,row));
}
export async function refreshSchedule(groupId,config,data) {
  const raw=await json(`/api/schedule?group=${encodeURIComponent(groupId)}&semester=${config.semester}`), rows=linkSchedule(normalizeSchedule(raw,groupId),data), at=new Date().toISOString();
  const persisted=storage.write(`schedule.${config.semester}.${groupId}`,{raw,at});
  return {rows,loaded:true,at,source:'live',persisted};
}
export async function refreshGroups() {
  const raw=await json('/api/groups'),groups=normalizeGroups(raw);storage.write('groups',raw);return groups;
}
