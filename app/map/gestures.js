// SVG coordinates come from its CTM: letterboxing and different screen ratios are respected.
export function bindGestures(svg, camera, onPick, onChange) {
  const pointers=new Map(); let dragged=false, pick=null, last=null;
  const world=(x,y)=>{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(svg.getScreenCTM().inverse());};
  const bounds=()=>camera.base;
  const apply=()=>{
    const b=bounds(),v=camera.box;
    const viewport=svg.getBoundingClientRect(),insets=camera.insets||{left:0,right:0,top:0,bottom:0};
    const units=Math.max(v[2]/(viewport.width||1),v[3]/(viewport.height||1));
    const offsetX=v[2]/2+(insets.left-insets.right)*units/2,offsetY=v[3]/2+(insets.top-insets.bottom)*units/2;
    v[0]=Math.max(b[0]-offsetX,Math.min(b[0]+b[2]-offsetX,v[0]));
    v[1]=Math.max(b[1]-offsetY,Math.min(b[1]+b[3]-offsetY,v[1]));
    svg.setAttribute('viewBox',v.join(' '));
    svg.classList.toggle('show-room-labels',b[2]/v[2]>=1.25);
    const matrix=svg.getScreenCTM(), scale=matrix?Math.hypot(matrix.a,matrix.b):1;
    if(scale>0)for(const marker of svg.querySelectorAll('.map-number')) {
      const circle=marker.querySelector('circle');circle.setAttribute('r',14/scale);
      marker.querySelector('text').style.fontSize=(14/scale)+'px';
      const caption=marker.querySelector('.selected-building-label');
      if(caption){caption.style.fontSize=(12/scale)+'px';caption.setAttribute('y',Number(circle.getAttribute('cy'))+31/scale);}
    }
    if(scale>0){
      for(const text of svg.querySelectorAll('.map-street-name'))text.style.fontSize=(9/scale)+'px';
      for(const text of svg.querySelectorAll('.room-label'))text.style.fontSize=(12/scale)+'px';
      for(const text of svg.querySelectorAll('.selection-caption text'))text.style.fontSize=(12/scale)+'px';
      const used=[];
      for(const poi of svg.querySelectorAll('.floor-poi')) {
        const circle=poi.querySelector('circle'),x=+circle.getAttribute('cx'),y=+circle.getAttribute('cy');
        const important=poi.classList.contains('is-selected')||poi.classList.contains('on-route');
        const visible=important||!used.some(p=>Math.hypot(p[0]-x,p[1]-y)*scale<30);
        poi.style.display=visible?'':'none';if(visible)used.push([x,y]);
        circle.setAttribute('r',11/scale);poi.querySelector('text').style.fontSize=(10/scale)+'px';
      }
      for(const endpoint of svg.querySelectorAll('.route-endpoint')) {
        const text=endpoint.querySelector('text'),cx=+text.getAttribute('x'),cy=+text.getAttribute('y'),circle=endpoint.querySelector('circle'),rect=endpoint.querySelector('rect');
        text.style.fontSize=((text.textContent.length>1?10:12)/scale)+'px';if(circle)circle.setAttribute('r',14/scale);
        if(rect){rect.setAttribute('x',cx-12/scale);rect.setAttribute('y',cy-12/scale);rect.setAttribute('width',24/scale);rect.setAttribute('height',24/scale);}
      }
    }
    onChange?.();
  };
  const fit=(points,insets,keepScale=false)=>{
    const viewport=svg.getBoundingClientRect();if(!viewport.width||!viewport.height||!points.length)return;
    camera.insets=insets;
    const width=Math.max(32,viewport.width-insets.left-insets.right),height=Math.max(32,viewport.height-insets.top-insets.bottom);
    const horizontal=points.map(point=>point[0]),vertical=points.map(point=>point[1]);
    const left=Math.min(...horizontal),right=Math.max(...horizontal),top=Math.min(...vertical),bottom=Math.max(...vertical);
    const units=keepScale?Math.max(camera.box[2]/viewport.width,camera.box[3]/viewport.height):Math.max((right-left)/width,(bottom-top)/height,.01);
    camera.box=[(left+right)/2-(insets.left+width/2)*units,(top+bottom)/2-(insets.top+height/2)*units,viewport.width*units,viewport.height*units];
    if(!keepScale||!camera.fitWidth)camera.fitWidth=camera.box[2];
    apply();
  };
  const zoom=(factor,x,y)=>{
    const v=camera.box,width=camera.fitWidth||bounds()[2],ratio=Math.max(.16,Math.min(1.5,v[2]/width/factor))/(v[2]/width);
    const anchor=x===undefined?{x:v[0]+v[2]/2,y:v[1]+v[3]/2}:world(x,y);
    camera.box=[anchor.x+(v[0]-anchor.x)*ratio,anchor.y+(v[1]-anchor.y)*ratio,v[2]*ratio,v[3]*ratio];apply();
  };
  const gesture=()=>{const p=[...pointers.values()];return {x:p.reduce((s,v)=>s+v.x,0)/p.length,y:p.reduce((s,v)=>s+v.y,0)/p.length,d:p.length===2?Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y):0};};
  svg.addEventListener('pointerdown',e=>{if(pointers.size===0){dragged=false;pick=e.target.closest('[data-map-place]')?.dataset.mapPlace;}pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});last=gesture();if(pointers.size>1)dragged=true;svg.setPointerCapture(e.pointerId);});
  svg.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const old=last;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const next=gesture();
    if(Math.hypot(next.x-old.x,next.y-old.y)>2 || dragged){
      dragged=true;const a=world(old.x,old.y),b=world(next.x,next.y);camera.box[0]+=a.x-b.x;camera.box[1]+=a.y-b.y;apply();
      if(next.d && old.d)zoom(next.d/old.d,next.x,next.y);last=next;
    }
  });
  const release=e=>{const selected=e.type==='pointerup'&&!dragged&&pointers.size===1?pick:null;pointers.delete(e.pointerId);last=pointers.size?gesture():null;if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(selected)onPick(selected);};
  svg.addEventListener('pointerup',release);svg.addEventListener('pointercancel',release);
  svg.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2,e.clientX,e.clientY);},{passive:false});
  svg.addEventListener('keydown',e=>{
    const id=e.target.closest('[data-map-place]')?.dataset.mapPlace;
    if(id && ['Enter',' '].includes(e.key)){e.preventDefault();onPick(id);return;}
    const offsets={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]};
    if(offsets[e.key]){e.preventDefault();camera.box[0]+=offsets[e.key][0]*camera.box[2];camera.box[1]+=offsets[e.key][1]*camera.box[3];apply();}
    if(['+','=','-'].includes(e.key)){e.preventDefault();zoom(e.key==='-'?1/1.3:1.3);}
  });
  apply();return {zoom,fit,reset(){camera.box=[...camera.base];apply();},apply};
}
