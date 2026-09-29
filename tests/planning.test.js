import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {semesterWeeks,normalizeSchedule,lessonsOn,addDays,ufaTimestamp} from '../app/core.js';
import {notificationSettings,buildReminders,quietAt} from '../app/notifications.js';
import {fitFloor,scenePoint} from '../app/map/scene.js';
import {projectLine,projectPoint,cameraFloor,displayFloorGroup} from '../app/map/projection.js';
import {campusPoint,sceneSvg} from '../app/map/svg.js';
import {createMapData} from '../app/map/data.js';
import {planJourney} from '../app/map/journey.js';
const read=name=>JSON.parse(readFileSync(new URL('../app/data/'+name,import.meta.url),'utf8'));
const config=read('config.json'),rows=normalizeSchedule(read('schedule-14381-241.json'),14381);
const group={id:14381,title:'ТОП-106Б'};

test('semester view includes every loaded occurrence once, including uneven weeks and unknown times',()=>{
  const weeks=semesterWeeks(rows,config);
  const expected=[];
  for(let date=config.academicStart;date<=config.academicEnd;date=addDays(date,1))for(const l of lessonsOn(rows,date,config))expected.push(date+':'+l.id);
  const actual=weeks.flatMap(w=>w.days.flatMap(d=>d.lessons.map(l=>d.date+':'+l.id)));
  assert.deepEqual(actual,expected);
  assert.equal(weeks.reduce((n,w)=>n+w.count,0),expected.length);
  assert.deepEqual(semesterWeeks([],config),[]);
  const extra={...rows[0],weeks:[1,3,53],start:null,end:null};
  assert.deepEqual(semesterWeeks([extra],config).map(w=>w.week),[1,3]);
});

const now=ufaTimestamp('2026-09-28','00:00');
const enabled={enabled:true,quiet:false};
test('reminders use Ufa time, skip unknown times, deduplicate and respect group/category switches',()=>{
  const monday={...rows[0],id:'class',subject:'Пара',day:1,weeks:[5],start:600,end:690};
  const input={rows:[monday,monday,{...monday,id:'unknown',start:null}],group,config,settings:enabled,now};
  const reminders=buildReminders(input);
  assert.equal(reminders.length,1);assert.equal(reminders[0].at,ufaTimestamp('2026-09-28','09:45'));
  assert.equal(buildReminders({...input,settings:{enabled:false}}).length,0);
  assert.equal(buildReminders({...input,settings:{...enabled,lessons:false}}).length,0);
  assert.equal(buildReminders({...input,group:null}).length,0);
  assert.equal(buildReminders({...input,now:ufaTimestamp('2026-09-28','10:00')}).length,0);
  assert.notEqual(buildReminders({...input,group:{id:7,title:'Другая'}})[0].id,reminders[0].id);
});

test('only saved or joined events with known times are scheduled; edits replace timestamps',()=>{
  const events=[{id:'saved',title:'Избранное',date:'2026-09-28',time:'18:00'},{id:'joined',title:'Встреча',date:'2026-09-28',time:'19:00',viewerGoing:true},{id:'other',date:'2026-09-28',time:'20:00'},{id:'unknown',date:'2026-09-28',time:null}];
  const input={events,favorites:['saved','unknown'],config,settings:enabled,now};
  const reminders=buildReminders(input);assert.equal(reminders.length,2);
  assert.equal(buildReminders({...input,favorites:[]}).length,1);
  assert.equal(buildReminders({...input,settings:{...enabled,events:false}}).length,0);
  const changed=buildReminders({...input,events:[{...events[0],time:'17:00'}]});
  assert.equal(changed[0].id,reminders[0].id);assert.equal(changed[0].at,reminders[0].at-3600000);
});
test('quiet hours cross midnight, use reminder time and normalize broken persisted settings',()=>{
  const settings=notificationSettings({...enabled,quiet:true,quietStart:'22:00',quietEnd:'08:00'});
  assert.equal(quietAt(ufaTimestamp('2026-09-28','23:00'),settings),true);
  assert.equal(quietAt(ufaTimestamp('2026-09-29','07:59'),settings),true);
  assert.equal(quietAt(ufaTimestamp('2026-09-29','08:00'),settings),false);
  assert.equal(quietAt(now,{...settings,quietEnd:'22:00'}),false);
  assert.equal(notificationSettings({leadMinutes:-5,quietStart:'99:99',enabled:'true'}).enabled,false);
  assert.equal(notificationSettings(null).leadMinutes,15);
  const events=[{id:'early',date:'2026-09-29',time:'08:00'},{id:'later',date:'2026-09-29',time:'08:30'}];
  assert.deepEqual(buildReminders({events,favorites:['early','later'],settings,now}).map(i=>i.id),['event:later:2026-09-29']);
});

