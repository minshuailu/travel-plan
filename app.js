const $ = s => document.querySelector(s);
const DAY_COLORS = ['#c8432b', '#2c6fbb', '#2e8b57', '#b8860b', '#8e44ad', '#d35400', '#16a085', '#7f8c8d'];
const dayColor = i => DAY_COLORS[i % DAY_COLORS.length];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;
const dur = m => (m >= 60 ? `${Math.floor(m / 60)} 小時${m % 60 ? ` ${m % 60} 分` : ''}` : `${m} 分`);
const key = p => `${p.name}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;

// ---------- 狀態 ----------
// state 是目前打開的方案；book 存所有方案（存在瀏覽器裡，登入後也同步到雲端）
const TRIP_FIELDS = ['days', 'date', 'start', 'pace', 'places'];
const blankTrip = () => ({ days: 4, date: '', start: 'none', pace: 'normal', places: [] });
const copyTrip = t => JSON.parse(JSON.stringify(Object.fromEntries(TRIP_FIELDS.map(k => [k, t[k]]))));
const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const state = blankTrip();
let book = { plans: [], currentId: null };
try {
  const saved = JSON.parse(localStorage.getItem('jp-trip-book') || 'null');
  if (saved && saved.plans && saved.plans.length) book = saved;
  else {
    // 舊版只有一份行程：轉成第一個方案
    const old = JSON.parse(localStorage.getItem('jp-trip') || 'null');
    if (old) book.plans = [{ id: newId(), name: '', auto: true, trip: copyTrip({ ...blankTrip(), ...old }) }];
  }
} catch (e) { /* 無法讀取就用預設值 */ }
if (!book.plans.length) book.plans = [{ id: newId(), name: '', auto: true, trip: blankTrip() }];
if (!book.plans.some(p => p.id === book.currentId)) book.currentId = book.plans[0].id;
const currentPlan = () => book.plans.find(p => p.id === book.currentId);
Object.assign(state, copyTrip(currentPlan().trip));

// 自動命名：依景點最多的地區，例如「東京-1」、「東京＋京都-1」
function baseName(trip) {
  const count = {};
  trip.places.forEach(p => { count[p.region] = (count[p.region] || 0) + 1; });
  const top = Object.entries(count).sort((a, b) => b[1] - a[1])
    .filter(([, n], i) => i === 0 || n / trip.places.length >= 0.3).slice(0, 2).map(([r]) => r);
  return top.length ? top.join('＋') : '新方案';
}
function autoName(plan) {
  const base = baseName(plan.trip);
  const used = new Set(book.plans.filter(p => p !== plan).map(p => p.name));
  if (plan.name && plan.name.startsWith(base + '-') && !used.has(plan.name)) return plan.name;
  let n = 1;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
book.plans.forEach(p => { if (p.auto || !p.name) { p.auto = true; p.name = autoName(p); } });

function persist() {
  try { localStorage.setItem('jp-trip-book', JSON.stringify(book)); } catch (e) { /* 忽略 */ }
}
let savedTimer = null;
const save = () => {
  if (viewing) return;
  const plan = currentPlan();
  plan.trip = copyTrip(state);
  plan.updatedAt = Date.now();
  if (plan.auto) plan.name = autoName(plan);
  persist();
  renderPlans();
  $('#saveState').textContent = '✓ 已自動儲存';
  $('#saveState').classList.add('flash');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('#saveState').classList.remove('flash'), 1200);
  if (window.onPlanChange) window.onPlanChange(plan); // 登入時同步到雲端（sync.js）
};

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
  state.places.push({ name: p.name, ja: p.ja || '', region: p.region || '其他', lat: p.lat, lng: p.lng, hours: p.hours || 1.5, tag: p.tag || '', area: p.area || '', note: p.note || '', link: p.link || '', gmap: p.gmap || '', approx: !!p.approx });
  save(); renderList(); renderRegionSpots();
}
function removePlace(k) {
  state.places = state.places.filter(p => key(p) !== k);
  save(); renderList(); renderRegionSpots();
}

const HOUR_OPTS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 9];
function renderList() {
  const ul = $('#list');
  ul.innerHTML = state.places.map(p => {
    const k = key(p), open = openNotes.has(k);
    return `
    <li data-k="${esc(k)}">
      <span class="name">${esc(p.name)}<small>${esc(p.region)}${p.approx ? '・位置是大約的' : ''}${p.note ? `・${esc(p.note)}` : ''}</small></span>
      <button type="button" class="note-btn ${p.note || p.link ? 'has' : ''}" aria-label="備註和連結" title="備註和連結">📝</button>
      <select aria-label="停留時間">${HOUR_OPTS.concat(HOUR_OPTS.includes(p.hours) ? [] : [p.hours]).sort((a, b) => a - b)
        .map(h => `<option value="${h}" ${h === p.hours ? 'selected' : ''}>${h} 小時</option>`).join('')}</select>
      <button type="button" class="x" aria-label="移除">×</button>
      <div class="note-edit" ${open ? '' : 'hidden'}>
        <input type="text" data-f="note" placeholder="備註，例如：要預約、營業到 21:00" value="${esc(p.note || '')}">
        <input type="url" data-f="link" placeholder="貼上 IG 或 Google 地圖連結" value="${esc(p.link || '')}">
      </div>
    </li>`;
  }).join('');
  $('#count').textContent = state.places.length ? `${state.places.length} 個` : '';
  $('#listEmpty').hidden = state.places.length > 0;
  $('#plan').disabled = state.places.length === 0;
}
const openNotes = new Set(); // 哪些景點的備註欄是打開的
$('#list').addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  if (e.target.classList.contains('x')) removePlace(li.dataset.k);
  else if (e.target.classList.contains('note-btn')) {
    const k = li.dataset.k;
    if (openNotes.has(k)) openNotes.delete(k); else openNotes.add(k);
    renderList();
    if (openNotes.has(k)) $(`#list li[data-k="${CSS.escape(k)}"] [data-f="note"]`).focus();
  }
});
$('#list').addEventListener('change', e => {
  if (e.target.tagName !== 'SELECT') return;
  const p = state.places.find(x => key(x) === e.target.closest('li').dataset.k);
  if (p) { p.hours = parseFloat(e.target.value); save(); }
});
$('#list').addEventListener('input', e => {
  const f = e.target.dataset.f;
  if (!f) return;
  const p = state.places.find(x => key(x) === e.target.closest('li').dataset.k);
  if (p) { p[f] = e.target.value.trim(); save(); }
});
$('#list').addEventListener('focusout', e => { if (e.target.dataset.f) renderListSoon(); });
let listTimer = null;
const renderListSoon = () => { clearTimeout(listTimer); listTimer = setTimeout(() => { if (!$('#list').contains(document.activeElement)) renderList(); }, 200); };
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
  box.innerHTML = `<p class="hint region-hint">👇 點景點加入清單（再點一次取消）</p>` +
    SPOTS.filter(s => s.region === openRegion).map(s => {
      const added = have.has(key(s));
      return `<button type="button" class="chip ${added ? 'added' : ''}" data-i="${SPOTS.indexOf(s)}">${added ? '✓' : '+'} ${esc(s.name)}</button>`;
    }).join('');
}
function openRegionPanel(r) {
  openRegion = r;
  renderRegionSpots();
  $('#regionSpots').scrollIntoView({ behavior: 'smooth', block: 'center' });
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
// 短網址展開服務（Cloudflare Worker，程式在 worker/gmap-expand.js）；空字串代表還沒設定
const EXPAND_API = 'https://gmap-expand.msla12587.workers.dev/';

// 從 Google 地圖完整網址讀出店名和座標
function parseGmap(text) {
  let url = (text.match(/https?:\/\/\S+/) || [])[0];
  if (!url) return null;
  // Google 的機器人驗證頁：真正的網址在 continue 參數裡
  if (/google\.[^/]+\/sorry\//.test(url)) {
    try { url = new URL(url).searchParams.get('continue') || ''; } catch (e) { return null; }
    if (!url) return null;
  }
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/.test(url)) return { short: url };
  if (!/google\.[^/]+\/maps/.test(url)) return null;
  const nameM = url.match(/\/maps\/place\/([^/@?]+)/);
  const exact = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const view = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const ll = exact || view;
  if (!ll) {
    // iPhone 分享的連結常是 /maps?q=店名+地址 的格式，沒有座標，之後再用地址找位置
    let qs = '';
    try { qs = new URL(url).searchParams.get('q') || ''; } catch (e) { /* 忽略 */ }
    return qs ? { query: qs, gmap: url } : null;
  }
  let name = '';
  try { name = decodeURIComponent(nameM ? nameM[1] : '').replace(/\+/g, ' '); } catch (e) { name = ''; }
  const p = { name: name || '地圖上的地點', lat: +ll[1], lng: +ll[2], hours: 1.5, gmap: url };
  p.region = nearestRegion(p);
  return p;
}

