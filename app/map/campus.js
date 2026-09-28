const schemeSource='Схема корпусов, предоставленная командой 27.09.2026';
const teamSource='Сообщение команды 27.09.2026 о переходе 5–6 на панорамах Яндекс Карт';

// Shared bends and corridor branches must be traversable before reaching a
// building's label. Only split existing passage lines; do not add new paths.
function splitPassagesAtJunctions(nodes,passages) {
  const key=point=>point.join(',');
  const byPoint=new Map(nodes.map(node=>[key(node.point),node]));
  for(const edge of passages)for(const point of edge.geometry){
    if(byPoint.has(key(point)))continue;
    const node={id:'campus:junction:'+key(point),buildingId:null,floorId:null,type:'junction',name:'Поворот перехода',point};
    nodes.push(node);byPoint.set(key(point),node);
  }
  const edges=[];
  for(const edge of passages){
    let part=0;
    for(let i=1;i<edge.geometry.length;i++){
      const a=edge.geometry[i-1],b=edge.geometry[i],dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
      if(!length2)continue;
      const onLine=[...byPoint.values()].map(node=>({node,t:((node.point[0]-a[0])*dx+(node.point[1]-a[1])*dy)/length2}))
        .filter(({node,t})=>t>=0&&t<=1&&Math.abs((node.point[0]-a[0])*dy-(node.point[1]-a[1])*dx)<1e-6)
        .sort((p,q)=>p.t-q.t);
      for(let j=1;j<onLine.length;j++){
        const from=onLine[j-1].node,to=onLine[j].node;
        edges.push({...edge,id:edge.id+':'+part,from:from.id,to:to.id,
          weight:Math.hypot(to.point[0]-from.point[0],to.point[1]-from.point[1]),
          geometry:[from.point,to.point],passage:part===0?edge.passage:[]});
        part++;
      }
    }
  }
  return edges;
}

export function createCampusGraph(buildings) {
  const nodes=buildings.map(building=>({id:'campus:building:'+building.id,buildingId:building.id,floorId:null,type:'landmark',name:building.name,point:[...building.center]}));
  nodes.push({id:'campus:hub',buildingId:null,floorId:null,type:'junction',name:'Переход корпусов 1, 8 и 9',point:[1234,565]});
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const nodeId=id=>id==='hub'?'campus:hub':'campus:building:'+id;
  const connect=(from,to,via,passage=[],width=28,reported=false)=>{
    const geometry=[byId.get(nodeId(from)).point,...via,byId.get(nodeId(to)).point];
    return {id:'campus:'+from+'-'+to,from:nodeId(from),to:nodeId(to),kind:'passage',direction:'both',status:'plan',stepFree:null,
      weight:geometry.slice(1).reduce((length,point,index)=>length+Math.hypot(point[0]-geometry[index][0],point[1]-geometry[index][1]),0),
      geometry,passage,width,source:reported?teamSource:schemeSource,verifiedAt:null,reported};
  };
  const edges=splitPassagesAtJunctions(nodes,[
    connect('1','2',[[790,584],[790,600],[670,600]],[[703,600],[758,600]]),
    connect('2','3',[[670,421],[399,421],[399,480],[237,480]],[[423,421],[516,421]],54),
    connect('3','4',[[237,480],[399,480],[399,242]]),
    connect('4','5',[[530,242]]),
    connect('2','6',[[670,264]]),
    connect('5','6',[[530,250],[650,250],[650,264]],[[569,250],[615,250]],22,true),
    connect('7','8',[[1459,264]]),
    connect('1','hub',[[1192,584],[1192,565]],[[1218,565],[1234,565]]),
    connect('hub','8',[[1234,524],[1250,499],[1305,489],[1305,429],[1459,429]],[[1234,565],[1234,524],[1250,499],[1269,489]]),
    connect('hub','9',[[1270,565],[1302,592],[1302,653],[1382,653]],[[1234,565],[1270,565],[1302,592],[1302,620]])
  ]);
  // A schematic alternative along the outside of the supplied footprints.
  // Access links have no line: the APK does not contain actual door positions.
  const outdoorSource='Ориентировочная схема обхода корпусов по контурам команды; входы и пешеходные дорожки не подтверждены';
  const outside=[['nw',[160,170]],['4',[341,170]],['5',[530,170]],['6',[797,170]],
    ['7',[1205,170]],['ne',[1560,170]],['8',[1560,454]],['se',[1560,800]],
    ['9',[1382,800]],['1',[986,800]],['2',[670,800]],['3',[237,800]],['sw',[160,800]]];
  for(const [key,point] of outside)nodes.push({id:'outdoor:'+key,buildingId:null,floorId:null,type:'junction',name:'На улице',point});
  for(let i=0;i<outside.length;i++){
    const [a,p]=outside[i],[b,q]=outside[(i+1)%outside.length];
    edges.push({id:'outdoor:'+a+'-'+b,from:'outdoor:'+a,to:'outdoor:'+b,kind:'outdoor',direction:'both',status:'plan',stepFree:null,
      weight:Math.hypot(p[0]-q[0],p[1]-q[1]),geometry:[p,q],passage:[],source:outdoorSource,verifiedAt:null,approximate:true});
  }
  for(const building of buildings){
    const p=outside.find(([key])=>key===building.id)[1];
    edges.push({id:'outdoor:access:'+building.id,from:'campus:building:'+building.id,to:'outdoor:'+building.id,
      kind:'access',direction:'both',status:'plan',stepFree:null,weight:Math.hypot(p[0]-building.center[0],p[1]-building.center[1])+60,
      geometry:null,passage:[],source:outdoorSource,verifiedAt:null,manual:true});
  }
  return {kind:'campus',nodes,edges,floors:[],locations:[],source:schemeSource};
}
