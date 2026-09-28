"""Rebuild the bundled pack: original CampusWay IDs + traced September floor plans.

Coordinates below are rectified schematic tracings, not metres or GPS. Source
photo numbers refer to the private intake catalogue, never to public image URLs.
Run this script (not prepare_campusway.py) to regenerate the complete bundle.
"""
import json
import math
import runpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
pack = runpy.run_path(str(ROOT/'tools/prepare_campusway.py'))['pack']
SOURCE = 'Планы этажей, фото команды от 28.09.2026; доступность проходов не проверена'
pack.update(dataVersion='survey-2026.09.29', source='CampusWay (этажи 3–5 корпуса 6) и планы этажей, фото команды от 28.09.2026')
# Only these explicit ground-floor anchors receive a manual campus handoff.
# An isolated annex is not implicitly connected to a building centre.
pack['campusAnchors'] = []


def slug(s):
    return str(s).translate(str.maketrans({'а':'a','б':'b','в':'v'}))


def edge(a, b, kind='corridor'):
    if a['id'] == b['id']:
        return
    g = [a['point'], b['point']]
    pack['edges'].append(dict(id=f'sv-edge-{len(pack["edges"])}', **{'from':a['id']}, to=b['id'],
        kind=kind, weight=1 if kind=='stairs' else math.dist(*g), direction='both',
        status='plan', stepFree=None, source=SOURCE, verifiedAt=None,
        geometry=None if kind=='stairs' else g))


