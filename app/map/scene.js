import {campusPoint} from './svg.js';

// Display placement only: the source plans have no surveyed campus coordinates.
// Keep their proportions and fit them into the outline's bounding box. Do not
// use this transform for route weights, entrances, distances or GPS.
export function createSceneLayout(buildings,floors) {
  const ns='http://www.w3.org/2000/svg',probe=document.createElementNS(ns,'svg');
  probe.setAttribute('aria-hidden','true');
  probe.style.cssText='position:absolute;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  document.body.append(probe);
  const frames=new Map(),plans=new Map();
  try {
    for(const building of buildings){
      const path=document.createElementNS(ns,'path');path.setAttribute('d',building.path);probe.append(path);
      const box=path.getBBox(),corner=campusPoint([box.x+box.width,box.y]);
      frames.set(building.id,[corner[0],corner[1],box.height,box.width]);path.remove();
    }
  } finally {probe.remove();}
  for(const floor of floors){
    const frame=frames.get(floor.buildingId),box=floor.viewBox;
    if(!frame||!frame[2]||!frame[3])continue;
    const scale=.92*Math.min(frame[2]/box[2],frame[3]/box[3]);
    const x=frame[0]+(frame[2]-box[2]*scale)/2,y=frame[1]+(frame[3]-box[3]*scale)/2;
    plans.set(floor.id,{floorId:floor.id,buildingId:floor.buildingId,scale,tx:x-box[0]*scale,ty:y-box[1]*scale,box:[x,y,box[2]*scale,box[3]*scale]});
  }
  return {frames,plans};
}

export function scenePoint(layout,floorId,point) {
  if(!floorId)return campusPoint(point);
  const plan=layout.plans.get(floorId);
  return [plan.tx+point[0]*plan.scale,plan.ty+point[1]*plan.scale];
}

export const boxPoints=box=>[[box[0],box[1]],[box[0]+box[2],box[1]+box[3]]];