test('all ten placed floors preserve rooms and routes inside the building contour',()=>{
  const buildings=read('buildings.json').buildings,data=createMapData(read('maps.json'),buildings),plans=new Map(),frames=new Map();
  for(const floor of data.floors){
    const polygon=buildings.find(b=>b.id===floor.buildingId).sceneOutline.map(campusPoint);
    const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]),frame=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];
    const p=fitFloor(floor,frame,polygon);plans.set(floor.id,p);frames.set(floor.buildingId,frame);
    assert.equal(p.rotation,floor.id==='sv-6-f4-annex'?270:180);
    const inside=([x,y])=>{
      assert.ok(Number.isFinite(x)&&Number.isFinite(y));
      assert.ok(y>=frame[1]-.01&&y<=frame[1]+frame[3]+.01);
      if(polygon.some((a,i)=>{const b=polygon[(i+1)%polygon.length];return Math.abs((b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0]))<.001&&x>=Math.min(a[0],b[0])-.001&&x<=Math.max(a[0],b[0])+.001&&y>=Math.min(a[1],b[1])-.001&&y<=Math.max(a[1],b[1])+.001;}))return;
      const py=Math.max(frame[1]+.0001,Math.min(frame[1]+frame[3]-.0001,y));
      const cross=[];for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];if((a[1]>py)!==(b[1]>py))cross.push(a[0]+(py-a[1])*(b[0]-a[0])/(b[1]-a[1]));}
      assert.ok(x>=Math.min(...cross)-.01&&x<=Math.max(...cross)+.01,`${floor.id}: ${x}, ${y}`);
    };
    const lines=[...floor.areas.map(a=>{
      const line=projectLine(p,a.points,true);
      if(a.kind==='room'){const area=Math.abs(line.reduce((sum,q,i)=>{const next=line[(i+1)%line.length];return sum+q[0]*next[1]-q[1]*next[0];},0))/2;assert.ok(area>1,`${a.id}: room collapsed`);}
      return line;
    }),...data.edges.filter(e=>data.nodes.find(n=>n.id===e.from)?.floorId===floor.id&&e.geometry).map(e=>projectLine(p,e.geometry))];
    for(const line of lines)for(let i=1;i<line.length;i++)for(let k=0;k<=100;k++)inside([line[i-1][0]+(line[i][0]-line[i-1][0])*k/100,line[i-1][1]+(line[i][1]-line[i-1][1])*k/100]);
  }
  const trip=planJourney(data,'sv-6-101','sv-7-407');
  const svg=sceneSvg(trip.graph,{plans,frames},data.floors,null,trip.route,'all');
  assert.doesNotMatch(svg,/NaN|undefined/);
  assert.equal((svg.match(/data-scene-floor=/g)||[]).length,10);
  assert.match(svg,/is-underground/);
});

test('main wings reach the right edge, upper floors share a footprint and annex rotates clockwise',()=>{
  const buildings=read('buildings.json').buildings,data=createMapData(read('maps.json'),buildings);
  for(const f of data.floors.filter(f=>f.placement?.coreX)){
    const outline=buildings.find(b=>b.id===f.buildingId).sceneOutline.map(campusPoint),frame=f.buildingId==='6'?[230,776,162,315]:[230,283,110,377];
    const p=fitFloor(f,frame,outline),ys=f.placement.sourceY;
    for(let i=1;i<ys.length;i++)assert.ok(Math.abs(projectPoint(p,[f.placement.coreX,(ys[i-1]+ys[i])/2])[0]-295)<.001);
  }
  const fourth=data.floors.find(f=>f.id==='cw-6-f4'),fifth=data.floors.find(f=>f.id==='cw-6-f5'),annex=data.floors.find(f=>f.id==='sv-6-f4-annex');
  assert.deepEqual(fourth.placement.box,fifth.placement.box);assert.equal(fourth.placement.box[0]+fourth.placement.box[2],annex.placement.box[0]);
  assert.equal(displayFloorGroup(data.floors,annex.id),fourth.id);
  const p=fitFloor(annex,annex.placement.box,[]),a=projectPoint(p,[300,600]),b=projectPoint(p,[300,700]);assert.ok(b[0]>a[0]);assert.equal(b[1],a[1]);
});

test('camera keeps its floor through a gap and small boundary changes, then switches decisively',()=>{
  const visible=new Set(['6','7']);
  assert.equal(cameraFloor([], '6',visible),'6');
  assert.equal(cameraFloor([{id:'6',distance:80},{id:'7',distance:60}], '6',visible),'6');
  assert.equal(cameraFloor([{id:'6',distance:140},{id:'7',distance:50}], '6',visible),'7');
  assert.equal(cameraFloor([], '6',new Set()),null);
});
