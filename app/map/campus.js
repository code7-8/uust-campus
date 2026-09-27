const schemeSource='Схема корпусов, предоставленная командой 27.09.2026';
const teamSource='Сообщение команды 27.09.2026 о переходе 5–6 на панорамах Яндекс Карт';

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
  const edges=[
    connect('1','2',[[790,584],[790,600],[670,600]],[[703,600],[758,600]]),
    connect('2','3',[[670,421],[400,421],[400,480],[237,480]],[[423,421],[516,421]],54),
    connect('3','4',[[237,480],[399,480],[399,242]]),
    connect('4','5',[[530,242]]),
    connect('2','6',[[670,264]]),
    connect('5','6',[[530,250],[650,250],[650,264]],[[569,250],[615,250]],22,true),
    connect('7','8',[[1459,264]]),
    connect('1','hub',[[1192,584],[1192,565]],[[1218,565],[1234,565]]),
    connect('hub','8',[[1234,524],[1250,499],[1305,489],[1305,429],[1459,429]],[[1234,565],[1234,524],[1250,499],[1269,489]]),
    connect('hub','9',[[1270,565],[1302,592],[1302,653],[1382,653]],[[1234,565],[1270,565],[1302,592],[1302,620]])
  ];
  return {kind:'campus',nodes,edges,floors:[],locations:[],source:schemeSource};
}
