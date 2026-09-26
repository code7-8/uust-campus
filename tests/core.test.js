import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeGroups,normalizeSchedule,searchGroups,academicWeek,dateKey,minuteOfDay,lessonsOn,nextLesson,freeGaps,eventCompatibility,matchBuilding,searchBuildings,validateEvents,validDate,ufaTimestamp} from '../app/core.js';
const read=name=>JSON.parse(readFileSync(new URL('../app/data/'+name,import.meta.url),'utf8'));
const groups=normalizeGroups(read('groups.json'));
const rows=normalizeSchedule(read('schedule-14381-241.json'),14381);
const events=validateEvents(read('events.json'));
test('real group 14381 is ТОП-106Б, search accepts spaces/case/dashes',()=>{
  assert.equal(groups.find(g=>g.id===14381).title,'ТОП-106Б');
  assert.equal(searchGroups(groups,'топ 106б')[0].id,14381);
  assert.equal(searchGroups(groups,'TOП-106Б')[0].id,14381);
});
test('academic week starts on Monday Aug 31, follows source calendar',()=>{
  assert.equal(academicWeek('2026-09-01'),1);
  assert.equal(academicWeek('2026-09-27'),4);
  assert.equal(academicWeek('2026-09-28'),5);
  assert.equal(academicWeek('2026-08-30'),null);
  assert.equal(academicWeek('2027-08-30'),null);
});
test('Ufa calendar date differs from UTC and uses UTC+5',()=>{
  assert.equal(dateKey(new Date('2026-09-27T20:00:00Z')),'2026-09-28');
  assert.equal(minuteOfDay(new Date('2026-09-27T20:00:00Z')),60);
  assert.equal(ufaTimestamp('2026-09-28','09:35'),Date.parse('2026-09-28T04:35:00Z'));
});
test('real next class for Sunday is Monday 09:35 in building 7',()=>{
  const next=nextLesson(rows,new Date('2026-09-27T08:00:00+05:00'));
  assert.equal(next.date,'2026-09-28');assert.equal(next.start,575);
  assert.equal(next.subject,'Программно-аппаратные комплексы');
  assert.equal(next.buildingId,'7');
  assert.equal(lessonsOn(rows,'2026-09-27').length,0);
});
test('current class is shown while ongoing; after end it moves on',()=>{
  assert.equal(nextLesson(rows,new Date('2026-09-28T09:40:00+05:00')).ongoing,true);
  assert.notEqual(nextLesson(rows,new Date('2026-09-28T10:55:00+05:00')).start,575);
});
test('ambiguous gym and other campuses are never matched by number',()=>{
  const gym=rows.find(r=>r.subject==='Физическая культура и спорт');assert.ok(gym);assert.equal(gym.buildingId,null);
  assert.equal(matchBuilding('Корпус 1','Учебный корпус № 1 (г. Уфа, ул. Заки Валиди, 32)'),null);
  assert.equal(matchBuilding('Корпус 4','Учебный корпус № 3 (г. Уфа, ул. К. Маркса, 12/4)'),null);
});
test('map search recognizes natural alternatives',()=>{
  const buildings=read('buildings.json').buildings;
  for(const q of ['3','корпус 3','3 корпус','Корп. 3'])assert.equal(searchBuildings(buildings,q)[0].id,'3');
  assert.equal(searchBuildings(buildings,'99').length,0);
});
test('free gaps union overlapping subgroup classes before calculation',()=>{
  const gaps=freeGaps([{start:480,end:560},{start:500,end:580},{start:620,end:700}]);
  assert.deepEqual(gaps,[{start:580,end:620,minutes:40}]);
});
test('event conflicts are computed with interval overlap, unknown stays unknown',()=>{
  const event=events[0],fit=eventCompatibility(event,rows,true);
  const day=lessonsOn(rows,event.date);
  const hasOverlap=day.some(l=>l.start<850 && l.end>790);
  assert.equal(fit.kind,hasOverlap?'conflict':'free');
  assert.equal(eventCompatibility(event,rows,false).kind,'unknown');
  assert.equal(eventCompatibility(events[1],rows,true).kind,'unknown');
  assert.equal(eventCompatibility({...event,time:'09:20',endTime:'09:35'},[{day:2,weeks:[5],start:480,end:560}],true).kind,'free');
});
test('malformed source or another group cannot overwrite valid cache',()=>{
  assert.throws(()=>normalizeSchedule({error:'offline'},14381));
  assert.throws(()=>normalizeSchedule([{title:'renamed field'}],14381));
  assert.throws(()=>normalizeSchedule(read('schedule-14381-241.json'),14380));
});
test('imports reject invalid dates, links, duplicates, impossible times and buildings',()=>{
  const base=read('events.json');assert.equal(validateEvents(base,true)[0].sourceLabel,'Импорт команды');
  for(const changes of [{date:'2026-02-30'},{time:'29:00'},{endTime:'10:00'},{source:'javascript:alert(1)'},{buildingId:'99'}]) {
    assert.throws(()=>validateEvents({...base,events:[{...base.events[0],...changes}]}));
  }
  assert.throws(()=>validateEvents({...base,events:[base.events[0],base.events[0]]}));
  assert.equal(validDate('2028-02-29'),true);assert.equal(validDate('2026-02-29'),false);
});
test('map has nine shapes, all event links to map resolve',()=>{
  const buildings=read('buildings.json').buildings;assert.equal(buildings.length,9);
  for(const e of events.filter(e=>e.buildingId))assert.ok(buildings.some(b=>b.id===e.buildingId));
});
