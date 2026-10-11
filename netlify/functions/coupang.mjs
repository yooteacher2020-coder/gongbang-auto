// GET /api/coupang?type=best&category=1012&limit=20
// GET /api/coupang?type=goldbox
// GET /api/coupang?type=search&keyword=텀블러
// GET /api/coupang?type=trending&category=all   (최근 3일 베스트)
// POST /api/coupang?type=snapshot               (오늘 순위 즉시 저장)
// POST /api/coupang?type=deeplink  {urls:[...]}  (쿠팡 URL → 파트너스 링크)
import * as coupang from "./lib/coupang.mjs";
import { json, error, requireAdmin } from "./lib/http.mjs";
import { takeSnapshot, recentSnapshots, rankTrending, kstDate } from "./lib/snapshot.mjs";

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "best";
  const limit = Math.min(Number(url.searchParams.get("limit")) || 20, 100);
  const live = coupang.hasKeys();

  try {
    if (type === "categories") {
      const keys = { access: Boolean(process.env.COUPANG_ACCESS_KEY), secret: Boolean(process.env.COUPANG_SECRET_KEY) };
      return json({ ok: true, live, keys, categories: coupang.CATEGORIES });
    }

    if (type === "best") {
      const category = url.searchParams.get("category") || "1014";
      const items = live ? await coupang.bestByCategory(category, limit) : coupang.sample(category, limit);
      return json({ ok: true, live, items });
    }

    if (type === "goldbox") {
      const items = live ? await coupang.goldbox() : coupang.sample("goldbox", 10);
      return json({ ok: true, live, items });
    }

    if (type === "search") {
      const keyword = (url.searchParams.get("keyword") || "").trim();
      if (!keyword) return error("검색어를 입력하세요.");
      const items = live ? await coupang.search(keyword, Math.min(limit, 10)) : coupang.sample(keyword, 5);
      return json({ ok: true, live, items });
    }

    if (type === "snapshot") {
      if (req.method !== "POST") return error("POST 로 호출하세요.", 405);
      const snap = await takeSnapshot();
      return json({ ok: true, live, date: snap.date, categories: Object.keys(snap.categories).length, errors: snap.errors });
    }

    if (type === "trending") {
      let snapshots = await recentSnapshots(3);
      // 오늘 스냅샷이 없으면 지금 한 번 수집
      if (!snapshots.some((s) => s.date === kstDate())) {
        await takeSnapshot();
        snapshots = await recentSnapshots(3);
      }
      const items = rankTrending(snapshots, { category: url.searchParams.get("category") || "all", limit });
      return json({ ok: true, live, days: snapshots.map((s) => s.date), items });
    }

    if (type === "deeplink") {
      if (req.method !== "POST") return error("POST 로 호출하세요.", 405);
      const { urls } = await req.json();
      const list = (Array.isArray(urls) ? urls : [urls]).filter((u) => /coupang\.com/.test(u || ""));
      if (!list.length) return error("쿠팡 상품 URL 을 넣어주세요.");
      if (!live) return error("쿠팡 파트너스 API 키가 없어 자동 변환할 수 없습니다. 파트너스 사이트의 '링크 생성'으로 만든 링크를 직접 붙여넣으세요.", 400);
      return json({ ok: true, live, items: await coupang.deeplink(list) });
    }

    return error(`알 수 없는 type: ${type}`);
  } catch (err) {
    return error(err.message, 502);
  }
};

export const config = { path: "/api/coupang" };
