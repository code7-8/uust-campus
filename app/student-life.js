import {dateKey,ufaTimestamp} from './core.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function eventKind(event){return event.imported?'imported':event.kind==='student'?'student':'official';}
export function kindBadge(event){
  const kind=eventKind(event);
  return `<span class="life-badge ${kind}">${kind==='student'?'От студента':kind==='imported'?'Импорт команды':'УУНиТ ✓'}</span>`;
}
export function eventEnded(event,now=Date.now()){
  return ufaTimestamp(event.date,event.endTime||'23:59')<=now;
}
export function campusPreview(events,clubs,now=Date.now()){
  const upcoming=events.filter(e=>!eventEnded(e,now));
  const today=dateKey(new Date(now));
  const sorted=[...upcoming].sort((a,b)=>(b.date===today)-(a.date===today)||a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  return [clubs[0]&&{type:'club',item:clubs[0]},
    sorted.find(e=>eventKind(e)==='official')&&{type:'event',item:sorted.find(e=>eventKind(e)==='official')},
    sorted.find(e=>eventKind(e)==='student')&&{type:'event',item:sorted.find(e=>eventKind(e)==='student')}].filter(Boolean);
}
function clubImage(club){
  return club.image?`<img src="${esc(club.image)}" alt="${esc(club.imageAlt)}" loading="lazy" width="640" height="400">`:
    `<div class="club-monogram" aria-hidden="true">${esc(club.monogram||club.name.slice(0,2))}<span>ИДЕИ СТАНОВЯТСЯ ИГРАМИ</span></div>`;
}
export function clubCard(club){
  return `<article class="club-card"><button data-action="club-detail" data-id="${esc(club.id)}" aria-label="О клубе ${esc(club.name)}"><div class="club-image">${clubImage(club)}<span class="life-badge club">Студенческий клуб</span></div><div class="club-body"><span class="eyebrow">${esc(club.category)}</span><h3>${esc(club.name)}</h3><p>${esc(club.summary)}</p><span class="club-more">Найти своих <span aria-hidden="true">↗</span></span></div></button></article>`;
}
export function clubDetail(club){
  const link=(label,key)=>club[key]?`<button class="button ${key==='source'?'outline':'light'}" data-action="club-link" data-id="${esc(club.id)}" data-link="${key}">${label} ↗</button>`:'';
  return `<div class="club-detail-image">${clubImage(club)}</div><span class="life-badge club">${esc(club.category)}</span><h1>${esc(club.name)}</h1><p class="life-description">${esc(club.description)}</p><h2 class="life-subheading">Чем занимаются</h2><ul class="club-activities">${club.activities.map(a=>`<li>${esc(a)}</li>`).join('')}</ul><h2 class="life-subheading">Кому подойдёт</h2><p>${esc(club.audience)}</p><div class="club-links">${link('Сообщество VK','vk')}${link('Присоединиться в Telegram','telegram')}${link('Страница на сайте УУНиТ','source')}</div><p class="source-line">Описание и ссылки — по каталогу УУНиТ, проверено ${esc(club.checkedAt)}. Условия набора и ближайшие встречи уточняйте в сообществе.${club.image?' Фото: УУНиТ.':''}</p>`;
}
