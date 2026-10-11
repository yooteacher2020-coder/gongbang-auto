// 로컬 테스트 서버: Netlify 없이 public/ 과 functions 를 흉내냅니다.  node tests/dev-server.mjs
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fnDir = path.join(root, "netlify/functions");
const routes = [];
for (const file of await fs.readdir(fnDir)) {
  if (!file.endsWith(".mjs")) continue;
  const mod = await import(path.join(fnDir, file));
  if (mod.config?.path) routes.push({ path: mod.config.path, handler: mod.default });
  // Netlify 기본 주소 (/.netlify/functions/이름) 도 흉내냅니다. 백그라운드 함수는 202 를 바로 돌려줍니다.
  const name = file.replace(/\.mjs$/, "");
  if (name.endsWith("-background")) {
    routes.push({ path: `/.netlify/functions/${name}`, handler: (req, ctx) => (mod.default(req, ctx), new Response(null, { status: 202 })) });
  } else if (!mod.config?.schedule) {
    routes.push({ path: `/.netlify/functions/${name}`, handler: mod.default });
  }
}
const match = (pattern, pathname) => {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "$");
  const m = pathname.match(re);
  return m && Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  for (const r of routes) {
    const params = match(r.path, url.pathname);
    if (!params) continue;
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const response = await r.handler(request, { params });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  let file = url.pathname === "/" ? "/index.html" : url.pathname === "/shop" ? "/shop.html" : url.pathname;
  try {
    const body = await fs.readFile(path.join(root, "public", path.normalize(file)));
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});
const port = process.env.PORT || 8888;
server.listen(port, () => console.log(`http://localhost:${port}`));
