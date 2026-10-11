// /go/7  → 7번 상품의 쿠팡 파트너스 링크로 이동 (클릭 수 기록)
import { loadRegistry, saveRegistry } from "./lib/registry.mjs";

export default async (req, context) => {
  const no = Number(context.params?.no ?? new URL(req.url).pathname.split("/").pop());
  const registry = await loadRegistry();
  const item = registry.items.find((p) => p.no === no);
  if (!item) {
    return new Response(null, { status: 302, headers: { location: `/shop?missing=${encodeURIComponent(no || "")}` } });
  }
  item.clicks = (item.clicks || 0) + 1;
  item.lastClickAt = new Date().toISOString();
  try {
    await saveRegistry(registry);
  } catch {
    // 클릭 기록 실패해도 이동은 시킵니다.
  }
  return new Response(null, { status: 302, headers: { location: item.link, "cache-control": "no-store" } });
};

export const config = { path: "/go/:no" };
