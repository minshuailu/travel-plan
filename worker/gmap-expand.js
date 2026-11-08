// Cloudflare Worker：把 Google 地圖短網址（maps.app.goo.gl/...）展開成完整網址
// 網頁本身因為瀏覽器安全限制讀不到轉址結果，所以由這裡代勞。
// 只接受 Google 地圖短網址、只回應自己的網站，避免被別人拿去當萬用代理。
const ALLOWED_ORIGINS = ['https://minshuailu.github.io', 'http://localhost:8765'];

const isShortLink = u => u.protocol === 'https:' &&
  (u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps')));
const isGoogle = u => /(^|\.)google\.[a-z.]+$/.test(u.hostname) || /(^|\.)goo\.gl$/.test(u.hostname);

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const headers = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET',
      'Vary': 'Origin',
      'Content-Type': 'application/json; charset=utf-8',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    if (request.method === 'OPTIONS') return new Response(null, { headers });

    let current;
    try { current = new URL(new URL(request.url).searchParams.get('url') || ''); } catch (e) { return reply({ error: 'bad url' }, 400); }
    if (!isShortLink(current)) return reply({ error: 'only Google Maps short links' }, 400);

    // 跟著轉址走，最多 4 次，而且只走 Google 自己的網址
    for (let i = 0; i < 4; i++) {
      const res = await fetch(current.toString(), { redirect: 'manual' });
      const loc = res.headers.get('Location');
      if (!loc) break;
      const next = new URL(loc, current);
      if (!isGoogle(next)) break;
      current = next;
      if (current.pathname.startsWith('/maps')) break; // 已經是地圖網址就停，再往下會被 Google 當成機器人
    }
    return reply({ url: current.toString() });
  },
};
