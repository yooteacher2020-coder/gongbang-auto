// "내가 고른 상품" 찾기: 앱이 보낸 상품 이름(또는 쿠팡 주소)으로 쿠팡 파트너스 API 검색 → lookup.json 에 결과 저장.
// GitHub Actions(.github/workflows/lookup.yml)가 앱의 요청(repository_dispatch: lookup)마다 실행. 열쇠는 picks 와 같은 Secrets.
import crypto from 'node:crypto';
import fs from 'node:fs';

const AK = (process.env.COUPANG_ACCESS_KEY || '').trim();
const SK = (process.env.COUPANG_SECRET_KEY || '').trim();
const HOST = 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';
const OUT = 'lookup.json', KEEP = 30;
const Q = String(process.env.LOOKUP_Q || '').trim().slice(0, 300);
const REQ = String(process.env.LOOKUP_REQ || '').replace(/[^\w-]/g, '').slice(0, 40) || String(Date.now());

function auth(method, pathWithQuery) {
  const [path, query = ''] = pathWithQuery.split('?');
  const d = new Date().toISOString();
  const signed = d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + 'T' + d.slice(11, 13) + d.slice(14, 16) + d.slice(17, 19) + 'Z';
  const sig = crypto.createHmac('sha256', SK).update(signed + method + path + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${AK}, signed-date=${signed}, signature=${sig}`;
}
async function api(method, pathWithQuery, body) {
  const r = await fetch(HOST + pathWithQuery, { method, headers: { Authorization: auth(method, pathWithQuery), 'Content-Type': 'application/json;charset=UTF-8' }, body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch { j = { rCode: String(r.status), rMessage: txt.slice(0, 200) }; }
  if (r.ok && String(j.rCode) === '0') return j.data;
  throw new Error(`HTTP ${r.status} ${j.rCode || ''} ${j.rMessage || j.message || ''}`.trim());
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
// 단축 링크(link.coupang.com/a/…, coupa.ng)를 따라가서 상품번호 찾기
async function resolveId(url) {
  let u = url;
  for (let i = 0; i < 4; i++) {
    const m = u.match(/\/vp\/products\/(\d+)/) || u.match(/[?&]pageKey=(\d+)/);
    if (m) return { id: m[1], url: u };
    try { const r = await fetch(u, { redirect: 'manual', headers: { 'User-Agent': UA } }); const loc = r.headers.get('location'); if (!loc) break; u = new URL(loc, u).href; } catch { break; }
  }
  return { id: null, url: u };
}
// 상품 페이지 제목 (쿠팡이 막으면 null)
async function pageTitle(id) {
  try {
    const r = await fetch(`https://www.coupang.com/vp/products/${id}`, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9', Accept: 'text/html' } });
    if (!r.ok) return null; const h = await r.text();
    const m = h.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/) || h.match(/<title>([^<]+)<\/title>/);
    const t = m ? m[1].replace(/\s*[-|:]\s*쿠팡!?.*$/, '').trim() : '';
    return t && !/access denied|coupang$/i.test(t) ? t : null;
  } catch { return null; }
}
const shortKw = n => String(n || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/[,/]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
const map = (p, why) => ({ id: String(p.productId), name: p.productName, price: +p.productPrice || 0, image: p.productImage, link: p.productUrl,
  cat: p.categoryName || '내가 찾은 상품', rocket: !!p.isRocket, free: !!p.isFreeShipping, rank: +p.rank || 99, why });

async function run() {
  if (!AK || !SK) throw new Error('쿠팡 API 열쇠가 GitHub Secrets 에 없어요');
  if (!Q) throw new Error('찾을 상품 이름이나 주소가 비어 있어요');
  const isUrl = /^https?:\/\//i.test(Q);
  let kw = Q, wantId = null, deeplink = null, note = '';
  if (isUrl) {
    if (!/coupang\.com|coupa\.ng/i.test(Q)) throw new Error('쿠팡 주소가 아니에요');
    const r = await resolveId(Q); wantId = r.id;
    if (/\/vp\/products\//.test(r.url)) { try { const d = await api('POST', `${BASE}/deeplink`, { coupangUrls: [r.url.split('#')[0]] }); deeplink = d?.[0]?.shortenUrl || null; } catch (e) { note = '파트너스 링크 만들기 실패: ' + e.message; } }
    const t = wantId ? await pageTitle(wantId) : null;
    if (!t) return { items: [], wantId, deeplink, needName: true, note: note || '주소만으로는 상품 이름을 못 읽었어요. 상품 이름을 적어 다시 찾아주세요' };
    kw = shortKw(t);
  }
  const data = await api('GET', `${BASE}/products/search?keyword=${encodeURIComponent(kw.slice(0, 50))}&limit=10`);
  let items = (data?.productData || []).map(p => map(p, ['검색 결과']));
  if (wantId) { const i = items.findIndex(x => x.id === wantId); if (i >= 0) { const [x] = items.splice(i, 1); x.why = ['붙여넣은 바로 그 상품']; if (deeplink) x.link = deeplink; items.unshift(x); } }
  return { items, wantId, deeplink, kw, note };
}

const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return { reqs: {} }; } })();
let res;
try { res = { ok: true, ...(await run()) }; } catch (e) { res = { ok: false, error: String(e.message || e).slice(0, 200), items: [] }; }
const reqs = { ...(prev.reqs || {}), [REQ]: { q: Q, at: new Date().toISOString(), ...res } };
const keep = Object.entries(reqs).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, KEEP);
fs.writeFileSync(OUT, JSON.stringify({ reqs: Object.fromEntries(keep) }, null, 1));
console.log(res.ok ? `완료: ${res.items.length}개` : `실패: ${res.error}`);
