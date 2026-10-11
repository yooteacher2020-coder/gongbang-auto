// AI 가 만든 영상 파일을 같은 사이트 주소로 전달(캔버스 녹화용 CORS 해결). 관리자 전용.
import { requireAdmin } from "./lib/http.mjs";

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  let target;
  try {
    target = new URL(new URL(req.url).searchParams.get("url"));
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(target.hostname)) {
    return new Response("not allowed", { status: 403 });
  }
  const res = await fetch(target);
  if (!res.ok) return new Response(`fetch failed (${res.status})`, { status: 502 });
  return new Response(res.body, {
    headers: {
      "content-type": res.headers.get("content-type") || "video/mp4",
      "cache-control": "private, max-age=3600",
    },
  });
};

export const config = { path: "/api/media" };