function buildOptions() {
  const text = q.value.trim();
  if (!text) { showOptions([]); return; }
  const g = parseGmap(text);
  if (g && g.short) { expandShort(g.short, text); return; }
  if (!g && looksLikeAddress(text)) { offerAddress(text); return; }
  if (g) { offerGmap(g, text); return; }
  const local = matchLocal(text).map(s => ({
    html: `<span>${esc(s.name)}</span><span class="tag">${esc(s.region)}</span>`,
    pick: () => addPlace(s),
  }));
  // 輸入的是城市名：引導去選當地景點
  const city = CITIES[text.replace(/[市縣県府都]$/, '')];
  if (city) {
    local.unshift({
      html: `<span class="web">📍 ${esc(text)}是城市，點這裡挑「${esc(city)}」的景點</span>`,
      pick: () => openRegionPanel(city),
    });
  }
  local.push({
    html: `<span class="web">🔍 搜尋全日本：「${esc(text)}」</span>`,
    pick: () => searchWeb(text),
    keepOpen: true,
  });
  showOptions(local);
}
// 短網址交給展開服務換成完整網址，再讀出店名和座標
const msgOption = html => ({ html: `<span class="tag">${html}</span>`, pick: () => {}, keepOpen: true });
// 「店名 地址 郵遞區號」→ 先用郵遞區號找到大概區域，再在附近搜尋店名或大樓名稱
// 座標只用來估算交通時間；點店名還是會打開 Google 地圖上準確的那一家
const getJson = async u => (await fetch(u)).json();
// 日本郵遞區號（例如 〒170-0013）→ 那一區的中心點
async function postalCenter(text) {
  const m = text.match(/(\d{3})[-−ー－‐]?(\d{4})/);
  if (!m) return null;
  const r = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=jp&postalcode=${m[1]}-${m[2]}`);
  return r[0] ? { lat: +r[0].lat, lng: +r[0].lon } : null;
}
// 名稱一個一個試，只接受離中心點 1.5 公里內的結果
async function findNear(center, names) {
  for (const t of names) {
    const bias = center ? `&lat=${center.lat}&lon=${center.lng}` : '';
    const r = await getJson(`https://photon.komoot.io/api/?limit=1&q=${encodeURIComponent(t)}${bias}`);
    const f = r.features && r.features[0];
    if (!f) continue;
    const cand = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    if (!center || distanceKm(center, cand) < 1.5) return cand;
  }
  return null;
}

