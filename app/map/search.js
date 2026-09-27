export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/[.,№]/g,' ').replace(/\s+/g,' ').trim();
const synonyms = {буфет:['буфет','кафе','столовая','еда'],туалет:['туалет','санузел','wc','уборная'],библиотека:['библиотека','читальный зал'],вход:['вход','вестибюль'],лестница:['лестница','ступени'],лифт:['лифт']};
const tokens = value => normalize(value).split(' ').map(w => Object.entries(synonyms).find(([,words])=>words.includes(w))?.[0] || w);
export function parseQuery(query) {
  let q=normalize(query), buildingId=null;
  const compact=q.match(/^([1-9])\s*[-/]\s*(\d+[а-яa-z]?)$/);
  if(compact)return {buildingId:compact[1],text:compact[2],roomExplicit:true};
  const candidates=[q.match(/(?:корпус|корп|к)\s*(\d+)(?=\s|$)/),q.match(/(?:^|\s)(\d+)\s*(?:корпус|корп|к)(?=\s|$)/)].filter(Boolean);
  const match=candidates.sort((a,b)=>a.index-b.index)[0];
  if (match) {buildingId=match[1]; q=q.replace(match[0],' ').trim();}
  const roomExplicit=/(?:^|\s)(?:аудитория|ауд|кабинет|каб)(?=\s|$)/.test(q);
  q=q.replace(/(?:^|\s)(?:аудитория|ауд|кабинет|каб)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
  return {buildingId, text:q, roomExplicit};
}
export function searchPlaces(data, query, currentBuilding=null, type='all') {
  const {buildingId,text,roomExplicit}=parseQuery(query), terms=tokens(text).filter(Boolean);
  const results=data.locations.filter(l => {
    if (buildingId && l.buildingId!==buildingId || type!=='all' && l.type!==type) return false;
    if (roomExplicit && l.type!=='room') return false;
    // A room number is exact, including letters and punctuation. Never fuzzy-match another room.
    if (text && /\d/.test(text)) {
      return l.type==='room' ? normalize(l.number)===text : !roomExplicit && !buildingId && l.type==='building' && normalize(l.number)===text;
    }
    if (buildingId && !text && !roomExplicit) return l.type==='building';
    const haystack=tokens([l.name, l.type==='room'?'аудитория кабинет':'', ...(l.aliases||[])].join(' '));
    return terms.every(t => haystack.some(w => w.startsWith(t)));
  });
  return results.sort((a,b)=>(b.buildingId===currentBuilding)-(a.buildingId===currentBuilding) || a.buildingId.localeCompare(b.buildingId,'ru',{numeric:true}) || (a.floorId||'').localeCompare(b.floorId||'','ru') || a.name.localeCompare(b.name,'ru',{numeric:true}));
}

// Only a stable ID or an exact room number WITH a confirmed building may resolve a room.
export function resolvePlace(data, context={}) {
  if(context.campusId && context.campusId!==data.campusId)return {location:null,exact:false};
  const building=data.buildings.find(b => b.id===context.buildingId);
  const fallback=data.locations.find(l => l.type==='building' && l.buildingId===building?.id) || null;
  if (context.locationId) {
    const exact=data.locations.find(l => l.id===context.locationId);
    if (exact && (!context.buildingId || exact.buildingId===context.buildingId) && (!context.floorId || exact.floorId===context.floorId)) return {location:exact, exact:true};
    return {location:fallback, exact:false};
  }
  if (building && context.room) {
    const q=parseQuery(context.room);
    const matches=data.locations.filter(l => l.type==='room' && l.buildingId===building.id && normalize(l.number)===q.text);
    if (matches.length===1 && (!q.buildingId || q.buildingId===building.id)) return {location:matches[0],exact:true};
  }
  return {location:fallback, exact:false};
}

export function withPlaceReference(data, item) {
  const {location,exact}=resolvePlace(data,item);
  return {...item,campusId:location?.campusId||null,floorId:exact?location?.floorId||null:null,locationId:exact?location?.id||null:null};
}
