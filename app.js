const $ = s => document.querySelector(s);
const DAY_COLORS = ['#c8432b', '#2c6fbb', '#2e8b57', '#b8860b', '#8e44ad', '#d35400', '#16a085', '#7f8c8d'];
const dayColor = i => DAY_COLORS[i % DAY_COLORS.length];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const dur = m => (m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`);
const key = p => `${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;

// ---------- 狀態（存在瀏覽器裡，下次打開還在） ----------
const state = { days: 4, date: '', start: 'none', pace: 'normal', places: [] };
try {
  const saved = JSON.parse(localStorage.getItem('jp-trip') || 'null');
  if (saved) Object.assign(state, saved);
} catch (e) { /* 無法讀取就用預設值 */ }
const save = () => { try { localStorage.setItem('jp-trip', JSON.stringify(state)); } catch (e) { /* 忽略 */ } };

// ---------- 設定 ----------
$('#start').innerHTML = Object.entries(STARTS)
  .map(([k, v]) => `<option value="${k}">${v ? esc(v.name) : '不指定（從第一個景點開始）'}</option>`).join('');
$('#start').value = state.start;
$('#days').value = state.days;
$('#date').value = state.date;
const paintPace = () => document.querySelectorAll('#pace button')
  .forEach(b => b.classList.toggle('on', b.dataset.v === state.pace));
paintPace();

$('#days').addEventListener('change', e => {
  state.days = Math.min(21, Math.max(1, parseInt(e.target.value, 10) || 1));
  e.target.value = state.days; save(); replanIfShown();
});
$('#date').addEventListener('change', e => { state.date = e.target.value; save(); replanIfShown(); });
$('#start').addEventListener('change', e => { state.start = e.target.value; save(); replanIfShown(); });
$('#pace').addEventListener('click', e => {
  if (!e.target.dataset.v) return;
  state.pace = e.target.dataset.v; paintPace(); save(); replanIfShown();
});

// ---------- 清單 ----------
function addPlace(p) {
  if (state.places.some(x => key(x) === key(p))) return;
  state.places.push({ name: p.name, ja: p.ja || '', region: p.region || '其他', lat: p.lat, lng: p.lng, hours: p.hours || 1.5, tag: p.tag || '' });
  save(); renderList(); renderRegionSpots();
}
function removePlace(k) {
  state.places = state.places.filter(p => key(p) !== k);
  save(); renderList(); renderRegionSpots();
}

const HOUR_OPTS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 9];
function renderList() {
  const ul = $('#list');
  ul.innerHTML = state.places.map(p => `
    <li data-k="${esc(key(p))}">
      <span class="name">${esc(p.name)}<small>${esc(p.region)}</small></span>
      <select aria-label="停留時間">${HOUR_OPTS.concat(HOUR_OPTS.includes(p.hours) ? [] : [p.hours]).sort((a, b) => a - b)
        .map(h => `<option value="${h}" ${h === p.hours ? 'selected' : ''}>${h} 小時</option>`).join('')}</select>
      <button type="button" class="x" aria-label="移除">×</button>
    </li>`).join('');
  $('#count').textContent = state.places.length ? `${state.places.length} 個` : '';
  $('#listEmpty').hidden = state.places.length > 0;
  $('#plan').disabled = state.places.length === 0;
}
$('#list').addEventListener('click', e => {
  if (e.target.classList.contains('x')) removePlace(e.target.closest('li').dataset.k);
});
$('#list').addEventListener('change', e => {
  const k = e.target.closest('li').dataset.k;
  const p = state.places.find(x => key(x) === k);
  if (p) { p.hours = parseFloat(e.target.value); save(); }
});
$('#clear').addEventListener('click', () => {
  if (!state.places.length || !confirm('確定要清空清單嗎？')) return;
  state.places = []; save(); renderList(); renderRegionSpots();
});

// ---------- 地區快速選 ----------
const REGIONS = [...new Set(SPOTS.map(s => s.region))];
let openRegion = null;
$('#regions').innerHTML = REGIONS.map(r => `<button type="button" class="chip" data-r="${esc(r)}">${esc(r)}</button>`).join('');
$('#regions').addEventListener('click', e => {
  const r = e.target.dataset.r;
  if (!r) return;
  openRegion = openRegion === r ? null : r;
  renderRegionSpots();
});
function renderRegionSpots() {
  document.querySelectorAll('#regions .chip').forEach(c => c.classList.toggle('on', c.dataset.r === openRegion));
  const box = $('#regionSpots');
  if (!openRegion) { box.hidden = true; return; }
  const have = new Set(state.places.map(key));
  box.hidden = false;
  box.innerHTML = SPOTS.filter(s => s.region === openRegion).map(s => {
    const added = have.has(key(s));
    return `<button type="button" class="chip ${added ? 'added' : ''}" data-i="${SPOTS.indexOf(s)}">${added ? '✓' : '+'} ${esc(s.name)}</button>`;
  }).join('');
}
$('#regionSpots').addEventListener('click', e => {
  const btn = e.target.closest('[data-i]');
  if (!btn) return;
  const s = SPOTS[+btn.dataset.i];
  if (state.places.some(p => key(p) === key(s))) removePlace(key(s)); else addPlace(s);
});

// ---------- 搜尋 ----------
const q = $('#q'), sug = $('#suggest');
let options = [], active = -1, webTimer = null;

function matchLocal(text) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  return SPOTS.filter(s => s.keywords.includes(t)).slice(0, 8);
}
function showOptions(list) {
  options = list; active = list.length ? 0 : -1;
  if (!list.length) { sug.hidden = true; return; }
  sug.innerHTML = list.map((o, i) => `<li data-i="${i}" class="${i === active ? 'active' : ''}">${o.html}</li>`).join('');
  sug.hidden = false;
}
function buildOptions() {
  const text = q.value.trim();
  if (!text) { showOptions([]); return; }
  const local = matchLocal(text).map(s => ({
    html: `<span>${esc(s.name)}</span><span class="tag">${esc(s.region)}</span>`,
    pick: () => addPlace(s),
  }));
  local.push({
    html: `<span class="web">🔍 搜尋全日本：「${esc(text)}」</span>`,
    pick: () => searchWeb(text),
    keepOpen: true,
  });
  showOptions(local);
}
function choose(i) {
  const o = options[i];
  if (!o) return;
  o.pick();
  if (!o.keepOpen) { q.value = ''; showOptions([]); q.focus(); }
}
q.addEventListener('input', buildOptions);
q.addEventListener('keydown', e => {
  if (sug.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    [...sug.children].forEach((li, i) => li.classList.toggle('active', i === active));
  } else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
  else if (e.key === 'Escape') showOptions([]);
});
sug.addEventListener('mousedown', e => {
  const li = e.target.closest('li[data-i]');
  if (li) { e.preventDefault(); choose(+li.dataset.i); }
});
q.addEventListener('blur', () => setTimeout(() => showOptions([]), 150));