class Floor:
    def __init__(self, building, level, photos, *, key=None, name=None, transform='cw', note=None, scale=.4):
        self.id=f'sv-{building}-f{key or level}'
        self.building=str(building)
        self.transform=transform
        self.f=dict(id=self.id, campusId=pack['campusId'], buildingId=self.building,
            name=name or f'{level} этаж', order=level, source=SOURCE, sourceLabel='Планы команды · 28.09.2026',
            sourcePhotos=photos, verifiedAt=None, costScale=scale, areas=[],walls=[],doors=[])
        if note: self.f['navigationNote']=note
        self.nodes={}
        self.segments=[]
        self.junctions={}
        pack['floors'].append(self.f)

    def point(self, p):
        x,y=p
        return [y,1280-x] if self.transform=='cw' else [900-y,x] if self.transform=='reverse' else [x,y]

    def node(self,key,p,kind='junction',name='Коридор',connector=None):
        n=dict(id=self.id+'-n-'+slug(key), campusId=pack['campusId'],buildingId=self.building,
            floorId=self.id,type=kind,name=name,point=self.point(p))
        if connector: n['connectorId']=connector
        pack['nodes'].append(n);self.nodes[key]=n
        return n

    def junction(self,p):
        p=tuple(p)
        if p not in self.junctions:
            self.junctions[p]=self.node('j'+str(len(self.junctions)),p)
        return self.junctions[p]

    def area(self,key,bounds,kind='corridor',location=None):
        if len(bounds)==4 and isinstance(bounds[0],(int,float)):
            x,y,X,Y=bounds;bounds=[(x,y),(X,y),(X,Y),(x,Y)]
        a=dict(id=self.id+'-area-'+slug(key),kind=kind,points=[self.point(p) for p in bounds])
        if location: a['locationId']=location
        self.f['areas'].append(a)
        return a

    def hall(self, points, width=20):
        for a,b in zip(points,points[1:]):
            assert a[0]==b[0] or a[1]==b[1], 'Trace orthogonal hall segments explicitly'
            self.segments.append((tuple(a),tuple(b)))
            self.junction(a);self.junction(b)
            self.area('hall'+str(len(self.segments)),[min(a[0],b[0])-width/2,min(a[1],b[1])-width/2,
                max(a[0],b[0])+width/2,max(a[1],b[1])+width/2])

    def connect(self,n,via):
        edge(n,self.junction(via),'door' if n['type']=='door' else 'corridor')

    def room(self,number,bounds,door=None,via=None,title='Аудитория',key=None,label=None,aliases=None):
        rid='sv-'+self.building+'-'+slug(key or number)
        a=self.area('room-'+slug(key or number),bounds,'room',rid)
        x,y,X,Y=bounds
        loc=dict(id=rid,campusId=pack['campusId'],buildingId=self.building,floorId=self.id,
            type='room',name=f'{title} {self.building}-{number}',number=str(number),
            aliases=[f'{self.building}-{number}',f'кабинет {number}',title]+(aliases or []),
            point=self.point(label or [(x+X)/2,(y+Y)/2]),nodeId=None,doorId=None,areaId=a['id'])
        if door:
            dx,dy,axis=door
            n=self.node('door-'+slug(key or number),(dx,dy),'door',loc['name'])
            loc['nodeId']=n['id'];loc['doorId']=rid+'-door'
            ends=[(dx-5,dy),(dx+5,dy)] if axis=='h' else [(dx,dy-5),(dx,dy+5)]
            self.f['doors'].append(dict(id=loc['doorId'],nodeId=n['id'],points=[self.point(p) for p in ends]))
            self.connect(n,via)
            pack['declaredTargets'].append(rid)
        pack['locations'].append(loc)
        return loc

    def poi(self,key,p,name,kind='stairs',via=None,connector=None,origin=False,anchor=False):
        n=self.node(key,p,kind if kind in ('stairs','entrance','lift') else 'landmark',name,
            connector or (self.id+'-'+key if kind in ('stairs','lift') else None))
        loc=dict(id=self.id+'-'+key,campusId=pack['campusId'],buildingId=self.building,floorId=self.id,
            type=kind,name=name,aliases=[name],point=n['point'],nodeId=n['id'] if via else None)
        pack['locations'].append(loc)
        if via: self.connect(n,via)
        if origin: pack['routeOrigins'].append(loc['id'])
        if anchor: pack['campusAnchors'].append(loc['id'])
        return n

    def finish(self):
        # Split at ALL room projections and corridor intersections. This avoids
        # the centre-spur routing bug already fixed on the outdoor campus map.
        for a,b in self.segments:
            for c,d in self.segments:
                if a[0]==b[0] and c[1]==d[1]:
                    p=(a[0],c[1])
                    if min(a[1],b[1])<=p[1]<=max(a[1],b[1]) and min(c[0],d[0])<=p[0]<=max(c[0],d[0]):
                        self.junction(p)
        for a,b in self.segments:
            for c,d in self.segments:
                if a[0]==b[0] and c[1]==d[1]:
                    p=(a[0],c[1])
                    if min(a[1],b[1])<=p[1]<=max(a[1],b[1]) and min(c[0],d[0])<=p[0]<=max(c[0],d[0]):
                        self.junction(p)
        for a,b in self.segments:
            on=[]
            for p,n in self.junctions.items():
                if (a[0]==b[0]==p[0] and min(a[1],b[1])<=p[1]<=max(a[1],b[1])) or \
                   (a[1]==b[1]==p[1] and min(a[0],b[0])<=p[0]<=max(a[0],b[0])): on.append((p,n))
            on.sort(key=lambda item:item[0])
            for (_,na),(_,nb) in zip(on,on[1:]): edge(na,nb)
        # Room boundaries have real gaps at traced doors. Validation can then
        # reject a route that cuts a corner through another numbered room.
        for area in self.f['areas']:
            if not area.get('locationId'): continue
            loc=next(l for l in pack['locations'] if l['id']==area['locationId'])
            door=next((d for d in self.f['doors'] if d['id']==loc['doorId']),None)
            polygon=area['points']
            for a,b in zip(polygon,polygon[1:]+polygon[:1]):
                if door and all(abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))<.001 for p in door['points']):
                    first,last=sorted(door['points'],key=lambda p:math.dist(a,p))
                    self.f['walls'].extend([[a,first],[last,b]])
                else: self.f['walls'].append([a,b])
        points=[p for a in self.f['areas'] for p in a['points']]+[n['point'] for n in self.nodes.values()]
        xs,ys=zip(*points)
        self.f['viewBox']=[min(xs)-15,min(ys)-15,max(xs)-min(xs)+30,max(ys)-min(ys)+30]


