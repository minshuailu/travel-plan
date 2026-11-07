// 行程排程邏輯：依距離估算交通時間 → 排出最順的路線 → 平均分到每一天

const PACE = {
  relaxed: { label: '輕鬆', startMin: 9.5 * 60, budget: 7 * 60 },
  normal: { label: '標準', startMin: 9 * 60, budget: 9 * 60 },
  packed: { label: '緊湊', startMin: 8.5 * 60, budget: 11 * 60 },
};

function distanceKm(a, b) {
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 粗估交通時間（分鐘），已含等車、轉乘
function travel(a, b) {
  const d = distanceKm(a, b);
  let min, mode;
  if (d < 1.2) { min = Math.max(5, d * 15); mode = '步行'; }
  else if (d <= 15) { min = 12 + d * 2.4; mode = '電車／巴士'; }
  else if (d <= 150) { min = 48 + (d - 15) * 0.75; mode = d < 40 ? '電車' : '特急／JR'; }
  else {
    min = 149 + (d - 150) * 0.3; mode = '新幹線／特急';
    const fly = 180 + d * 0.1;
    if (d > 600 && fly < min) { min = fly; mode = '飛機'; }
  }
  return { min: Math.round(min / 5) * 5, mode, km: d };
}

const cost = (a, b) => travel(a, b).min;

// 最近鄰居法 + 2-opt，找出一條交通時間短的路線（起點固定）
function bestRoute(places, start) {
  if (places.length <= 1) return places.slice();
  const rest = places.slice();
  let cur = start;
  if (!cur) {
    // 沒有起點：從離中心最遠的景點開始，路線比較不會繞回頭
    const c = {
      lat: rest.reduce((s, p) => s + p.lat, 0) / rest.length,
      lng: rest.reduce((s, p) => s + p.lng, 0) / rest.length,
    };
    rest.sort((a, b) => distanceKm(b, c) - distanceKm(a, c));
    cur = rest.shift();
  }
  const route = start ? [] : [cur];
  while (rest.length) {
    let bi = 0;
    for (let i = 1; i < rest.length; i++) if (cost(cur, rest[i]) < cost(cur, rest[bi])) bi = i;
    cur = rest.splice(bi, 1)[0];
    route.push(cur);
  }

  // 2-opt：反轉一段路線若能縮短總時間就保留
  const path = start ? [start, ...route] : route;
  const fixed = start ? 1 : 0;
  let improved = true, guard = 0;
  while (improved && guard++ < 50) {
    improved = false;
    // 沒有起點時，第一站也可以換（i 從 0 開始）
    for (let i = fixed; i < path.length - 1; i++) {
      for (let k = i + 1; k < path.length; k++) {
        const a = path[i - 1], b = path[i], c = path[k], d = path[k + 1];
        const before = (a ? cost(a, b) : 0) + (d ? cost(c, d) : 0);
        const after = (a ? cost(a, c) : 0) + (d ? cost(b, d) : 0);
        if (after < before - 1) {
          path.splice(i, k - i + 1, ...path.slice(i, k + 1).reverse());
          improved = true;
        }
      }
    }
  }
  return start ? path.slice(1) : path;
}

// 把路線切成 days 段，讓每天的份量盡量平均，並避免超過每日可用時間
function splitDays(route, days, start, budget) {
  const n = route.length;
  if (n === 0) return new Array(days).fill([]);
  const stay = route.map(p => p.hours * 60);
  const step = route.map((p, i) => (i < n - 1 ? cost(p, route[i + 1]) : 0));
  const preStay = [0], preStep = [0];
  for (let i = 0; i < n; i++) {
    preStay.push(preStay[i] + stay[i]);
    preStep.push(preStep[i] + step[i]);
  }
  const arrive = i => (i === 0 ? (start ? cost(start, route[0]) : 0) : step[i - 1]);
  const load = (i, j) => arrive(i) + (preStay[j + 1] - preStay[i]) + (preStep[j] - preStep[i]);
  // 地點少的話不要硬攤到每一天，用不到的天數留給自由活動
  const m = Math.min(n, days, Math.max(1, Math.ceil(load(0, n - 1) / (budget * 0.6))));

  // 每天的「辛苦分數」：時間平方（越平均越好），超時再加重罰
  const pain = (i, j) => {
    const l = load(i, j), over = Math.max(0, l - budget);
    return l * l + over * over * 10;
  };
  // f[d][j]：前 j+1 個景點分成 d+1 天時的總分數
  const f = Array.from({ length: m }, () => new Array(n).fill(Infinity));
  const cut = Array.from({ length: m }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) f[0][j] = pain(0, j);
  for (let d = 1; d < m; d++) {
    for (let j = d; j < n; j++) {
      for (let i = d; i <= j; i++) {
        const v = f[d - 1][i - 1] + pain(i, j);
        if (v < f[d][j]) { f[d][j] = v; cut[d][j] = i; }
      }
    }
  }
  const groups = [];
  let j = n - 1;
  for (let d = m - 1; d >= 0; d--) {
    const i = d === 0 ? 0 : cut[d][j];
    groups.unshift(route.slice(i, j + 1));
    j = i - 1;
  }
  while (groups.length < days) groups.push([]);
  return groups;
}

// 排出每一天的時間表（含交通與午餐）
// 從幾種排列中挑最好的：交通少，且早市排早上、夜景排晚上（不值得為此繞遠路）
function bestOrder(places, from, next) {
  const tagged = [
    ...places.filter(p => p.tag === 'morning'),
    ...places.filter(p => p.tag !== 'morning' && p.tag !== 'night'),
    ...places.filter(p => p.tag === 'night'),
  ];
  const score = list => {
    let s = 0, prev = from;
    list.forEach((p, i) => {
      if (prev) s += cost(prev, p);
      if (p.tag === 'morning' && i > 0) s += 25;
      if (p.tag === 'night' && i < list.length - 1) s += 90;
      prev = p;
    });
    // 也考慮隔天第一站，避免今天結束在離明天很遠的地方
    if (next) s += cost(prev, next);
    return s;
  };
  // 景點不多時直接試遍所有順序
  if (places.length <= 7) {
    let best = places, bestScore = score(places);
    const permute = (done, left) => {
      if (!left.length) {
        const s = score(done);
        if (s < bestScore) { bestScore = s; best = done; }
        return;
      }
      left.forEach((p, i) => permute([...done, p], [...left.slice(0, i), ...left.slice(i + 1)]));
    };
    permute([], places);
    return best;
  }
  const candidates = [places, tagged];
  if (!from) candidates.push(places.slice().reverse(), tagged.slice().reverse());
  return candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
}

function scheduleDay(places, from, pace, next) {
  const ordered = bestOrder(places, from, next);
  const items = [];
  let t = PACE[pace].startMin;
  let prev = from, lunch = false, idle = 0;
  ordered.forEach((p, idx) => {
    if (prev) {
      const tr = travel(prev, p);
      if (tr.min > 0) { items.push({ type: 'move', start: t, min: tr.min, mode: tr.mode, km: tr.km }); t += tr.min; }
    }
    // 當天最後的夜景，太早到就先自由活動，等天黑再去（不算進當天的忙碌時間）
    if (p.tag === 'night' && idx === ordered.length - 1 && t < 17 * 60) {
      items.push({ type: 'meal', start: t, min: 17 * 60 - t, label: '自由時間（吃飯、逛街、回飯店休息）' });
      idle += 17 * 60 - t;
      t = 17 * 60; lunch = true;
    }
    if (!lunch && t >= 11.75 * 60) {
      items.push({ type: 'meal', start: t, min: 60, label: '午餐（附近找吃的）' });
      t += 60; lunch = true;
    }
    items.push({ type: 'visit', start: t, min: p.hours * 60, place: p });
    t += p.hours * 60;
    prev = p;
  });
  if (ordered.length && !lunch && t >= 13 * 60) {
    // 長時間行程（如樂園）在園區內吃
    items.find(i => i.type === 'visit').note = '午餐在園區內解決';
  }
  return { items, end: t, last: prev, load: t - PACE[pace].startMin - idle, ordered };
}

function buildDays(route, days, start, pace) {
  const budget = PACE[pace].budget;
  let from = start;
  const groups = splitDays(route, days, start, budget);
  return groups.map((g, idx) => {
    if (!g.length) return { index: idx, items: [], free: true, ordered: [] };
    const next = groups[idx + 1] && groups[idx + 1][0];
    const day = scheduleDay(g, from, pace, next);
    from = day.last;
    // 只有一個景點（例如樂園）就算很長也不算排太滿
    return { index: idx, ...day, over: g.length > 1 && day.load > budget + 30 };
  });
}

function planTrip({ places, days, startKey, pace }) {
  const start = STARTS[startKey] || null;
  const route = bestRoute(places, start);
  const result = buildDays(route, days, start, pace);
  const overloaded = result.some(d => d.over);
  let suggestDays = days;
  if (overloaded) {
    while (suggestDays < Math.min(21, places.length) &&
      buildDays(route, suggestDays, start, pace).some(d => d.over)) suggestDays++;
  }
  return { days: result, start, suggestDays, overloaded };
}
