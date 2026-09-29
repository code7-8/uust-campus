// Piecewise affine display placement. Source rooms, doors and routing costs stay intact.
export const projectPoint=(plan,point)=>{
  const [x,y]=point,tiles=plan.tiles||[plan];
  const matches=tiles.filter(t=>!t.source||x>=t.source[0]-1e-7&&x<=t.source[0]+t.source[2]+1e-7&&y>=t.source[1]-1e-7&&y<=t.source[1]+t.source[3]+1e-7);
  // At a wing boundary keep the outside edge on the closed building outline.
  const tile=matches.sort((a,b)=>(b.target?.[2]||0)-(a.target?.[2]||0))[0]||tiles[0];
  return [tile.tx+x*tile.sx+y*(tile.xy||0),tile.ty+y*tile.sy+x*(tile.yx||0)];
};

export function projectLine(plan,line,closed=false) {
  const points=closed?[...line,line[0]]:line,result=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],cuts=new Set([0,1]);
    for(const tile of plan.tiles||[])for(let axis=0;axis<2;axis++)for(const boundary of [tile.source[axis],tile.source[axis]+tile.source[axis+2]]){
      const t=(boundary-a[axis])/(b[axis]-a[axis]);
      if(t>0&&t<1){cuts.add(t);cuts.add(Math.max(0,t-1e-8));cuts.add(Math.min(1,t+1e-8));}
    }
    for(const t of [...cuts].sort((x,y)=>x-y))result.push(projectPoint(plan,[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]));
  }
  return result.length?result:line.map(p=>projectPoint(plan,p));
}

export function placement(floor,bounds,frame,outline) {
  const spec=floor.placement;if(!spec)return null;
  const [x,y,w,h]=bounds,box=spec.box||frame;
  const base={floorId:floor.id,buildingId:floor.buildingId,bounds,box:[...box],rotation:spec.rotation};
  if(spec.rotation===270)return {...base,sx:0,sy:0,xy:box[2]/h,yx:-box[3]/w,tx:box[0]-y*box[2]/h,ty:box[1]+box[3]+x*box[3]/w};
  if(spec.box)return {...base,sx:-box[2]/w,sy:-box[3]/h,tx:box[0]+box[2]+x*box[2]/w,ty:box[1]+box[3]+y*box[3]/h};
  const tiles=[];
  for(let i=1;i<spec.sourceY.length;i++){
    const bottom=spec.sourceY[i-1],top=spec.sourceY[i],targetBottom=spec.targetY[i-1],targetTop=spec.targetY[i];
    const mid=(targetTop+targetBottom)/2,edges=[];
    for(let j=0;j<outline.length;j++){
      const a=outline[j],b=outline[(j+1)%outline.length];
      if((a[1]>mid)!==(b[1]>mid))edges.push(a[0]+(mid-a[1])*(b[0]-a[0])/(b[1]-a[1]));
    }
    const right=edges.length?Math.max(...edges):frame[0]+frame[2];
    for(const [from,to,left,end] of [[x,spec.coreX,spec.spineRight,right],[spec.coreX,x+w,frame[0],spec.spineRight]]){
      const sx=-(end-left)/(to-from),sy=(targetTop-targetBottom)/(top-bottom);
      tiles.push({source:[from,bottom,to-from,top-bottom],target:[left,targetTop,end-left,targetBottom-targetTop],sx,sy,tx:end-from*sx,ty:targetBottom-bottom*sy});
    }
  }
  return {...base,tiles};
}

export function displayFloorGroup(floors,floorId) {
  const f=floors.find(f=>f.id===floorId);return f?.displayWith||floorId;
}

export function cameraFloor(candidates,current,visible) {
  const sorted=[...candidates].sort((a,b)=>a.distance-b.distance),nearest=sorted[0],active=sorted.find(c=>c.id===current);
  if(active&&(!nearest||active.distance<=nearest.distance+40))return current;
  // Crossing the narrow gap between buildings must not close/reopen the floor card.
  return nearest?.id||(visible.has(current)?current:null);
}