# 6/1: vestibule, main wing and right-hand publishing annex. Technical
# rooms retain their printed numbers but deliberately have no route target.
f61=Floor(6,1,[52,53,54,68,71],scale=.59)
f61.area('vestibule',[270,130,477,329])
f61.hall([(360,105),(360,320),(1025,320)],20)
f61.hall([(300,320),(360,320)],20)
f61.hall([(975,320),(975,240),(960,240)],16)
f61.area('publishing',[858,150,1014,235],'room')
f61.poi('publishing',(935,180),'Редакционно-издательское помещение','landmark')
for row in [
    ('101',(270,330,342,385),(320,330,'h'),(320,320),'Кабинет'),
    ('104',(580,253,679,306),(622,306,'h'),(622,320),'Аудитория'),
    ('106',(682,253,779,306),(725,306,'h'),(725,320),'Аудитория'),
    ('108',(782,253,831,306),(801,306,'h'),(801,320),'Лаборатория'),
    ('107',(530,330,578,385),(567,330,'h'),(567,320),'Класс'),
    ('109',(581,330,675,385),(623,330,'h'),(623,320),'Аудитория'),
    ('111',(678,330,730,385),(711,330,'h'),(711,320),'Лаборатория'),
    ('111а',(733,330,780,385),None,None,'Служебное помещение'),
    ('113',(783,330,882,385),(814,330,'h'),(814,320),'Лаборатория'),
    ('115',(935,330,985,385),(950,330,'h'),(950,320),'Кабинет'),
    ('115а',(988,330,1038,385),(1006,330,'h'),(1006,320),'Кабинет'),
    ('122а',(885,253,932,306),None,None,'Техническое помещение'),
]: f61.room(*row)
for key,bounds in [('lab',[345,330,413,385]),('office',[416,353,477,385]),('storage',[416,330,477,350]),('technical',[834,253,882,306]),('wc',[530,253,577,306])]:
    f61.area(key,bounds,'room')
f61.poi('wc',(551,280),'Туалет','toilet')
f61.area('west-landing',[481,330,526,385]);f61.area('east-landing',[885,330,932,385])
f61.poi('entry',(360,105),'Вход у вестибюля','entrance',via=(360,120),origin=True,anchor=True)
w61=f61.poi('west',(505,350),'Лестница у начала длинного коридора',via=(505,320),connector='cw-stairs-west',origin=True)
e61=f61.poi('east',(905,355),'Лестница у кабинета 115',via=(905,320),connector='cw-stairs-east',origin=True)
f61.finish()

# 6/2: the source is portrait. Duplicate 216 labels are preserved as two
# candidates; the plan alone cannot tell whether they are one current room.
f62=Floor(6,2,[50,51,72],transform='plain',scale=.43)
f62.hall([(320,80),(320,980),(160,980)],26)
f62.hall([(320,980),(385,980)],26)
f62.hall([(100,380),(320,380)],24)
for number,bounds,door,via,title,key in [
    ('201',(170,995,215,1080),(190,995,'h'),(190,980),'Аудитория',None),
    ('203',(219,995,285,1080),(250,995,'h'),(250,980),'Аудитория',None),
    ('205',(289,995,385,1080),(345,995,'h'),(345,980),'Аудитория',None),
    ('202',(170,880,245,965),(200,965,'h'),(200,980),'Аудитория',None),
    ('204',(249,880,302,965),(275,965,'h'),(275,980),'Аудитория',None),
    ('207',(337,880,385,965),(355,965,'h'),(355,980),'Аудитория',None),
    ('210',(230,680,303,775),(303,715,'v'),(320,715),'Преподавательская',None),
    ('212',(230,630,303,676),(303,645,'v'),(320,645),'Кабинет',None),
    ('214',(230,580,303,626),(303,600,'v'),(320,600),'Кабинет',None),
    ('216',(230,530,303,576),(303,542,'v'),(320,542),'Кабинет · участок ближе к 214','216-south'),
    ('216',(230,480,303,526),(303,510,'v'),(320,510),'Кабинет · участок ближе к 218','216-north'),
    ('218',(230,430,303,476),(303,458,'v'),(320,458),'Лаборатория',None),
    ('220',(230,400,303,426),(303,415,'v'),(320,415),'Кабинет',None),
    ('222',(230,345,303,370),(303,359,'v'),(320,359),'Кабинет',None),
    ('224',(230,295,303,340),(303,319,'v'),(320,319),'Кабинет',None),
    ('211',(337,650,415,775),(337,705,'v'),(320,705),'Преподавательская',None),
    ('213',(337,490,415,646),(337,555,'v'),(320,555),'Класс',None),
    ('215а',(337,405,415,486),(337,450,'v'),(320,450),'Преподавательская',None),
    ('215б',(337,310,415,401),(337,350,'v'),(320,350),'Класс',None),
    ('217б',(337,145,415,235),(337,198,'v'),(320,198),'Лаборатория',None),
    ('217',(337,60,415,141),(337,98,'v'),(320,98),'Класс',None),
    ('219',(100,155,220,355),(205,355,'h'),(205,380),'Кинозал',None),
]: f62.room(number,bounds,door,via,title,key=key)
# The west-to-cinema branch runs below the technical rooms. Adjust the
# compact cabinet stack to keep that transverse hall free of room interiors.
f62.area('old-cafe',[337,780,415,820],'room')
f62.area('wc',[230,780,303,862],'room')
f62.poi('wc',(264,821),'Туалет','toilet')
f62.area('west-landing',[337,825,415,876])
f62.area('east-landing',[337,240,415,305])
w62=f62.poi('west',(366,870),'Лестница у начала длинного коридора',via=(320,870),connector='cw-stairs-west',origin=True)
e62=f62.poi('east',(366,270),'Лестница у кинозала 219',via=(320,270),connector='cw-stairs-east',origin=True)
f62.poi('side-north',(145,910),'Лестница у аудитории 202',via=(160,910),origin=True)
f62.hall([(160,910),(160,1040)],16)
f62.poi('side-south',(145,1040),'Лестница у аудитории 201',via=(160,1040),origin=True)
f62.finish()
for a,b in [(w61,w62),(e61,e62)]: edge(a,b,'stairs')
for n,key in [(w62,'west'),(e62,'east')]:
    old=next(n for n in pack['nodes'] if n['id']=='cw-6-f3-node-'+key)
    edge(n,old,'stairs')

