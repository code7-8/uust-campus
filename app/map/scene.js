import {campusPoint} from './svg.js';
import {placement,projectPoint} from './projection.js';

// Display coordinates only. Route costs and imported survey data stay untouched.
export function floorBounds(floor) {
  const points=[...floor.areas.flatMap(a=>a.points),...floor.walls.flat(),...floor.doors.flatMap(d=>d.points)];
  if(!points.length)return floor.viewBox;
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
  return [Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];
}
function spanAt(outline,y,frame) {
  const xs=[];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    if((a[1]>y)!==(b[1]>y))xs.push(a[0]+(y-a[1])*(b[0]-a[0])/(b[1]-a[1]));
  }
  return xs.length?[Math.min(...xs),Math.max(...xs)]:[frame[0],frame[0]+frame[2]];
}
export function fitFloor(floor,frame,outline=[]) {
  const bounds=floorBounds(floor),[x,y,w,h]=bounds;
  const explicit=placement(floor,bounds,frame,outline);if(explicit)return explicit;
  const sy=-frame[3]/h,ty=frame[1]+frame[3]-y*sy;
  const lines=[...floor.areas.map(a=>[...a.points,a.points[0]]),...floor.walls,...floor.doors.map(d=>d.points)],constraints=new Map();
  // Check edges too: a concave footprint can cut through a long room.
  for(const line of lines)for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/4));
    for(let j=0;j<=steps;j++){
      const px=a[0]+(b[0]-a[0])*j/steps,py=ty+(a[1]+(b[1]-a[1])*j/steps)*sy;
      const [left,right]=spanAt(outline,Math.max(frame[1]+.001,Math.min(frame[1]+frame[3]-.001,py)),frame),key=left+':'+right;
      const range=constraints.get(key)||{left,right,min:px,max:px};range.min=Math.min(range.min,px);range.max=Math.max(range.max,px);constraints.set(key,range);
    }
  }
  const interval=scale=>[...constraints.values()].reduce(([lo,hi],r)=>[Math.max(lo,r.left+r.max*scale),Math.min(hi,r.right+r.min*scale)],[-Infinity,Infinity]);
  let lo=0,hi=frame[2]/w;
  for(let i=0;i<40;i++){const mid=(lo+hi)/2,[a,b]=interval(mid);if(a<=b)lo=mid;else hi=mid;}
  const sx=-lo,[left,right]=interval(lo),tx=constraints.size?(left+right)/2:frame[0]-(x+w)*sx;
  return {floorId:floor.id,buildingId:floor.buildingId,sx,sy,tx,ty,bounds,box:[...frame]};
}

export function createSceneLayout(buildings,floors) {
  const ns='http://www.w3.org/2000/svg',probe=document.createElementNS(ns,'svg');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const frames=new Map(),outlines=new Map(),plans=new Map();
  try {
    for(const building of buildings){
      const path=document.createElementNS(ns,'path');path.setAttribute('d',building.path);probe.append(path);
      const box=path.getBBox(),corner=campusPoint([box.x+box.width,box.y]);
      frames.set(building.id,[corner[0],corner[1],box.height,box.width]);path.remove();
      outlines.set(building.id,building.sceneOutline?.map(campusPoint)||[]);
    }
  } finally {probe.remove();}
  for(const floor of floors){
    const frame=frames.get(floor.buildingId);
    if(!frame||!frame[2]||!frame[3])continue;
    plans.set(floor.id,fitFloor(floor,frame,outlines.get(floor.buildingId)));
  }
  return {frames,plans};
}

export function scenePoint(layout,floorId,point) {
  if(!floorId)return campusPoint(point);
  const plan=layout.plans.get(floorId);
  return projectPoint(plan,point);
}

export const boxPoints=box=>[[box[0],box[1]],[box[0]+box[2],box[1]+box[3]]];
