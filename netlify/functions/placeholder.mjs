// 샘플 모드용 상품 이미지 (SVG)
const COLORS = ["#ff6b6b", "#4dabf7", "#51cf66", "#fcc419", "#845ef7", "#ff922b", "#20c997", "#f06595"];

export default async (req) => {
  const url = new URL(req.url);
  const text = (url.searchParams.get("text") || "상품").slice(0, 12).replace(/[<>&"]/g, "");
  const color = COLORS[(Number(url.searchParams.get("n")) || 0) % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<rect width="512" height="512" fill="${color}"/>
<circle cx="256" cy="210" r="110" fill="#ffffff" opacity=".35"/>
<text x="256" y="400" font-size="56" font-family="sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${text}</text>
<text x="256" y="460" font-size="26" font-family="sans-serif" fill="#fff" opacity=".8" text-anchor="middle">SAMPLE</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
};

export const config = { path: "/api/placeholder" };
