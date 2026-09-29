import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitFloorPlan,scenePoint} from '../app/map/scene.js';
import {campusPoint} from '../app/map/svg.js';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url),'utf8'));
const pack=read('../app/data/maps.json');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

test('floor fitting preserves proportions, nonzero origins and all four corners',()=>{
  for(const viewBox of [[290,0,390,1536],[-50,120,1000,80],[100,200,300,300]]){
    const floor={id:'floor',buildingId:'6',viewBox},frame=[230,776,65,315];
    const plan=fitFloorPlan(floor,frame),layout={plans:new Map([[floor.id,plan]])};
    const [x,y,w,h]=viewBox,[left,top,width,height]=plan.box;
    near(width/height,w/h);assert.ok(plan.scale>0);
    near(left+width/2,frame[0]+frame[2]/2);near(top+height/2,frame[1]+frame[3]/2);
    for(const [px,py] of [[x,y],[x+w,y],[x,y+h],[x+w,y+h]]){
      const [sx,sy]=scenePoint(layout,floor.id,[px,py]);
      assert.ok(sx>=frame[0]&&sx<=frame[0]+frame[2]);
      assert.ok(sy>=frame[1]&&sy<=frame[1]+frame[3]);
    }
    near(scenePoint(layout,floor.id,[x+w,y])[0]-scenePoint(layout,floor.id,[x,y])[0],width);
    near(scenePoint(layout,floor.id,[x,y+h])[1]-scenePoint(layout,floor.id,[x,y])[1],height);
  }
});

test('every bundled floor retains its size relative to the complete building',()=>{
  const frames={'6':[615,230,315,162],'7':[1046,230,377,110]};
  for(const floor of pack.floors){
    const [x,y,w,h]=frames[floor.buildingId],corner=campusPoint([x+w,y]),frame=[...corner,h,w];
    const plan=fitFloorPlan(floor,frame),layout={plans:new Map([[floor.id,plan]])};
    near(plan.box[2]/plan.box[3],floor.viewBox[2]/floor.viewBox[3]);
    const points=[...floor.areas.flatMap(a=>a.points),...floor.walls.flat(),...floor.doors.flatMap(d=>d.points),
      ...pack.nodes.filter(n=>n.floorId===floor.id).map(n=>n.point)];
    for(const p of points){
      const [sx,sy]=scenePoint(layout,floor.id,p);
      assert.ok(sx>=frame[0]&&sx<=frame[0]+frame[2],floor.id);
      assert.ok(sy>=frame[1]&&sy<=frame[1]+frame[3],floor.id);
    }
  }
});

test('reference fourth floors keep their established building-relative dimensions',()=>{
  for(const [id,frame,expected] of [
    ['cw-6-f4',[230,776,162,315],[73.58203125,289.8]],
    ['sv-7-f4',[230,283,110,377],[101.2,101.2*1093/353]],
  ]){
    const floor=pack.floors.find(f=>f.id===id),plan=fitFloorPlan(floor,frame);
    near(plan.box[2],expected[0]);near(plan.box[3],expected[1]);
  }
});

test('invalid dimensions cannot produce non-finite or reflected floor transforms',()=>{
  for(const box of [undefined,[0,0,0,10],[0,0,10,-1],[0,0,NaN,10],[0,0,10,Infinity]]){
    assert.equal(fitFloorPlan({viewBox:box},[0,0,100,100]),null);
    assert.equal(fitFloorPlan({viewBox:[0,0,100,100]},box),null);
  }
});

test('building 7 classrooms face the street on every floor, with doors toward the corridor',()=>{
  for(const id of ['sv-7-101','sv-7-204','sv-7-304','sv-7-404']){
    const room=pack.locations.find(l=>l.id===id),floor=pack.floors.find(f=>f.id===room.floorId);
    const door=pack.nodes.find(n=>n.id===room.nodeId);
    const area=floor.areas.find(a=>a.id===room.areaId);
    assert.ok(room.point[0]<door.point[0],id+' must face Karl Marx Street');
    near(Math.max(...area.points.map(p=>p[0])),door.point[0]);
    assert.ok(area.points.every(p=>p[0]<=door.point[0]),id);
  }
});
