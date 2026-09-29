import {campusPoint} from './svg.js';

// Display placement only: the source plans have no surveyed campus coordinates.
// Keep their proportions and fit them into the whole outline's bounding box. Do not
// use this transform for route weights, entrances, distances or GPS.
const validBox=box=>Array.isArray(box)&&box.length===4&&box.every(Number.isFinite)&&box[2]>0&&box[3]>0;
const campusFrame=box=>{
  const corner=campusPoint([box[0]+box[2],box[1]]);
  return [corner[0],corner[1],box[3],box[2]];
};

export function fitFloorPlan(floor,frame) {
  const box=floor.viewBox;
  if(!validBox(frame)||!validBox(box))return null;
  // One positive scale for both axes: never stretch, crop or reflect a plan.
  const scale=.92*Math.min(frame[2]/box[2],frame[3]/box[3]);
  const x=frame[0]+(frame[2]-box[2]*scale)/2,y=frame[1]+(frame[3]-box[3]*scale)/2;
  return {floorId:floor.id,buildingId:floor.buildingId,scale,tx:x-box[0]*scale,ty:y-box[1]*scale,box:[x,y,box[2]*scale,box[3]*scale]};
}

export function createSceneLayout(buildings,floors) {
  const ns='http://www.w3.org/2000/svg',probe=document.createElementNS(ns,'svg');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const frames=new Map(),plans=new Map();
  try {
    for(const building of buildings){
      const path=document.createElementNS(ns,'path');path.setAttribute('d',building.path);probe.append(path);
      const box=path.getBBox(),frame=campusFrame([box.x,box.y,box.width,box.height]);
      frames.set(building.id,frame);
      path.remove();
    }
  } finally {probe.remove();}
  for(const floor of floors){
    // Use the complete building dimensions. Substituting a narrower wing here
    // shrinks the floor relative to the building, even with uniform scaling.
    const plan=fitFloorPlan(floor,frames.get(floor.buildingId));
    if(plan)plans.set(floor.id,plan);
  }
  return {frames,plans};
}

export function scenePoint(layout,floorId,point) {
  if(!floorId)return campusPoint(point);
  const plan=layout.plans.get(floorId);
  return [plan.tx+point[0]*plan.scale,plan.ty+point[1]*plan.scale];
}

export const boxPoints=box=>[[box[0],box[1]],[box[0]+box[2],box[1]+box[3]]];