# Separate 4/4.5 annex: explicit local start only, no invented link to floors 4/5.
f645=Floor(6,4.5,[43,59],key='4-annex',name='4,5 · крыло',scale=.55,
    note='На плане указан 4 этаж; в подписи к фото — «4,5, переход с пятого». Связь с другими этажами не уточнена. Маршрут доступен внутри этого участка от выбранной точки.')
f645.hall([(370,280),(770,280)],30)
f645.hall([(425,280),(425,210)],18)
f645.area('lab-vestibule',[394,192,455,249])
f645.hall([(410,280),(410,465)],20)
for row in [
    ('401а',(675,150,751,249),(697,249,'h'),(697,280),'Лаборатория'),
    ('401б',(494,150,672,249),(618,249,'h'),(618,280),'Аудитория'),
    ('403в',(280,141,390,248),(390,217,'v'),(425,217),'Лаборатория'),
    ('403б',(394,141,443,189),(420,189,'h'),(425,210),'Лаборатория'),
    ('403а',(458,150,491,248),(458,220,'v'),(425,220),'Лаборатория'),
    ('405',(280,254,373,316),(373,281,'v'),(373,280),'Кабинет'),
    ('407',(280,321,397,422),(397,342,'v'),(410,342),'Лаборатория'),
    ('408',(433,320,489,414),None,None,'Серверная'),
    ('406',(492,316,584,414),(542,316,'h'),(542,280),'Медиацентр'),
    ('404',(587,314,668,411),(620,314,'h'),(620,280),'Конструкторское бюро'),
    ('402',(671,313,750,406),(720,313,'h'),(720,280),'Кабинет'),
]: f645.room(*row)
f645.area('north-landing',[756,163,807,249]);f645.area('south-landing',[756,320,807,405])
f645.area('west-landing',[280,425,491,544])
f645.poi('north',(779,212),'Лестница в верхнем торце',via=(770,280),origin=True)
f645.poi('south',(779,364),'Лестница в нижнем торце',via=(770,280),origin=True)
f645.poi('west',(348,465),'Лестница у лаборатории 407',via=(410,465),origin=True)
f645.finish()

# 7/1 is printed facing the other way from floors 2–4. Rotate it by 180°
# relative to their source orientation; room numbers do not define the floor.
f71=Floor(7,1,[56,57,77,104,105,106],transform='reverse',scale=.42)
f71.hall([(360,350),(1160,350)],20)
f71.hall([(300,525),(300,425),(365,425),(365,280)],20)
f71.area('vestibule',[190,425,413,513])
for number,bounds,door,via,title in [
    ('101',(1098,254,1164,336),(1136,336,'h'),(1136,350),'Лаборатория'),
    ('104',(873,254,904,336),(889,336,'h'),(889,350),'Лаборатория'),
    ('105',(839,254,870,336),(855,336,'h'),(855,350),'Лаборатория'),
    ('106',(803,254,836,336),(818,336,'h'),(818,350),'Конструкторское бюро'),
    ('107',(695,254,800,336),(719,336,'h'),(719,350),'Лаборатория'),
    ('108',(641,254,692,336),(660,336,'h'),(660,350),'Преподавательская'),
    ('109',(588,290,638,336),None,None,'Кабинет'),
    ('110',(479,254,585,336),(548,336,'h'),(548,350),'Лаборатория'),
    ('115',(303,254,355,310),(355,285,'v'),(365,285),'Библиотека'),
]: f71.room(number,bounds,door,via,title,aliases=['библиотека'] if number=='115' else [])
f71.room('109',(191,254,242,417),None,None,'МФСО',key='109-mfso')
for key,bounds in [('wc-west',[422,280,456,335]),('wc-east',[974,254,1011,336]),('unknown',[1015,254,1038,336])]:
    f71.area(key,bounds,'room')
