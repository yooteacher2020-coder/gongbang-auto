// 쿠팡 파트너스 Open API로 카테고리 베스트·골드박스를 가져와 "쇼츠에 잘 팔릴 상품" 점수를 매겨 picks.json 으로 저장.
// GitHub Actions(.github/workflows/picks.yml)가 매일 아침 실행. 열쇠는 저장소 Secrets 의 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY.
import crypto from 'node:crypto';
import fs from 'node:fs';

const AK = (process.env.COUPANG_ACCESS_KEY || '').trim();
const SK = (process.env.COUPANG_SECRET_KEY || '').trim();
const HOST = process.env.COUPANG_HOST || 'https://api-gateway.coupang.com';
const BASE = '/v2/providers/affiliate_open_api/apis/openapi/v1';
const OUT = 'picks.json', HIST = 'picks-history.json';
const KEEP_DAYS = 3; // "3일간 베스트" 기준

// 쇼츠로 보여주기 좋은 카테고리 위주. fit: 쇼츠 적합도 가산점
const CATS = [
  { id: 1013, name: '주방용품', fit: 12 },
  { id: 1014, name: '생활용품', fit: 12 },
  { id: 1015, name: '홈인테리어', fit: 10 },
  { id: 1010, name: '뷰티', fit: 8 },
  { id: 1016, name: '가전디지털', fit: 6 },
  { id: 1024, name: '헬스/건강식품', fit: 6 },
  { id: 1018, name: '자동차용품', fit: 8 },
  { id: 1029, name: '반려동물용품', fit: 8 },
  { id: 1017, name: '스포츠/레저', fit: 5 },
  { id: 1011, name: '출산/유아동', fit: 5 },
  { id: 1021, name: '문구/오피스', fit: 4 },
  { id: 1012, name: '식품', fit: 0 },
];

function auth(method, pathWithQuery) {
  const [path, query = ''] = pathWithQuery.split('?');
  const d = new Date().toISOString(); // 2026-10-13T07:00:00.000Z
  const signed = d.slice(2, 4) + d.slice(5, 7) + d.slice(8, 10) + 'T' + d.slice(11, 13) + d.slice(14, 16) + d.slice(17, 19) + 'Z';
  const sig = crypto.createHmac('sha256', SK).update(signed + method + path + query).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${AK}, signed-date=${signed}, signature=${sig}`;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function call(pathWithQuery) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(HOST + pathWithQuery, { headers: { Authorization: auth('GET', pathWithQuery), 'Content-Type': 'application/json;charset=UTF-8' } });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { rCode: String(r.status), rMessage: txt.slice(0, 200) }; }
    if (r.ok && String(j.rCode) === '0') return Array.isArray(j.data) ? j.data : (j.data?.productData || []);
    if (r.status === 429 && t < 2) { await sleep(20000); continue; }
    const e = new Error(`HTTP ${r.status} ${j.rCode || ''} ${j.rMessage || j.message || ''}`.trim()); e.status = r.status; throw e;
  }
  return [];
}

const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const hist = read(HIST, { days: {} });
const prev = read(OUT, {});

function writeError(msg) {
  const out = { ...prev, ok: false, error: msg, tried: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.error('실패:', msg);
}

if (!AK || !SK) { writeError('쿠팡 API 열쇠가 GitHub Secrets 에 없어요 (COUPANG_ACCESS_KEY, COUPANG_SECRET_KEY)'); process.exit(0); }

const todays = {}; // productId -> 오늘 정보
const errors = [];
for (const c of CATS) {
  try {
    const list = await call(`${BASE}/products/bestcategories/${c.id}?limit=50`);
    list.forEach((p, i) => {
      const id = String(p.productId);
      const rank = +p.rank || i + 1;
      const o = todays[id];
      if (!o || rank < o.rank) todays[id] = { id, name: p.productName, price: +p.productPrice || 0, image: p.productImage, link: p.productUrl,
        cat: c.name, catId: c.id, fit: c.fit, rank, rocket: !!p.isRocket, free: !!p.isFreeShipping, goldbox: o?.goldbox || false, discount: o?.discount || 0 };
    });
    console.log(`${c.name}: ${list.length}개`);
  } catch (e) { errors.push(`${c.name}: ${e.message}`); console.warn(c.name, e.message); if (e.status === 401 || e.status === 403) break; }
  await sleep(1500);
}
try {
  const gb = await call(`${BASE}/products/goldbox`);
  gb.forEach(p => {
    const id = String(p.productId);
    const base = todays[id] || { id, name: p.productName, price: +p.productPrice || 0, image: p.productImage, link: p.productUrl,
      cat: p.categoryName || '오늘의 특가', catId: 0, fit: 4, rank: 99, rocket: !!p.isRocket, free: !!p.isFreeShipping };
    todays[id] = { ...base, goldbox: true, discount: +p.discountRate || 0 };
  });
  console.log(`골드박스: ${gb.length}개`);
} catch (e) { errors.push(`골드박스: ${e.message}`); console.warn('goldbox', e.message); }

const n = Object.keys(todays).length;
if (!n) { writeError('쿠팡에서 상품을 하나도 못 가져왔어요 · ' + errors.slice(0, 3).join(' / ')); process.exit(0); }

// 기록: 날짜별 {id: rank}
hist.days[today] = Object.fromEntries(Object.values(todays).map(p => [p.id, p.rank]));
const dates = Object.keys(hist.days).sort().slice(-KEEP_DAYS);
hist.days = Object.fromEntries(dates.map(d => [d, hist.days[d]]));

function score(p) {
  const days = dates.filter(d => hist.days[d][p.id] != null).length;
  const ranks = dates.map(d => hist.days[d][p.id]).filter(r => r != null && r < 99);
  const best = ranks.length ? Math.min(...ranks) : 99;
  const why = [];
  let s = 0;
  s += days * 18; if (days >= 3) why.push('3일 연속 베스트'); else if (days === 2) why.push('2일 연속 베스트');
  if (best <= 50) { s += Math.round((51 - best) / 50 * 25); if (best <= 10) why.push(`카테고리 ${best}위`); }
  const pr = p.price;
  if (pr >= 10000 && pr <= 50000) { s += 20; why.push('충동구매 가격대'); }
  else if (pr >= 5000 && pr < 10000) s += 12;
  else if (pr > 50000 && pr <= 100000) s += 8;
  else if (pr > 300000) { s -= 35; why.push('고가 · 쇼츠로는 어려움'); }
  else if (pr > 150000) s -= 15;
  if (p.rocket) { s += 5; why.push('로켓배송'); }
  if (p.goldbox) { s += 8; why.push(p.discount ? `오늘 특가 ${p.discount}%` : '오늘 특가'); }
  s += p.fit || 0;
  return { ...p, days, best, score: Math.max(0, Math.min(100, s)), why };
}
const items = Object.values(todays).map(score).sort((a, b) => b.score - a.score || a.best - b.best);
const out = {
  ok: true, updated: new Date().toISOString(), date: today, total: n, errors,
  cats: [...new Set(items.map(p => p.cat))],
  items: items.slice(0, 150).map(({ fit, catId, ...p }) => p),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
fs.writeFileSync(HIST, JSON.stringify(hist));
console.log(`완료: ${n}개 중 상위 ${out.items.length}개 저장`);
