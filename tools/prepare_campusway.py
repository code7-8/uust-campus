"""Digitized room footprints from the supplied CampusWay floor images. No GPS or field survey."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
SOURCE='CampusWay, haru-matsui, 5b380013 (20.05.2026); архивный план, без проверки на месте'
pack=dict(schemaVersion=1,dataVersion='campusway-2026.09.28',campusId='uust-karl-marx',source=SOURCE,
          verifiedAt=None,verification='archive',synthetic=False,floors=[],locations=[],nodes=[],edges=[],routeOrigins=[],declaredTargets=[])

def make_floor(level,width,height,box,image):
    f=dict(id=f'cw-6-f{level}',campusId=pack['campusId'],buildingId='6',name=f'{level} этаж',order=level,
           source=SOURCE,verifiedAt=None,viewBox=box,areas=[],walls=[],doors=[],image=image,imageSize=[width,height])
    pack['floors'].append(f)
    return f

def point(f,x,y):return [y,f['imageSize'][0]-x]
def polygon(f,coords):return [point(f,x,y) for x,y in coords]
def rect(f,x1,y1,x2,y2):return polygon(f,[(x1,y1),(x2,y1),(x2,y2),(x1,y2)])
def area(f,key,coords,kind='corridor'):
    a=dict(id=f['id']+'-area-'+key,kind=kind,points=polygon(f,coords));f['areas'].append(a);return a
def node(f,key,x,y,kind='junction',name='Коридор',connector=None):
    n=dict(id=f['id']+'-node-'+key.replace('а','a'),campusId=pack['campusId'],buildingId='6',floorId=f['id'],type=kind,name=name,point=point(f,x,y))
    if connector:n['connectorId']=connector
    pack['nodes'].append(n);return n
def room(f,number,bounds,title='Аудитория',door=None,photo=None):
    x1,y1,x2,y2=bounds;rid=f"cw-6-{number}".replace("а","a")
    a=dict(id=rid+'-area',kind='room',points=rect(f,*bounds),locationId=rid);f['areas'].append(a)
    loc=dict(id=rid,campusId=pack['campusId'],buildingId='6',floorId=f['id'],type='room',name=f'{title} 6-{number}',number=str(number),
             aliases=[f'6-{number}',f'кабинет {number}',title],point=point(f,(x1+x2)/2,(y1+y2)/2),nodeId=None,areaId=a['id'],doorId=None)
    if photo:loc['photo']=photo
    if door:
        x,y=door[:2];n=node(f,'door-'+str(number),x,y,'door',loc['name']);loc['nodeId']=n['id'];loc['doorId']=rid+'-door'
        segment=[(x,y-7),(x,y+7)] if len(door)>2 and door[2]=='v' else [(x-7,y),(x+7,y)]
        f['doors'].append(dict(id=loc['doorId'],nodeId=n['id'],points=polygon(f,segment)))
    pack['locations'].append(loc);return loc
def poi(f,key,x,y,name,kind='stairs',connector=None):
    n=node(f,key,x,y,kind if kind in ('stairs','lift','entrance','landmark') else 'landmark',name,connector)
    l=dict(id=f['id']+'-'+key,campusId=pack['campusId'],buildingId='6',floorId=f['id'],type=kind,name=name,aliases=[name],point=n['point'],nodeId=n['id'])
    
    if kind=='toilet':l['nodeId']=None
    pack['locations'].append(l);return l
def edge(a,b,kind='corridor',geometry=None):
    nodes={n['id']:n for n in pack['nodes']};na=nodes[a];nb=nodes[b]
    g=geometry or [na['point'],nb['point']]
    pack['edges'].append(dict(id=f'cw-edge-{len(pack["edges"])+1}',from_=a,to=b,kind=kind,weight=1 if kind=='stairs' else sum(((p[0]-q[0])**2+(p[1]-q[1])**2)**.5 for p,q in zip(g,g[1:])),
                             direction='both',status='plan',stepFree=None,source=SOURCE,verifiedAt=None,geometry=None if kind=='stairs' else g))
    pack['edges'][-1]['from']=pack['edges'][-1].pop('from_')

f4=make_floor(4,1536,1024,[290,0,390,1536],'assets/campusway/floor-6-4.png')
area(f4,'hall',[(35,460),(1420,460),(1420,509),(35,509)])
for num,bounds,title in [
 ('409',(143,510,265,640),'Класс'),('410',(269,318,378,456),'Преподавательская'),
 ('411',(270,510,490,638),'Преподавательская'),('412',(383,318,498,456),'Лаборатория'),
 ('413',(497,515,745,640),'Класс'),('414',(503,318,680,456),'Класс'),
 ('414а',(684,319,746,456),'Лаборатория'),('415',(749,515,1048,638),'Аудитория'),
 ('416',(751,319,1048,456),'Аудитория'),('417',(1168,515,1418,638),'Преподавательская'),
 ('419',(1425,438,1496,562),'Лаборатория'),('420',(1284,319,1418,386),'Кабинет'),
 ('420а',(1059,320,1160,456),'Кабинет'),('422',(1362,390,1416,456),'Кабинет')]:
    doors={'409':(235,510),'410':(365,456),'411':(404,510),'412':(463,456),
           '413':(710,515),'414':(606,456),'414а':(710,456),'415':(940,515),
           '416':(1012,456),'417':(1202,515),'419':(1425,485,'v'),
           '420а':(1088,456),'422':(1378,456)}
    room(f4,num,bounds,title,doors.get(num),f'assets/campusway/room-6-{num}.png' if num in ('415','416') else None)
for key,x in [('west',89),('east',1101)]:
    area(f4,key+'-landing',[(x-37,510),(x+37,510),(x+37,637),(x-37,637)])
    l=poi(f4,key,x,550,'Лестница '+('у левого торца' if key=='west' else 'у аудитории 415'),'stairs','cw-stairs-'+key)
    j=node(f4,key+'-hall',x,486);edge(l['nodeId'],j['id']);pack['routeOrigins'].append(l['id'])
for l in [l for l in pack['locations'] if l['floorId']==f4['id'] and l['type']=='room' and l['nodeId']]:
    n=next(n for n in pack['nodes'] if n['id']==l['nodeId']);x=1536-n['point'][1]
    j=node(f4,'hall-'+l['number'],x,486);edge(j['id'],l['nodeId']);pack['declaredTargets'].append(l['id'])
hall4=sorted([n for n in pack['nodes'] if n['floorId']==f4['id'] and n['type']=='junction'],key=lambda n:n['point'][1],reverse=True)
for a,b in zip(hall4,hall4[1:]):edge(a['id'],b['id'])
poi(f4,'wc',165,380,'Туалет','toilet')

f5=make_floor(5,1280,853,[0,0,853,1280],'assets/campusway/floor-6-5.png')
area(f5,'hall',[(30,340),(1252,340),(1252,498),(30,498)])
for num,bounds,title in [
 ('509',(185,510,316,829),'Лаборатория'),('510',(326,25,515,330),'Преподавательская'),
 ('511',(326,510,515,829),'Лаборатория'),('512',(524,25,718,330),'Аудитория'),
 ('513',(524,510,718,829),'Аудитория'),('514',(727,25,926,330),'Аудитория'),
 ('515',(727,510,926,829),'Аудитория'),('516',(936,25,996,330),'Служебное помещение'),
 ('518',(1003,25,1072,330),'Кабинет'),('520',(1080,25,1131,330),'Кабинет'),
 ('522',(1140,204,1253,330),'Служебное помещение'),('517',(1140,510,1253,829),'Аудитория')]:
    doors={'510':(370,330),'512':(600,330),'514':(766,330),'513':(636,510),'515':(746,510),'517':(1187,510),'509':(281,510),'511':(442,510),'518':(1036,330),'520':(1100,330)}
    room(f5,num,bounds,title,doors.get(num),'assets/campusway/room-6-513.png' if num=='513' else None)
for key,x in [('west',102),('east',1016)]:
    area(f5,key+'-landing',[(x-47,510),(x+47,510),(x+47,829),(x-47,829)])
    l=poi(f5,key,x,600,'Лестница '+('у левого торца' if key=='west' else 'у аудитории 515'),'stairs','cw-stairs-'+key)
    j=node(f5,key+'-hall',x,420);edge(l['nodeId'],j['id']);pack['routeOrigins'].append(l['id'])
    # Archive plans identify the corresponding end-of-wing landings; not field verified.
    other=next(l for l in pack['locations'] if l['id']==f4['id']+'-'+key);edge(other['nodeId'],l['nodeId'],'stairs')
for l in [l for l in pack['locations'] if l['floorId']==f5['id'] and l['type']=='room' and l['nodeId']]:
    n=next(n for n in pack['nodes'] if n['id']==l['nodeId']);x=1280-n['point'][1]
    j=node(f5,'hall-'+l['number'],x,420);edge(j['id'],n['id']);pack['declaredTargets'].append(l['id'])
hall5=sorted([n for n in pack['nodes'] if n['floorId']==f5['id'] and n['type']=='junction'],key=lambda n:n['point'][1],reverse=True)
for a,b in zip(hall5,hall5[1:]):edge(a['id'],b['id'])
poi(f5,'wc',271,180,'Туалет','toilet')

f3=make_floor(3,1280,514,[0,0,514,1280],'assets/campusway/floor-6-3.jpg')
area(f3,'hall',[(133,80),(179,80),(179,356),(1274,356),(1274,398),(180,398),(180,491),(133,491)])
for num,bounds,title in [
 ('301',(43,86,129,161),'Аудитория'),('302',(185,87,272,236),'Лаборатория'),
 ('303',(43,168,125,240),'Аудитория'),('303а',(43,247,125,321),'Аудитория'),
 ('304',(185,245,273,330),'Аудитория'),('305',(43,330,131,491),'Аудитория'),
 ('307',(181,414,271,491),'Аудитория'),('309',(359,412,438,491),'Аудитория'),
 ('310',(445,291,520,364),'Преподавательская'),('311',(444,410,603,490),'Лаборатория'),
 ('312',(525,286,639,366),'Класс'),('313',(607,410,740,489),'Класс'),
 ('314',(645,283,759,365),'Класс'),('315',(746,408,924,486),'Преподавательская'),
 ('316',(766,281,844,367),'Лаборатория'),('317',(1015,407,1170,479),'Класс'),
 ('318',(851,282,929,364),'Класс'),('318а',(936,282,969,365),'Кабинет'),
 ('319',(1181,359,1272,434),'Класс'),('320',(1010,280,1044,365),'Кабинет'),
 ('322',(1132,280,1172,363),'Приёмная')]:
    doors={'301':(129,145,'v'),'302':(185,117,'v'),'303':(125,187,'v'),
           '303а':(125,303,'v'),'304':(185,305,'v'),'305':(131,360,'v'),
           '307':(181,432,'v'),'309':(422,412),'310':(510,364),
           '311':(536,410),'312':(573,366),'313':(675,410),'314':(677,365),
           '315':(780,408),'316':(789,367),'317':(1134,407),'318':(880,364),
           '318а':(947,365),'319':(1181,387,'v'),'320':(1034,365),'322':(1142,363)}
    room(f3,num,bounds,title,doors.get(num))
# The evacuation plan shows a side corridor and two stair landings along the main wing.
turn=node(f3,'turn',157,385)
for l in [l for l in pack['locations'] if l['floorId']==f3['id'] and l['type']=='room' and l['nodeId']]:
    n=next(n for n in pack['nodes'] if n['id']==l['nodeId']);x=1280-n['point'][1];y=n['point'][0]
    j=node(f3,'hall-'+l['number'],157 if x<=185 else x,y if x<=185 else 385)
    edge(j['id'],n['id']);pack['declaredTargets'].append(l['id'])
for key,x in [('west',318),('east',972)]:
    l=poi(f3,key,x,452,'Лестница '+('у левого торца' if key=='west' else 'у аудитории 317'),'stairs','cw-stairs-'+key)
    j=node(f3,key+'-hall',x,385);edge(l['nodeId'],j['id']);pack['routeOrigins'].append(l['id'])
    other=next(l for l in pack['locations'] if l['id']==f4['id']+'-'+key);edge(l['nodeId'],other['nodeId'],'stairs')
side=sorted([n for n in pack['nodes'] if n['floorId']==f3['id'] and n['type']=='junction' and n['point'][1]==1280-157],key=lambda n:n['point'][0])
main=sorted([n for n in pack['nodes'] if n['floorId']==f3['id'] and n['type']=='junction' and n['point'][0]==385],key=lambda n:n['point'][1])
for chain in [side,main]:
    for a,b in zip(chain,chain[1:]):edge(a['id'],b['id'])
poi(f3,'wc',387,323,'Туалет','toilet')
# Outline each room without claiming an unseen door or a traversable route.
# Areas define the visual walls; confirmed gaps are separate door segments for mapped routes.
pack['floors'].sort(key=lambda f:f['order'])
(ROOT/'app/data/maps.json').write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"CampusWay: {len(pack['floors'])} floors, {sum(l['type']=='room' for l in pack['locations'])} rooms, {len(pack['edges'])} archive-plan edges")