// 「店名 地址 郵遞區號」→ 先用郵遞區號找到大概區域，再在附近搜尋店名或大樓名稱
// 座標只用來估算交通時間；點店名還是會打開 Google 地圖上準確的那一家
async function locateQuery(query, gmap) {
  const tokens = query.split(/[\s+]+/).filter(Boolean);
  const isAddr = t => /^\d|chome|丁目|番地|^\d+F$/i.test(t);
  const cut = tokens.findIndex(isAddr);
  const nameTokens = cut > 0 ? tokens.slice(0, cut) : tokens.slice(0, 3);
  const name = nameTokens.slice(0, 3).join(' ');
  const center = await postalCenter(query);
  const tries = [...new Set([nameTokens.join(' '), ...[...nameTokens].sort((a, b) => b.length - a.length)])]
    .filter(t => t.length >= 2).slice(0, 4);
  const ll = (await findNear(center, tries)) || center;
  if (!ll) return null;
  const p = { name: name || '地圖上的地點', ...ll, hours: 1.5, gmap, approx: true };
  p.region = nearestRegion(p);
  return p;
}

// 從 Google 地圖複製的地址（例如「日本〒170-0013 Tokyo, Toshima City, … 池袋サンシャインシティアルタ 1F」）
const looksLikeAddress = t => /〒|\d{3}[-−ー－‐]\d{4}|chome|丁目/i.test(t) && !/https?:\/\//.test(t);
async function locateAddress(text) {
  const center = await postalCenter(text);
  // 大樓或店名：有中日文字、不含數字的片段，長的先試
  const names = text.replace(/日本|〒/g, ' ').split(/[\s,，、]+/)
    .filter(t => /[\u3040-\u30ff\u4e00-\u9fff]{2,}/.test(t) && !/\d/.test(t))
    .sort((a, b) => b.length - a.length).slice(0, 3);
  const ll = (await findNear(center, names)) || center;
  if (!ll) return null;
  const p = { name: names[0] || text.replace(/^日本\s*/, '').slice(0, 20), ...ll, hours: 1.5, approx: true, note: text };
  p.region = nearestRegion(p);
  return p;
}
async function offerAddress(text) {
  showOptions([msgOption('用地址找位置中…')]);
  await new Promise(r => setTimeout(r, 500)); // 還在打字就先不查
  if (q.value.trim() !== text) return;
  let p = null;
  try { p = await locateAddress(text); } catch (e) { /* 下面處理 */ }
  if (q.value.trim() !== text) return;
  if (!p) { showOptions([msgOption('找不到這個地址。可以改貼 Google 地圖網址，或用「在地圖上點選位置」')]); return; }
  showOptions([{
    html: `<span class="web">📍 用這個地址加入（位置是大約的）</span><span class="tag">${esc(p.region)}</span>`,
    pick: () => {
      const name = prompt('這個地點叫什麼名字？', p.name);
      if (name === null) return;
      p.name = name.trim() || p.name;
      addPlace(p);
      toast(`已加入「${p.name}」，地址存在備註裡`);
    },
  }]);
}

