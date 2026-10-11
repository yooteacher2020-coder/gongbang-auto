import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "gongbang-"));
delete process.env.ADMIN_PASSWORD;

const coupang = await import("../netlify/functions/lib/coupang.mjs");
const { rankTrending } = await import("../netlify/functions/lib/snapshot.mjs");
const products = (await import("../netlify/functions/products.mjs")).default;
const go = (await import("../netlify/functions/go.mjs")).default;

const req = (url, init) => new Request("http://x" + url, init);

test("쿠팡 HMAC 서명 형식", () => {
  process.env.COUPANG_ACCESS_KEY = "AK";
  process.env.COUPANG_SECRET_KEY = "SK";
  const now = new Date("2026-10-11T01:02:03Z");
  const auth = coupang.authorization("GET", "/v2/a/b?limit=10", now);
  const expected = crypto.createHmac("sha256", "SK").update("261011T010203ZGET/v2/a/blimit=10").digest("hex");
  assert.equal(auth, `CEA algorithm=HmacSHA256, access-key=AK, signed-date=261011T010203Z, signature=${expected}`);
  delete process.env.COUPANG_ACCESS_KEY;
  delete process.env.COUPANG_SECRET_KEY;
});

test("3일 베스트: 여러 날 상위권 상품이 먼저", () => {
  const p = (id, rank) => ({ productId: id, name: id, rank });
  const snaps = [
    { date: "d1", categories: { 1: [p("A", 1), p("B", 5)] } },
    { date: "d2", categories: { 1: [p("C", 1), p("B", 6)] } },
    { date: "d3", categories: { 1: [p("C", 1), p("B", 4)] } },
  ];
  const ranked = rankTrending(snaps);
  assert.deepEqual(ranked.map((r) => r.productId), ["B", "C", "A"]);
  assert.equal(ranked[0].days, 3);
});

test("상품번호 등록 → /go 리다이렉트 → 클릭 수", async () => {
  let res = await products(req("/api/products", { method: "POST", body: JSON.stringify({ name: "밀폐용기", link: "https://link.coupang.com/a/abc", price: 19900 }) }));
  assert.equal(res.status, 201);
  assert.equal((await res.json()).items[0].no, 1);

  res = await products(req("/api/products", { method: "POST", body: JSON.stringify({ no: 13, name: "기존 영상 상품", link: "https://link.coupang.com/a/xyz" }) }));
  assert.equal((await res.json()).items[0].no, 13);

  res = await products(req("/api/products", { method: "POST", body: JSON.stringify({ no: 13, name: "중복", link: "https://a.b" }) }));
  assert.equal(res.status, 409);

  res = await go(req("/go/13"), { params: { no: "13" } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://link.coupang.com/a/xyz");

  res = await go(req("/go/99"), { params: { no: "99" } });
  assert.equal(res.headers.get("location"), "/shop?missing=99");

  const all = await (await products(req("/api/products?all=1"))).json();
  assert.equal(all.nextNo, 14);
  assert.equal(all.items.find((p) => p.no === 13).clicks, 1);

  const pub = await (await products(req("/api/products"))).json();
  assert.equal(pub.items[0].link, undefined, "공개 목록에는 링크가 노출되지 않음");
});

test("관리자 비밀번호", async () => {
  process.env.ADMIN_PASSWORD = "pw";
  let res = await products(req("/api/products", { method: "POST", body: "{}" }));
  assert.equal(res.status, 401);
  res = await products(req("/api/products?no=1", { method: "DELETE", headers: { "x-admin-key": "pw" } }));
  assert.equal(res.status, 200);
  delete process.env.ADMIN_PASSWORD;
});
