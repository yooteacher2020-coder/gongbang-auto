// 상품번호 레지스트리: 영상 속 "상품번호 N번" ↔ 쿠팡(또는 스마트스토어) 링크
import { openStore } from "./store.mjs";

const KEY = "registry";

export async function loadRegistry() {
  const store = await openStore("products");
  return (await store.getJSON(KEY)) || { items: [] };
}

export async function saveRegistry(registry) {
  const store = await openStore("products");
  registry.items.sort((a, b) => a.no - b.no);
  await store.setJSON(KEY, registry);
  return registry;
}

export function nextNumber(registry) {
  return registry.items.reduce((max, p) => Math.max(max, p.no), 0) + 1;
}

const FIELDS = ["name", "price", "image", "link", "originalUrl", "productId", "source", "category", "memo", "hidden", "videoUrl", "isRocket"];

export function sanitize(input) {
  const out = {};
  for (const f of FIELDS) if (input[f] !== undefined) out[f] = input[f];
  if (out.price !== undefined) out.price = Number(out.price) || 0;
  if (out.hidden !== undefined) out.hidden = Boolean(out.hidden);
  if (out.isRocket !== undefined) out.isRocket = Boolean(out.isRocket);
  for (const f of ["name", "image", "link", "originalUrl", "memo", "category", "videoUrl"]) {
    if (out[f] !== undefined) out[f] = String(out[f]).trim().slice(0, 2000);
  }
  return out;
}

// 시청자에게 공개되는 필드만
export function publicView(p) {
  return { no: p.no, name: p.name, price: p.price, image: p.image, source: p.source || "coupang", category: p.category || "" };
}