async function expandShort(short, typed) {
  const fail = '讀不到這個短網址的位置。請先用 Safari 打開它，再複製網址列的完整網址貼上';
  if (!EXPAND_API) { showOptions([msgOption(fail)]); return; }
  showOptions([msgOption('讀取 Google 地圖連結中…')]);
  try {
    const res = await fetch(`${EXPAND_API}?url=${encodeURIComponent(short)}`);
    const g = parseGmap((await res.json()).url || '');
    if (q.value.trim() !== typed) return; // 讀取時已經改打別的了
    if (!g || g.short) { showOptions([msgOption(fail)]); return; }
    offerGmap(g, typed);
  } catch (e) {
    showOptions([msgOption('讀取失敗，請檢查網路後再試')]);
  }
}
// 顯示「加入」選項；沒有座標的連結先用地址找位置
async function offerGmap(g, typed) {
  if (g.query) {
    showOptions([msgOption('找這個地點的位置中…')]);
    try { g = await locateQuery(g.query, g.gmap); } catch (e) { g = null; }
    if (q.value.trim() !== typed) return;
    if (!g) { showOptions([msgOption('找不到這個地點的位置。可以改用店名搜尋，或用「在地圖上點選位置」')]); return; }
  }
  showOptions([{ html: `<span class="web">📍 加入「${esc(g.name)}」（Google 地圖）</span><span class="tag">${esc(g.region)}</span>`, pick: () => addPlace(g) }]);
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
const AREA_TYPES = new Set(['city', 'town', 'village', 'hamlet', 'quarter', 'suburb', 'neighbourhood',
  'locality', 'municipality', 'county', 'state', 'province', 'region', 'administrative', 'stop', 'station']);
function nearestRegion(p) {
  let best = null, bd = Infinity;
  for (const s of SPOTS) { const d = distanceKm(p, s); if (d < bd) { bd = d; best = s; } }
  return bd < 40 ? best.region : '其他';
}
async function searchWeb(text) {
  clearTimeout(webTimer);
  showOptions([{ html: '<span class="tag">搜尋中…</span>', pick: () => {}, keepOpen: true }]);
  try {
    const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=jp&limit=10&accept-language=zh-TW,ja&q=' + encodeURIComponent(text);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    // 排除地名（同名的町、村、車站很多，例如「福岡」會先找到富山縣的福岡站）
    const data = (await res.json()).filter(r => !AREA_TYPES.has(r.type) && r.category !== 'boundary' && r.category !== 'railway' && r.category !== 'public_transport');
    if (!data.length) {
      showOptions([{ html: '<span class="tag">找不到具體景點。請輸入景點名稱（例如「太宰府」），城市請用上方地區按鈕挑選</span>', pick: () => {}, keepOpen: true }]);
      return;
    }
    showOptions(data.slice(0, 6).map(r => {
      const a = r.address || {};
      const area = [a.province || a.state, a.city || a.town || a.village || a.county].filter(Boolean).join('・');
      const p = { name: r.name || r.display_name.split(',')[0], ja: '', lat: +r.lat, lng: +r.lon, hours: 1.5, area };
      p.region = nearestRegion(p);
      if (p.region === '其他' && area) p.region = area;
      return { html: `<span>${esc(p.name)}</span><span class="tag">${esc(area || '日本')}</span>`, pick: () => addPlace(p) };
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
  map.setView([36.2, 138.2], 5);
  map.on('click', onMapPick);
}

// 在地圖上點選位置加入景點
let picking = false;
function setPicking(on) {
  picking = on;
  $('#mapWrap').classList.toggle('picking', on);
  $('#pickBtn').textContent = on ? '✕ 取消點選' : '📍 在地圖上點選位置';
}
function onMapPick(e) {
  if (!picking) return;
  setPicking(false);
  const name = prompt('這個地點叫什麼名字？');
  if (!name || !name.trim()) return;
  const p = { name: name.trim(), lat: e.latlng.lat, lng: e.latlng.lng, hours: 1.5 };
  p.region = nearestRegion(p);
  addPlace(p);
  toast(`已加入「${p.name}」`);
}
$('#pickBtn').addEventListener('click', () => {
  if (picking) { setPicking(false); return; }
  $('#placeholder').hidden = true;
  ensureMap();
  setPicking(true);
  $('#mapWrap').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast('移動、放大地圖，點一下想加入的位置');
});
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
// 景點名稱連到 Google 地圖；有存 IG 等其他連結就多一個 🔗
const isGmap = u => /google\.[^/]+\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/.test(u);
const safeUrl = u => (/^https?:\/\//.test(u) ? u : '');
function visitLinks(p) {
  const link = safeUrl(p.link || '');
  const main = safeUrl(p.gmap || '') || (link && isGmap(link) ? link : gmapPlace(p));
  const extra = link && !isGmap(link) ? ` <a class="extra-link" href="${esc(link)}" target="_blank" rel="noopener">🔗 ${/instagram\.com/.test(link) ? 'IG' : '連結'}</a>` : '';
  return `<a href="${esc(main)}" target="_blank" rel="noopener">${esc(p.name)}</a>${extra}`;
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

// 防呆：找出離其他景點特別遠的地點，以及離景點很遠的出發機場
function sanityWarnings() {
  const ps = state.places, out = [];
  if (ps.length > 1) {
    const far = ps.filter(p => Math.min(...ps.filter(o => o !== p).map(o => distanceKm(p, o))) > 250);
    // 全部都互相很遠（例如東京＋福岡＋札幌）就不提醒，只提醒少數離群的
    if (far.length && far.length <= Math.max(1, Math.floor(ps.length / 3))) {
      out.push(`<div class="warn">⚠️ ${far.map(p => `「${esc(p.name)}」${p.area ? `（${esc(p.area)}）` : ''}`).join('、')}離其他景點超過 250 公里，交通會花很久。如果找錯地方，請從清單刪掉再重新搜尋。</div>`);
    }
  }
  const start = STARTS[state.start];
  if (start && ps.length) {
    const near = Math.min(...ps.map(p => distanceKm(start, p)));
    if (near > 300) {
      const [bestKey, best] = Object.entries(STARTS).filter(([, v]) => v)
        .reduce((a, b) => (Math.min(...ps.map(p => distanceKm(b[1], p))) < Math.min(...ps.map(p => distanceKm(a[1], p))) ? b : a));
      out.push(`<div class="warn">✈️ 出發的${esc(start.name)}離景點很遠。<button type="button" class="ghost" data-start="${bestKey}">改成${esc(best.name)}</button></div>`);
    }
  }
  return out.join('');
}
$('#summary').addEventListener('click', e => {
  const k = e.target.dataset.start;
  if (!k) return;
  state.start = k; $('#start').value = k; save(); plan();
});

let shown = false;
let viewing = null; // 正在看別人分享的行程時：{ name, trip }
let lastResult = null;
const planTitle = () => (viewing ? viewing.name : currentPlan().name);
function replanIfShown() { if (shown && state.places.length) plan(); }

function plan(opts) {
  if (!state.places.length) return;
  const result = planTrip({ places: state.places, days: state.days, startKey: state.start, pace: state.pace });
  shown = true;
  $('#placeholder').hidden = true;

  const warn = !result.overloaded ? ''
    : result.suggestDays > state.days
      ? `<div class="warn">有幾天排得比較滿。照「${PACE[state.pace].label}」步調，建議排 <b>${result.suggestDays} 天</b>，或刪掉幾個地點。</div>`
      : `<div class="warn">有幾天排得比較滿，建議刪掉幾個地點，或把步調改成「緊湊」。</div>`;
  lastResult = result;
  $('#summary').innerHTML = `
    ${viewing ? '' : sanityWarnings()}
    ${warn}
    <div class="summary">
      <span><b>${esc(planTitle())}</b>・${state.days} 天・${state.places.length} 個地點・${PACE[state.pace].label}步調</span>
      <div class="actions">
        <button type="button" class="ghost" id="shareText">📤 分享行程</button>
        ${viewing ? '' : '<button type="button" class="ghost" id="shareLink">🔗 分享連結</button>'}
        <button type="button" class="ghost" id="print">列印／PDF</button>
      </div>
    </div>`;
  $('#print').addEventListener('click', () => window.print());
  $('#shareText').addEventListener('click', shareText);
  if (!viewing) $('#shareLink').addEventListener('click', shareLink);

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
          <div class="what">${visitLinks(it.place)}
          <small>停留約 ${dur(it.min)}${it.note ? `・${it.note}` : ''}${it.place.note ? `・📝 ${esc(it.place.note)}` : ''}</small></div></li>`;
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
  if (!(opts && opts.quiet) && window.innerWidth < 960) $('#mapWrap').scrollIntoView({ behavior: 'smooth' });
}
$('#plan').addEventListener('click', () => plan());

// ---------- 我的方案 ----------
// 把目前方案載入畫面
function fillInputs() {
  $('#start').value = state.start;
  $('#days').value = state.days;
  $('#date').value = state.date;
  paintPace(); renderList(); renderRegionSpots();
}
function loadCurrent() {
  if (viewing) { renderPlans(); return; } // 正在看別人分享的行程，先不換畫面
  Object.assign(state, copyTrip(currentPlan().trip));
  fillInputs(); renderPlans();
  if (shown && state.places.length) plan({ quiet: true });
  else if (!state.places.length) clearResult();
}
function clearResult() {
  shown = false;
  $('#summary').innerHTML = ''; $('#daysOut').innerHTML = '';
  $('#mapWrap').hidden = true; $('#placeholder').hidden = false;
}
function renderPlans() {
  const plan = currentPlan();
  $('#planSel').innerHTML = book.plans.map(p =>
    `<option value="${p.id}" ${p.id === plan.id ? 'selected' : ''}>${esc(p.name)}（${p.trip.places.length} 個地點）</option>`).join('');
  const input = $('#planName');
  if (document.activeElement !== input) input.value = plan.auto ? '' : plan.name;
  input.placeholder = plan.auto ? `自動命名：${plan.name}` : '方案名稱';
  $('#planDel').hidden = book.plans.length < 2;
}
function switchPlan(id) {
  book.currentId = id; persist(); loadCurrent();
}
$('#planSel').addEventListener('change', e => switchPlan(e.target.value));
$('#planNew').addEventListener('click', () => {
  const p = { id: newId(), name: '', auto: true, trip: blankTrip(), updatedAt: Date.now() };
  book.plans.push(p);
  p.name = autoName(p);
  switchPlan(p.id);
  save();
});
$('#planCopy').addEventListener('click', () => {
  const src = currentPlan();
  const p = { id: newId(), name: src.auto ? '' : `${src.name}（複本）`, auto: src.auto, trip: copyTrip(state), updatedAt: Date.now() };
  book.plans.push(p);
  if (p.auto) p.name = autoName(p);
  switchPlan(p.id);
  save();
});
$('#planDel').addEventListener('click', () => {
  const p = currentPlan();
  if (book.plans.length < 2 || !confirm(`確定要刪除「${p.name}」嗎？刪除後無法復原。`)) return;
  book.plans = book.plans.filter(x => x.id !== p.id);
  if (window.onPlanDelete) window.onPlanDelete(p);
  switchPlan(book.plans[0].id);
});
$('#planName').addEventListener('input', e => {
  const plan = currentPlan(), v = e.target.value.trim();
  plan.auto = !v;
  plan.name = v || autoName(plan);
  save();
});
$('#planName').addEventListener('blur', renderPlans);

// 給雲端同步用（sync.js 會呼叫）
// 雲端上每個方案是一筆獨立資料，所以兩台裝置不會互相把對方的方案蓋掉。
// synced = 這個方案雲端上有，之後雲端沒有了就代表在別台被刪掉。
const samePlaces = (a, b) => JSON.stringify(a.trip.places) === JSON.stringify(b.trip.places);
window.tripApp = {
  plans: () => book.plans,
  markSynced(plan) { plan.synced = true; persist(); },
  // 收到雲端的方案清單，合併進來；回傳這台才有、需要上傳的方案
  applyRemote(remote, initial) {
    const byId = new Map(remote.map(p => [p.id, p]));
    const next = [], upload = [];
    for (const p of book.plans) {
      const r = byId.get(p.id);
      if (r && (p.updatedAt || 0) > (r.updatedAt || 0)) { next.push(p); upload.push(p); byId.delete(p.id); } // 這台比較新
      else if (r) { next.push({ ...r, synced: true }); byId.delete(p.id); }
      else if (p.synced) { /* 別台刪掉了 */ }
      else if (!p.trip.places.length && !p.updatedAt) { /* 系統自動開的空白方案，不上傳 */ }
      else if (initial && (!p.trip.places.length || remote.some(x => samePlaces(x, p)))) { /* 空白或重複的就不上傳 */ }
      else { next.push(p); upload.push(p); }
    }
    byId.forEach(r => next.push({ ...r, synced: true }));
    if (!next.length) next.push({ id: newId(), name: '', auto: true, trip: blankTrip() });
    const before = JSON.stringify(currentPlan() && currentPlan().trip);
    book.plans = next;
    next.forEach(p => { if (!p.name) { p.auto = true; p.name = autoName(p); } });
    if (!book.plans.some(p => p.id === book.currentId)) book.currentId = book.plans[0].id;
    persist();
    if (JSON.stringify(currentPlan().trip) !== before) loadCurrent(); else renderPlans();
    return upload;
  },
  // 舊版的雲端資料（整份存在一起）轉成方案
  legacyPlans(data) {
    if (!data) return [];
    if (data.plans) return data.plans.filter(p => p.trip && p.trip.places.length);
    if (data.trip && data.trip.places && data.trip.places.length) return [{ id: newId(), name: '', auto: true, trip: copyTrip({ ...blankTrip(), ...data.trip }) }];
    return [];
  },
};

// ---------- 分享 ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2500);
}
// 手機跳出分享選單（LINE、訊息…）；電腦不支援就複製到剪貼簿
async function shareOut(title, text) {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('已複製，貼到 LINE 或訊息就可以了'); }
  catch (e) { prompt('複製下面的內容：', text); }
}

function tripText() {
  const r = lastResult, lines = [`🇯🇵 ${planTitle()}（${state.days} 天）`];
  if (r.start) lines.push(`✈️ 從${r.start.name}出發`);
  r.days.forEach(d => {
    lines.push('', `【第 ${d.index + 1} 天${dayLabel(d.index) ? ' ' + dayLabel(d.index) : ''}】`);
    if (d.free) { lines.push('自由活動'); return; }
    d.items.forEach(it => {
      if (it.type === 'visit') {
        lines.push(`${hhmm(it.start)} ${it.place.name}（${dur(it.min)}）`);
        if (it.place.note) lines.push(`　📝 ${it.place.note}`);
      }
      else if (it.type === 'meal') lines.push(`${hhmm(it.start)} ${it.label.startsWith('午餐') ? '🍜' : '☕'} ${it.label}`);
      else lines.push(`　↓ ${it.mode} 約 ${dur(it.min)}`);
    });
  });
  return lines.join('\n');
}
function shareText() { if (lastResult) shareOut(planTitle(), tripText()); }

// 分享連結：把行程壓縮後放在網址 # 後面（不會傳到任何伺服器）
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function encodeTrip() {
  // 內建景點只存名稱，自己搜尋的才存座標，連結比較短
  const places = state.places.map(p => {
    const s = SPOTS.find(x => key(x) === key(p));
    const extra = p.note || p.link ? [p.note || '', p.link || ''] : [];
    if (s) return s.hours === p.hours && !extra.length ? s.name : [s.name, p.hours, ...extra];
    return [p.name, p.hours, +p.lat.toFixed(5), +p.lng.toFixed(5), p.region, p.area || '', p.tag || '', ...extra];
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ n: planTitle(), d: state.days, t: state.date, s: state.start, p: state.pace, l: places }));
  if (window.CompressionStream) return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw')));
  return 'j' + b64url(bytes);
}
async function decodeTrip(code) {
  let bytes = unb64url(code.slice(1));
  if (code[0] === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const o = JSON.parse(new TextDecoder().decode(bytes));
  const places = o.l.map(x => {
    if (typeof x === 'string') return { ...SPOTS.find(s => s.name === x), note: '', link: '' };
    if (x.length === 2 || x.length === 4) return { ...SPOTS.find(s => s.name === x[0]), hours: x[1], note: x[2] || '', link: x[3] || '' };
    return { name: x[0], hours: x[1], lat: x[2], lng: x[3], region: x[4], area: x[5], tag: x[6], note: x[7] || '', link: x[8] || '', ja: '' };
  }).filter(p => p.name);
  return { name: o.n || '分享的行程', trip: { ...blankTrip(), days: o.d, date: o.t || '', start: o.s || 'none', pace: o.p || 'normal', places } };
}
async function shareLink() {
  const url = `${location.origin}${location.pathname}#s=${await encodeTrip()}`;
  shareOut(planTitle(), `🇯🇵 ${planTitle()}（${state.days} 天）\n點開看完整行程和地圖：\n${url}`);
}

// 打開別人分享的連結：只看不改，可以加入自己的方案
async function openShared() {
  const m = location.hash.match(/^#s=(.+)$/);
  if (!m) return;
  try { viewing = await decodeTrip(m[1]); } catch (e) { toast('分享連結壞掉了，打不開'); return; }
  Object.assign(state, copyTrip(viewing.trip));
  document.body.classList.add('viewing');
  $('#viewBanner').hidden = false;
  $('#viewName').textContent = viewing.name;
  fillInputs();
  plan({ quiet: true });
}
function exitView() {
  viewing = null;
  document.body.classList.remove('viewing');
  $('#viewBanner').hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
}
$('#viewAdd').addEventListener('click', () => {
  const names = new Set(book.plans.map(p => p.name));
  let name = viewing.name, n = 2;
  while (names.has(name)) name = `${viewing.name}（${n++}）`;
  const p = { id: newId(), name, auto: false, trip: copyTrip(viewing.trip), updatedAt: Date.now() };
  exitView();
  book.plans.push(p);
  switchPlan(p.id);
  save();
  toast(`已加入「${name}」，可以自己修改了`);
});
$('#viewClose').addEventListener('click', () => { exitView(); loadCurrent(); });
openShared();

renderList();
renderPlans();
