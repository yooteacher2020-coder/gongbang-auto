// 상품번호 레지스트리 API
// GET    /api/products            공개 목록 (시청자용, 숨김 제외)
// GET    /api/products?all=1      전체 목록 (관리자, 링크 포함)
// POST   /api/products            등록 {no?, name, price, image, link, ...}  (no 생략 시 다음 번호 자동)
// PUT    /api/products?no=3       수정
// DELETE /api/products?no=3       삭제
import { json, error, isAdmin, requireAdmin } from "./lib/http.mjs";
import { loadRegistry, saveRegistry, nextNumber, sanitize, publicView } from "./lib/registry.mjs";

export default async (req) => {
  const url = new URL(req.url);
  const registry = await loadRegistry();

  if (req.method === "GET") {
    if (url.searchParams.get("all") && isAdmin(req)) {
      return json({ ok: true, nextNo: nextNumber(registry), items: registry.items });
    }
    return json(
      { ok: true, items: registry.items.filter((p) => !p.hidden).map(publicView) },
      200,
      { "cache-control": "public, max-age=30" },
    );
  }

  const denied = requireAdmin(req);
  if (denied) return denied;

  if (req.method === "POST") {
    const body = await req.json();
    const list = Array.isArray(body) ? body : [body];
    const added = [];
    for (const input of list) {
      const data = sanitize(input);
      if (!data.name || !data.link) return error("상품명과 링크는 필수입니다.");
      if (!/^https?:\/\//.test(data.link)) return error("링크는 http(s):// 로 시작해야 합니다.");
      const no = Number(input.no) || nextNumber(registry);
      if (registry.items.some((p) => p.no === no)) return error(`${no}번은 이미 사용 중입니다.`, 409);
      const item = { no, source: "coupang", clicks: 0, createdAt: new Date().toISOString(), ...data };
      registry.items.push(item);
      added.push(item);
    }
    await saveRegistry(registry);
    return json({ ok: true, items: added }, 201);
  }

  const no = Number(url.searchParams.get("no"));
  const index = registry.items.findIndex((p) => p.no === no);
  if (index < 0) return error(`${no}번 상품이 없습니다.`, 404);

  if (req.method === "PUT") {
    const data = sanitize(await req.json());
    registry.items[index] = { ...registry.items[index], ...data, updatedAt: new Date().toISOString() };
    await saveRegistry(registry);
    return json({ ok: true, item: registry.items[index] });
  }

  if (req.method === "DELETE") {
    registry.items.splice(index, 1);
    await saveRegistry(registry);
    return json({ ok: true });
  }

  return error("지원하지 않는 메서드", 405);
};

export const config = { path: "/api/products" };
