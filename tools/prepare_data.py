"""One-time conversion of the team-supplied map and captured public JSON data."""
from pathlib import Path
import json, re, shutil, datetime

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'research' / 'ugatu_interactive_map'
out = ROOT / 'app' / 'data'
out.mkdir(parents=True, exist_ok=True)
images = ROOT / 'app' / 'assets' / 'buildings'
images.mkdir(parents=True, exist_ok=True)
html = (source / 'index.html').read_text(encoding='utf-8')
centers = {'1':[986,584], '2':[670,522], '3':[237,563], '4':[341,242], '5':[530,240], '6':[797,264], '7':[1205,264], '8':[1459,454], '9':[1382,682]}
buildings = []
for element in re.findall(r'<path\s[\s\S]*?/>', html):
    attrs = dict(re.findall(r'([\w-]+)\s*=\s*"([^"]*)"', element))
    title = attrs.get('data-title', '')
    ident = title.split()[-1]
    if ident not in centers or not attrs.get('d', '').strip():
        continue
    photo = source / attrs.get('data-photo', '')
    target = ''
    if photo.is_file():
        shutil.copy2(photo, images / photo.name)
        target = 'assets/buildings/' + photo.name
    buildings.append({'id':ident, 'name':title, 'address':'Кампус на Карла Маркса, 12', 'path':re.sub(r'\s+', ' ', attrs['d']).strip(), 'center':centers[ident], 'photo':target,
        'description': 'Учебный корпус на схеме команды. Расположение входов и доступность проходов требуют проверки на месте.',
        'source':'Архив ugatu_interactive_map_1.rar, предоставленный командой', 'entranceVerified':False})
buildings.sort(key=lambda b:int(b['id']))
(out / 'buildings.json').write_text(json.dumps({'schemaVersion':1, 'viewBox':[0,0,1706.6667,952], 'buildings':buildings}, ensure_ascii=False, indent=2), encoding='utf-8')
shutil.copy2(source / 'images' / '5312549502487045079.jpg', ROOT / 'app' / 'assets' / 'original-map.jpg')
for name in ['groups.json', 'schedule-14381-241.json']:
    shutil.copy2(ROOT / 'research' / name, out / name)
(out / 'snapshot.json').write_text(json.dumps({'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'groupId':14381,'semester':241,'source':'https://schedule.uust.ru/schedule?type=0&id=14381'}, indent=2), encoding='utf-8')
print(f'Prepared {len(buildings)} buildings, group directory and real schedule snapshot.')