// 用 OpenStreetMap 搜尋內建清單沒有的地點
function nearestRegion(p) {
  let best = null, bd = Infinity;
  for (const s of SPOTS) { const d = distanceKm(p, s); if (d < bd) { bd = d; best = s; } }
  return bd < 40 ? best.region : '其他';
}
async function searchWeb(text) {
  clearTimeout(webTimer);
  showOptions([{ html: '<span class="tag">搜尋中…</span>', pick: () => {}, keepOpen: true }]);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=jp&limit=6&accept-language=zh-TW,ja&q=' + encodeURIComponent(text);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await res.json();
    if (!data.length) {
      showOptions([{ html: '<span class="tag">找不到，換個寫法試試（日文名稱通常比較準）</span>', pick: () => {}, keepOpen: true }]);
      return;
    }
    showOptions(data.map(r => {
      const p = { name: r.name || r.display_name.split(',')[0], ja: '', lat: +r.lat, lng: +r.lon, hours: 1.5 };
      p.region = nearestRegion(p);
      const detail = r.display_name.split(',').slice(1, 3).join('、');
      return { html: `<span>${esc(p.name)}</span><span class="tag">${esc(detail)}</span>`, pick: () => addPlace(p) };
    }));
    sug.hidden = false; q.focus();
  } catch (e) {
    showOptions([{ html: '<span class="tag">搜尋失敗，請檢查網路後再試</span>', pick: () => {}, keepOpen: true }]);
  }
}