f71.poi('wc-west',(438,308),'Туалет у лаборатории 110','toilet')
f71.poi('wc-east',(992,307),'Туалет у лаборатории 101','toilet')
f71.poi('library',(340,285),'Библиотека, кабинет 115','library')
f71.area('west-landing',[908,275,970,338])
w71=f71.poi('wing-stair',(944,314),'Лестница у лабораторий 104 и 105',via=(944,350),connector='sv-7-wing-stair',origin=True)
f71.area('hall-landing',[420,363,477,405])
f71.poi('hall-stair',(451,388),'Лестница у лаборатории 110',via=(451,350),origin=True)
f71.poi('entry',(300,525),'Главный вестибюль, вход','entrance',via=(300,510),origin=True,anchor=True)
f71.finish()

previous=w71
for level,photos in [(2,[76,102,103]),(3,[75]),(4,[74])]:
    f=Floor(7,level,photos,scale=.42)
    # Aligned plan tracings, with the auditorium and library wings retained.
    f.hall([(125,485),(990,485)],20)
    f.hall([(980,485),(980,335),(1055,335),(1055,310)],20)
    f.area('library-wing',[942,305,1178,588])
    for suffix,bounds,dx,title in [
        ('01',(120,503,297,588),157,'Аудитория'),
        ('04',(430,503,595,588),455,'Аудитория'),
        ('05',(598,503,650,588),625,'Аудитория'),
        ('06',(654,503,817,588),685,'Аудитория'),
        ('07',(820,503,875,588),845,'Лаборатория' if level==2 else 'Аудитория'),
    ]: f.room(str(level)+suffix,bounds,(dx,503,'h'),(dx,485),title)
    f.area('wc-west',[300,503,369,588],'room')
    f.area('wc-east',[879,503,933,551],'room')
    f.poi('wc-west',(334,536),'Туалет у большой аудитории','toilet')
    f.poi('wc-east',(905,525),'Туалет у библиотеки','toilet')
    f.area('wing-landing',[375,505,424,588])
    stair=f.poi('wing-stair',(401,554),'Лестница между аудиториями '+str(level)+'01 и '+str(level)+'04',
        via=(401,485),connector='sv-7-wing-stair',origin=True)
    edge(previous,stair,'stairs');previous=stair
    if level in (2,3):
        # The same printed numbers also label lecture rooms. Keep separate
        # place IDs, and let search/resolvePlace preserve this ambiguity.
        f.room(str(level)+'06',(942,350,978,468),(967,468,'h'),(967,485),
            'Читальный зал',key=str(level)+'06-reading',aliases=['библиотека'])
        f.room(str(level)+'05',(1122,350,1178,550),None,None,
            'Читальный зал',key=str(level)+'05-reading',aliases=['библиотека'])
        f.area('book-storage',[1005,356,1118,526],'room')
        f.poi('library',(1055,400),'Библиотека и книгохранилище','library')
    else:
        f.area('office1',[942,560,1001,588],'room')
        f.area('office2',[1005,533,1118,588],'room')
        f.area('centre',[1005,356,1118,526],'room')
    f.area('north-left-landing',[942,265,1027,301])
    f.area('north-right-landing',[1094,265,1178,301])
    # These two stairs stay visible. Their exact cross-level correspondence
    # and access through the library are not used as a route shortcut.
    f.poi('library-left-stair',(980,282),'Лестница в левом торце библиотеки')
    f.poi('library-right-stair',(1137,282),'Лестница в правом торце библиотеки')
    f.finish()

for f in pack['floors']:
    if f['id'].startswith('cw-'): f['sourceLabel']='CampusWay · архивный план'
pack['floors'].sort(key=lambda f:(int(f['buildingId']),f['order']))
target=ROOT/'app/data/maps.json'
target.write_text(json.dumps(pack,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f"Survey pack: {len(pack['floors'])} plans, {sum(l['type']=='room' for l in pack['locations'])} rooms, {len(pack['edges'])} plan edges")
