import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {validateEvents} from '../app/core.js';
import {campusPreview,eventEnded,kindBadge,clubCard,clubDetail} from '../app/student-life.js';

const now=Date.parse('2026-09-28T16:00:00+05:00');
const event={id:'test',title:'Встреча',date:'2026-09-28',time:'16:00',endTime:'17:00'};
test('attendance survives normalization; imported files cannot impersonate shared events',()=>{
  const payload={schemaVersion:1,events:[{...event,kind:'student',community:true,capacity:7,attendeeCount:3,viewerGoing:true,room:'416',organizer:'Студсовет'}]};
  const [shared]=validateEvents(payload);
  assert.equal(shared.capacity,7);assert.equal(shared.attendeeCount,3);assert.equal(shared.viewerGoing,true);assert.equal(shared.room,'416');
  const [imported]=validateEvents(payload,true);
  assert.equal(imported.community,false);assert.equal(imported.kind,'imported');assert.equal(imported.viewerGoing,false);assert.equal(imported.attendeeCount,0);
  assert.doesNotMatch(kindBadge(imported),/УУНиТ ✓/);
});
test('home mixes a club, nearest official and nearest student event; excludes finished events',()=>{
  const items=campusPreview([{...event,id:'past',endTime:'15:59',kind:'student'}, {...event,id:'student',kind:'student'}, {...event,id:'official',kind:'official'}, {...event,id:'later',kind:'student',date:'2026-09-30'}],[{id:'club'}],now);
  assert.deepEqual(items.map(x=>x.item.id),['club','official','student']);
  assert.equal(eventEnded(event,Date.parse('2026-09-28T12:00:00Z')),true);
  assert.deepEqual(campusPreview([],[],now),[]);
});
test('club catalog has unique IDs, primary sources, safe social links and bundled photographs',()=>{
  const {clubs}=JSON.parse(readFileSync(new URL('../app/data/clubs.json',import.meta.url),'utf8'));
  assert.equal(clubs.length,35,'Полный официальный каталог от 29.09.2026');
  assert.equal(new Set(clubs.map(c=>c.id)).size,clubs.length);
  for(const club of clubs){
    assert.match(club.source,/^https:\/\/uust\.ru\/departments\//);
    if(club.vk)assert.match(club.vk,/^https:\/\/vk\.com\//);
    if(club.telegram)assert.match(club.telegram,/^https:\/\/t\.me\//);
    if(club.image)assert.ok(existsSync(new URL('../app/'+club.image,import.meta.url)));
    assert.ok(club.activities.length);assert.ok(club.audience);
  }
});
test('club text is escaped in both card and detail',()=>{
  const club={id:'x" onclick="alert(1)',name:'<script>alert(1)</script>',summary:'<img onerror=1>',description:'<script>',activities:['<img>'],audience:'<iframe>',source:'https://uust.ru'};
  assert.doesNotMatch(clubCard(club),/<script>|<img onerror|data-id="x" onclick/);
  assert.doesNotMatch(clubDetail(club),/<script>|<iframe>|<li><img>/);
});
