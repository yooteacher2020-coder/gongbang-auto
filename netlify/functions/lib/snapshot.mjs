// 3일 베스트: 매일 카테고리별 베스트 순위를 저장하고, 최근 3일 순위를 합산합니다.
// (쿠팡 API는 판매량을 직접 주지 않으므로 '3일 연속 상위권 유지' 를 판매 인기의 대리 지표로 씁니다.)
import { openStore } from "./store.mjs";
import * as coupang from "./coupang.mjs";

const DEFAULT_CATEGORIES = [1012, 1013, 1014, 1016, 1010, 1024, 1029, 1015];
const LIMIT = 50;

export function snapshotCategories() {
  const env = (process.env.SNAPSHOT_CATEGORIES || "").split(",").map((s) => Number(s.trim())).filter(Boolean);
  return env.length ? env : DEFAULT_CATEGORIES;
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
export function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function takeSnapshot(date = kstDate()) {
  const store = await openStore("snapshots");
  const categories = {};
  const errors = [];
  for (const id of snapshotCategories()) {
    try {
      categories[id] = coupang.hasKeys()
        ? await coupang.bestByCategory(id, LIMIT)
        : coupang.sample(String(id), 20, Number(date.slice(-2)));
    } catch (err) {
      errors.push(`${id}: ${err.message}`);
    }
    if (coupang.hasKeys()) await new Promise((r) => setTimeout(r, 700)); // API 호출 제한 보호
  }
  const snapshot = { date, takenAt: new Date().toISOString(), categories, errors };
  if (Object.keys(categories).length) await store.setJSON(`day-${date}`, snapshot);
  return snapshot;
}

export async function recentSnapshots(days = 3) {
  const store = await openStore("snapshots");
  const keys = (await store.listKeys("day-")).sort().slice(-days);
  return (await Promise.all(keys.map((k) => store.getJSON(k)))).filter(Boolean);
}

// 점수 = Σ(LIMIT + 1 - 순위). 여러 날, 여러 번 상위권에 있을수록 높아집니다.
export function rankTrending(snapshots, { category = "all", limit = 20 } = {}) {
  const byId = new Map();
  for (const snap of snapshots) {
    for (const [catId, products] of Object.entries(snap.categories)) {
      if (category !== "all" && String(catId) !== String(category)) continue;
      for (const p of products) {
        const entry = byId.get(p.productId) || { ...p, score: 0, days: new Set(), ranks: [] };
        entry.score += LIMIT + 1 - (p.rank || LIMIT);
        entry.days.add(snap.date);
        entry.ranks.push({ date: snap.date, rank: p.rank });
        // 최신 정보(가격, 링크)로 갱신
        Object.assign(entry, { name: p.name, price: p.price, image: p.image, link: p.link });
        byId.set(p.productId, entry);
      }
    }
  }
  return [...byId.values()]
    .map((e) => ({ ...e, days: e.days.size }))
    .sort((a, b) => b.days - a.days || b.score - a.score)
    .slice(0, limit)
    .map((e, i) => ({ ...e, trendRank: i + 1 }));
}
