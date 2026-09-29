// Pure domain logic: all dates are calendar dates in Ufa, never the phone's zone.
export const TIME_ZONE = 'Asia/Yekaterinburg';
export const DAY = 86400000;
export const DEFAULT_CONFIG = { semester: 241, academicStart: '2026-08-31', academicEnd: '2027-08-29' };
export const dateKey = (instant = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit'}).format(instant);
export const minuteOfDay = (instant = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:TIME_ZONE,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant).split(':');
  return Number(parts[0])*60+Number(parts[1]);
};
export const addDays = (date, days) => new Date(Date.parse(date+'T12:00:00Z') + days*DAY).toISOString().slice(0,10);
export const weekday = date => new Date(date+'T12:00:00Z').getUTCDay() || 7;
export const monday = date => addDays(date, 1-weekday(date));
export const academicWeek = (date, config = DEFAULT_CONFIG) => date < config.academicStart || date > config.academicEnd ? null : Math.floor((Date.parse(date+'T12:00:00Z')-Date.parse(config.academicStart+'T12:00:00Z'))/(7*DAY))+1;
export const formatDate = (date, options = {day:'numeric',month:'long'}) => new Intl.DateTimeFormat('ru-RU', {...options,timeZone:TIME_ZONE}).format(new Date(date+'T12:00:00+05:00'));
export const timeMinutes = text => {const m = /^(\d{1,2}):(\d{2})$/.exec(String(text));return m && +m[1]<24 && +m[2]<60 ? +m[1]*60 + +m[2] : null;};
export const clock = minutes => `${Math.floor(minutes/60).toString().padStart(2,'0')}:${(minutes%60).toString().padStart(2,'0')}`;
export const ufaTimestamp = (date, time) => Date.parse(`${date}T${time}:00+05:00`);
export const clean = value => String(value ?? '').trim();
const personName = value => /[А-Яа-яA-Za-zЁё]/.test(clean(value)) ? clean(value) : '';
export function normalizeSearch(value) {
  const similar = {A:'А',B:'В',C:'С',E:'Е',H:'Н',K:'К',M:'М',O:'О',P:'Р',T:'Т',X:'Х'};
  return clean(value).toUpperCase().replace(/[ABCEHKMOPTX]/g,c=>similar[c]).replace(/Ё/g,'Е').replace(/[^А-ЯA-Z0-9]/g,'');
}
export function normalizeGroups(raw) {
  if(!Array.isArray(raw)) throw new Error('Формат списка групп изменился');
  const groups = raw.filter(g=>Number.isInteger(Number(g.group_id)) && +g.group_id>0 && clean(g.group_title) && clean(g.group_title)!=='0')
    .map(g=>({id:+g.group_id,title:clean(g.group_title),faculty:clean(g.faculty),course:+g.course||null,city:clean(g.filial_title)}));
  if(!groups.length) throw new Error('Источник не вернул список групп');
  return groups;
}
export function searchGroups(groups, query) {
  const q = normalizeSearch(query);
  return groups.filter(g=>normalizeSearch(g.title).includes(q)).sort((a,b)=>(normalizeSearch(b.title)===q)-(normalizeSearch(a.title)===q) || (b.city==='Уфа')-(a.city==='Уфа') || a.title.localeCompare(b.title,'ru')).slice(0,35);
}
export function matchBuilding(shortName, fullName) {
  // A matching number alone is insufficient: other UUST campuses reuse numbers.
  const n = /^Корпус\s*(\d+)$/i.exec(clean(shortName));
  if(!n || !/[ККкк].?\s*Маркса/i.test(fullName) || !/\b12(?:\s|\/|\)|,|$)/.test(fullName) || /спортзал|спортзала|зал нижн/i.test(fullName)) return null;
  const titleNumber = /корпус\s*№?\s*(\d+)/i.exec(fullName);
  return titleNumber && +titleNumber[1]===+n[1] && +n[1]>=1 && +n[1]<=9 ? String(+n[1]) : null;
}
export function normalizeSchedule(raw, groupId) {
  if(!Array.isArray(raw)) throw new Error('Источник изменил формат расписания');
  if(raw.some(r=>!r || typeof r!=='object' || !('schedule_subject_title' in r))) throw new Error('Источник изменил поля расписания');
  const rows = [];
  for(const r of raw) {
    if(!clean(r.schedule_subject_title)) continue; // source has two empty placeholders
    if(+r.student_group_number_id!==+groupId) throw new Error('Источник вернул расписание другой группы');
    const day=+r.schedule_weekday_id;
    if(day<1 || day>7 || !Array.isArray(r.schedule_weeks)) throw new Error('Не удалось прочитать учебные недели');
    const weeks = r.schedule_weeks.map(Number).filter(w=>Number.isInteger(w)&&w>=1&&w<=53);
    if(!weeks.length) throw new Error('Не указаны учебные недели занятия');
    const time = clean(r.schedule_time_title).split(/\s*[-–—]\s*/);
    const start=timeMinutes(time[0]), end=timeMinutes(time[1]);
    rows.push({id:String(r.schedule_id)+'-'+String(r.index),subject:clean(r.schedule_subject_title),day,weeks,
      start:start!==null && end!==null && end>start?start:null,end:start!==null && end!==null && end>start?end:null,
      type:clean(r.type),teacher:personName(r.teacher_fullname)||personName(r.teacher),teacherShort:personName(r.teacher),
      room:clean(r.room_title_short)||clean(r.room_title),buildingTitle:clean(r.building_title),buildingShort:clean(r.building_short_title),
      buildingId:matchBuilding(r.building_short_title,r.building_title),comment:clean(r.comment)});
  }
  return rows;
}
export function lessonsOn(rows, date, config=DEFAULT_CONFIG) {
  const week=academicWeek(date,config);
  if(!week) return [];
  return rows.filter(r=>r.day===weekday(date) && r.weeks.includes(week)).sort((a,b)=>(a.start??1440)-(b.start??1440)||a.subject.localeCompare(b.subject,'ru'));
}
// The upstream semester identifier can span an academic year. Show exactly the
// supplied weeks, without guessing an institution-wide winter/summer boundary.
export function semesterWeeks(rows,config=DEFAULT_CONFIG) {
  const weeks=[...new Set(rows.flatMap(row=>row.weeks))].sort((a,b)=>a-b);
  return weeks.map(week=>{
    const start=addDays(config.academicStart,(week-1)*7);
    const days=Array.from({length:7},(_,i)=>addDays(start,i)).filter(date=>date<=config.academicEnd)
      .map(date=>({date,lessons:lessonsOn(rows,date,config)}));
    return {week,start,end:days.at(-1)?.date,days,count:days.reduce((n,day)=>n+day.lessons.length,0)};
  }).filter(week=>week.count>0);
}
export function nextLesson(rows, instant=new Date(), config=DEFAULT_CONFIG) {
  const today=dateKey(instant), minute=minuteOfDay(instant);
  for(let offset=0;offset<42;offset++) {
    const date=addDays(today,offset);
    const candidates=lessonsOn(rows,date,config).filter(r=>r.start!==null && (offset>0 || r.end>minute));
    if(candidates.length) return {...candidates[0],date,ongoing:offset===0 && candidates[0].start<=minute};
  }
  return null;
}
export function freeGaps(lessons) {
  const timed=lessons.filter(l=>l.start!==null).sort((a,b)=>a.start-b.start), result=[];
  let previous=null;
  for(const lesson of timed) {
    if(previous && lesson.start-previous.end>=30) result.push({start:previous.end,end:lesson.start,minutes:lesson.start-previous.end});
    if(!previous || lesson.end>previous.end) previous=lesson;
  }
  return result;
}
export function eventCompatibility(event, rows, loaded, config=DEFAULT_CONFIG) {
  if(!loaded || !event.time || !event.endTime || !academicWeek(event.date,config)) return {kind:'unknown',label:'Недостаточно данных для проверки'};
  const start=timeMinutes(event.time),end=timeMinutes(event.endTime), day=lessonsOn(rows,event.date,config);
  const conflicts=day.filter(l=>l.start!==null && l.start<end && l.end>start);
  if(conflicts.length) return {kind:'conflict',label:'Пересекается с парой',lessons:conflicts};
  if(day.some(l=>l.start===null)) return {kind:'unknown',label:'Есть пары без указанного времени'};
  return {kind:'free',label:'Свободно по расписанию'};
}
export function searchBuildings(buildings, query) {
  const q=normalizeSearch(query), n=q.replace(/КОРПУС|КОРП|К/g,'');
  return buildings.filter(b=>!q || b.id===n || normalizeSearch(b.name+' '+b.address).includes(q));
}
export function validDate(value) {return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export function validateEvents(payload, imported=false) {
  if(payload?.schemaVersion!==1 || !Array.isArray(payload.events) || payload.events.length>300) throw new Error('Нужен JSON версии 1 с массивом events (до 300 событий)');
  const ids=new Set();
  const events=payload.events.map(e=>{
    if(!e || !clean(e.id) || ids.has(e.id) || !clean(e.title) || !validDate(e.date)) throw new Error('Проверьте id, название и дату каждого события');
    ids.add(e.id);
    if(e.time && timeMinutes(e.time)===null || e.endTime && timeMinutes(e.endTime)===null || e.endTime && (!e.time || timeMinutes(e.endTime)<=timeMinutes(e.time))) throw new Error('Некорректное время события');
    if(e.source && !/^https:\/\/[^\s]+$/.test(e.source)) throw new Error('Источник должен быть HTTPS-ссылкой');
    if(e.buildingId && !/^[1-9]$/.test(String(e.buildingId))) throw new Error('На схеме есть только корпуса 1–9');
    return {id:clean(e.id).slice(0,80),title:clean(e.title).slice(0,200),date:e.date,time:e.time||null,endTime:e.endTime||null,
      category:clean(e.category||'Кампус').slice(0,40),description:clean(e.description).slice(0,4000),place:clean(e.place).slice(0,240),buildingId:e.buildingId?String(e.buildingId):null,
      locationId:clean(e.locationId)||null,campusId:clean(e.campusId)||null,floorId:clean(e.floorId)||null,
      kind:imported?'imported':e.kind==='student'?'student':'official',
      capacity:Number.isInteger(e.capacity)&&e.capacity>0?e.capacity:null,attendeeCount:!imported&&Number.isInteger(e.attendeeCount)&&e.attendeeCount>=0?e.attendeeCount:0,viewerGoing:!imported&&e.viewerGoing===true,
      room:clean(e.room).slice(0,80),organizer:clean(e.organizer).slice(0,160),
      community:!imported&&!!e.community,authorId:clean(e.authorId).slice(0,80),authorName:clean(e.authorName).slice(0,80),
      source:clean(e.source),sourceLabel:imported?'Импорт команды':clean(e.sourceLabel||'УУНиТ'),imported,demo:!!e.demo,accent:['lime','peach','blue'].includes(e.accent)?e.accent:'lime'};
  });
  return events.sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
}
