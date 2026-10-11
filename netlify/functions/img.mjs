// 쿠팡 이미지 프록시: 브라우저 캔버스에서 영상으로 녹화하려면 CORS 허용 이미지가 필요합니다.
const ALLOWED = /(^|\.)(coupangcdn\.com|coupang\.com|pstatic\.net|naver\.net)$/;

export default async (req) => {
  const target = new URL(req.url).searchParams.get("url");
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (!/^https?:$/.test(parsed.protocol) || !ALLOWED.test(parsed.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }
  const res = await fetch(parsed, { headers: { "user-agent": "Mozilla/5.0 (shortsgongbang)" } });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.startsWith("image/")) return new Response("image fetch failed", { status: 502 });
  return new Response(res.body, {
    headers: {
      "content-type": type,
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=86400",
    },
  });
};

export const config = { path: "/api/img" };