// ---------- 地圖 ----------
let map = null, layer = null;
function ensureMap() {
  $('#mapWrap').hidden = false;
  if (map) { map.invalidateSize(); return; }
  map = L.map('map', { scrollWheelZoom: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '© OpenStreetMap',
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}
function drawMap(plan) {
  ensureMap();
  layer.clearLayers();
  const all = [];
  if (plan.start) {
    all.push([plan.start.lat, plan.start.lng]);
    L.marker([plan.start.lat, plan.start.lng], {
      icon: L.divIcon({ className: '', html: '<div class="pin" style="background:#23262f">✈</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
    }).bindTooltip(plan.start.name).addTo(layer);
  }
  plan.days.forEach(d => {
    const color = dayColor(d.index);
    const pts = d.ordered.map(p => [p.lat, p.lng]);
    if (pts.length > 1) L.polyline(pts, { color, weight: 3, opacity: .8 }).addTo(layer);
    d.ordered.forEach((p, i) => {
      all.push([p.lat, p.lng]);
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin" style="background:${color}">${d.index + 1}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).bindTooltip(`第 ${d.index + 1} 天・${i + 1}. ${esc(p.name)}`).addTo(layer);
    });
  });
  if (all.length) map.fitBounds(all, { padding: [30, 30], maxZoom: 14 });
}

// ---------- 排行程 ----------
function dayLabel(i) {
  if (!state.date) return '';
  const d = new Date(state.date + 'T00:00:00');
  d.setDate(d.getDate() + i);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
}
const gmapPlace = p => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.ja || p.name)}%20${p.lat},${p.lng}`;
function gmapRoute(from, ordered) {
  const pts = (from ? [from, ...ordered] : ordered).map(p => `${p.lat},${p.lng}`);
  if (pts.length < 2) return gmapPlace(ordered[0]);
  const u = new URL('https://www.google.com/maps/dir/');
  u.searchParams.set('api', '1');
  u.searchParams.set('origin', pts[0]);
  u.searchParams.set('destination', pts[pts.length - 1]);
  if (pts.length > 2) u.searchParams.set('waypoints', pts.slice(1, -1).join('|'));
  return u.toString();
}

let shown = false;
function replanIfShown() { if (shown && state.places.length) plan(); }

function plan() {
  if (!state.places.length) return;
  const result = planTrip({ places: state.places, days: state.days, startKey: state.start, pace: state.pace });
  shown = true;
  $('#placeholder').hidden = true;

  const warn = !result.overloaded ? ''
    : result.suggestDays > state.days
      ? `<div class="warn">有幾天排得比較滿。照「${PACE[state.pace].label}」步調，建議排 <b>${result.suggestDays} 天</b>，或刪掉幾個地點。</div>`
      : `<div class="warn">有幾天排得比較滿，建議刪掉幾個地點，或把步調改成「緊湊」。</div>`;
  $('#summary').innerHTML = `
    ${warn}
    <div class="summary">
      <span>${state.days} 天・${state.places.length} 個地點・${PACE[state.pace].label}步調</span>
      <div class="actions">
        <button type="button" class="ghost" id="print">列印／存成 PDF</button>
      </div>
    </div>`;
  $('#print').addEventListener('click', () => window.print());

  let from = result.start;
  $('#daysOut').innerHTML = result.days.map(d => {
    const color = dayColor(d.index);
    const date = dayLabel(d.index);
    if (d.free) {
      return `<article class="card day">
        <div class="day-head"><div class="day-badge" style="background:${color}">D${d.index + 1}</div>
        <div><h3>第 ${d.index + 1} 天 ${date}</h3><p>自由活動</p></div></div>
        <p class="free">這天沒有排景點，可以逛街購物、補眠，或再加幾個地點進來。</p></article>`;
    }
    const regions = [...new Set(d.ordered.map(p => p.region))].join('・');
    const rows = d.items.map(it => {
      if (it.type === 'visit') {
        return `<li class="visit"><span class="time">${hhmm(it.start)}</span>
          <div class="what"><a href="${gmapPlace(it.place)}" target="_blank" rel="noopener">${esc(it.place.name)}</a>
          <small>停留約 ${dur(it.min)}${it.note ? `・${it.note}` : ''}</small></div></li>`;
      }
      if (it.type === 'meal') return `<li class="meal"><span class="time">${hhmm(it.start)}</span><div class="what">${it.label.startsWith('午餐') ? '🍜' : '☕'} ${it.label}</div></li>`;
      return `<li class="move"><span class="time"></span><div class="what">${it.mode}約 ${dur(it.min)}</div></li>`;
    }).join('');
    const link = gmapRoute(from, d.ordered);
    from = d.last;
    return `<article class="card day">
      <div class="day-head">
        <div class="day-badge" style="background:${color}">D${d.index + 1}</div>
        <div><h3>第 ${d.index + 1} 天 ${date}</h3>
          <p>${esc(regions)}・約 ${hhmm(d.end)} 結束${d.over ? '・<span class="over">偏滿</span>' : ''}</p></div>
        <a class="ghost" href="${link}" target="_blank" rel="noopener">Google 路線</a>
      </div>
      <ul class="timeline">${rows}</ul>
    </article>`;
  }).join('');

  drawMap(result);
  if (window.innerWidth < 960) $('#mapWrap').scrollIntoView({ behavior: 'smooth' });
}
$('#plan').addEventListener('click', plan);

renderList();
