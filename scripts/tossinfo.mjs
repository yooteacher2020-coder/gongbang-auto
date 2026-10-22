// 토스 쉐어링크(toss.im/_m/… 또는 toss.shopping/t/…)로 토스쇼핑 상품 페이지를 열어 상품명·대표 사진을 가져와
// tossinfo/<요청번호>.json 에 저장. 쇼츠공방 앱의 "붙여넣기 → 바로 완성"이 GitHub Actions(tossinfo.yml)로 요청함.
// 쿠팡과 달리 API 키가 필요 없음 (토스쇼핑 상품 페이지의 공개 정보 og:title / og:image 사용).
import fs from 'node:fs';

const RAW = String(process.env.TOSS_URL || '').trim().slice(0, 500);
const REQ = String(process.env.TOSS_REQ || '').replace(/[^\w-]/g, '').slice(0, 40) || 'r' + Date.now();
const DIR = 'tossinfo', KEEP = 20;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ALLOW = /^https:\/\/((www\.)?toss\.im|(www\.)?toss\.shopping|shopping\.toss\.im|[\w-]+\.toss\.im)\//i;

const meta = (h, p) => { const m = h.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, 'i')) || h.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${p}["']`, 'i')); return m ? decode(m[1]).trim() : ''; };
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function page(u) {
  const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Accept: 'text/html' } });
  return { url: r.url || u, status: r.status, html: r.ok ? await r.text() : '' };
}

async function run() {
  const m = RAW.match(/https?:\/\/\S+/); if (!m) throw new Error('주소가 비어 있어요');
  let u = m[0].replace(/^http:/, 'https:');
  if (!ALLOW.test(u)) throw new Error('토스 쉐어링크 주소가 아니에요');
  let p = await page(u);
  // 짧은 링크가 중간 페이지(앱 열기 등)를 보여주면, 그 안에서 토스쇼핑 상품 주소를 찾아 한 번 더 연다
  if (!/toss\.shopping\/t\/\d+/.test(p.url)) {
    const inner = (p.html.match(/https?:(?:\\?\/){2}(?:www\.)?toss\.shopping(?:\\?\/)t(?:\\?\/)\d+/) || [])[0];
    if (inner) p = await page(inner.replace(/\\\//g, '/'));
  }
  const tracked = /toss\.im\/_m\//.test(u) || /referrer=affiliate/.test(p.url) || /referrer=affiliate/.test(u);
  const productId = (p.url.match(/toss\.shopping\/t\/(\d+)/) || [])[1] || null;
  const name = (meta(p.html, 'og:title') || (p.html.match(/<title>([^<]+)<\/title>/i) || [])[1] || '').replace(/\s*[|\-–]\s*토스(쇼핑)?\s*$/, '').trim();
  const image = meta(p.html, 'og:image');
  if (!name && !image) throw new Error(`상품 페이지에서 정보를 못 읽었어요 (HTTP ${p.status})`);
  let img = null;
  if (image) {
    try {
      const r = await fetch(image, { headers: { 'User-Agent': UA } });
      const b = Buffer.from(await r.arrayBuffer());
      if (r.ok && b.length < 1.5e6) img = `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${b.toString('base64')}`;
    } catch {}
  }
  return { name: /^토스(쇼핑)?$/.test(name) ? '' : name, image, img, productId, finalUrl: p.url, tracked };
}

let res;
try { res = { ok: true, ...(await run()) }; } catch (e) { res = { ok: false, error: String(e.message || e).slice(0, 200) }; }
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(`${DIR}/${REQ}.json`, JSON.stringify({ req: REQ, url: RAW, at: new Date().toISOString(), ...res }));
// 오래된 결과 정리
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => ({ f, t: fs.statSync(`${DIR}/${f}`).mtimeMs })).sort((a, b) => b.t - a.t);
files.slice(KEEP).forEach(({ f }) => fs.unlinkSync(`${DIR}/${f}`));
console.log(res.ok ? `완료: ${res.name || '(이름 없음)'} · 사진 ${res.img ? '있음' : '없음'}` : `실패: ${res.error}`);
