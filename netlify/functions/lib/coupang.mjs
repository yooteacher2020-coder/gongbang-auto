// 쿠팡 파트너스 오픈 API 클라이언트 (HMAC 서명)
// 문서: https://developers.coupangcorp.com/hc/ko (쿠팡 파트너스 > 오픈 API)
import crypto from "node:crypto";

const DOMAIN = "https://api-gateway.coupang.com";
const BASE = "/v2/providers/affiliate_open_api/apis/openapi/v1";

export const CATEGORIES = {
  1001: "여성패션", 1002: "남성패션", 1010: "뷰티", 1011: "출산/유아동", 1012: "식품",
  1013: "주방용품", 1014: "생활용품", 1015: "홈인테리어", 1016: "가전디지털", 1017: "스포츠/레저",
  1018: "자동차용품", 1019: "도서/음반/DVD", 1020: "완구/취미", 1021: "문구/오피스",
  1024: "헬스/건강식품", 1025: "국내여행", 1026: "해외여행", 1029: "반려동물용품", 1030: "유아동패션",
};

export function hasKeys() {
  return Boolean(process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY);
}

// signed-date 형식: yyMMddTHHmmssZ (GMT)
function signedDate(now = new Date()) {
  return now.toISOString().slice(2, 19).replace(/[-:]/g, "") + "Z";
}

export function authorization(method, pathWithQuery, now = new Date()) {
  const [path, query = ""] = pathWithQuery.split("?");
  const datetime = signedDate(now);
  const message = datetime + method + path + query;
  const signature = crypto.createHmac("sha256", process.env.COUPANG_SECRET_KEY).update(message).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${process.env.COUPANG_ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

async function call(method, pathWithQuery, body) {
  const res = await fetch(DOMAIN + pathWithQuery, {
    method,
    headers: {
      Authorization: authorization(method, pathWithQuery),
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`쿠팡 API 응답 오류 (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || (data.rCode && data.rCode !== "0")) {
    throw new Error(`쿠팡 API 오류 (${res.status}): ${data.rMessage || data.message || text.slice(0, 200)}`);
  }
  return data.data;
}

function subIdParam() {
  return process.env.COUPANG_SUB_ID ? `&subId=${encodeURIComponent(process.env.COUPANG_SUB_ID)}` : "";
}

// 응답의 productUrl 은 이미 파트너스 수수료가 붙는 추적 링크입니다.
export function normalize(p, extra = {}) {
  return {
    productId: String(p.productId),
    name: p.productName,
    price: Number(p.productPrice) || 0,
    image: p.productImage,
    link: p.productUrl,
    rank: p.rank ?? null,
    category: p.categoryName || extra.category || "",
    isRocket: Boolean(p.isRocket),
    isFreeShipping: Boolean(p.isFreeShipping),
    ...extra,
  };
}

export async function bestByCategory(categoryId, limit = 20) {
  const data = await call("GET", `${BASE}/products/bestcategories/${categoryId}?limit=${limit}${subIdParam()}&imageSize=512x512`);
  return data.map((p, i) => normalize({ rank: i + 1, ...p }, { category: CATEGORIES[categoryId] || "" }));
}

export async function goldbox() {
  const data = await call("GET", `${BASE}/products/goldbox?imageSize=512x512${subIdParam()}`);
  return data.map((p, i) => normalize({ rank: i + 1, ...p }, { category: "골드박스" }));
}

export async function search(keyword, limit = 10) {
  const data = await call("GET", `${BASE}/products/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}${subIdParam()}&imageSize=512x512`);
  return (data.productData || []).map((p) => normalize(p, { category: `검색: ${keyword}` }));
}

// 일반 쿠팡 상품 URL → 파트너스 단축 링크 (https://link.coupang.com/a/xxxx)
export async function deeplink(urls) {
  const body = { coupangUrls: urls };
  if (process.env.COUPANG_SUB_ID) body.subId = process.env.COUPANG_SUB_ID;
  return call("POST", `${BASE}/deeplink`, body);
}

// API 키가 없을 때 화면을 미리 체험할 수 있는 샘플 데이터
const SAMPLE_NAMES = [
  "스텐 304 원터치 밀폐용기 10종 세트", "무선 핸디 진공 청소기 초경량", "실리콘 주방 조리도구 12종",
  "대용량 보조배터리 20000mAh 고속충전", "접이식 빨래 건조대 3단", "LED 무드등 감성 수면등",
  "자동 거품 디스펜서 손세정기", "논슬립 옷걸이 50개 세트", "멀티탭 정리함 케이블 박스",
  "휴대용 미니 선풍기 무선", "냉장고 정리 트레이 6개입", "강아지 노즈워크 담요",
];

export function sample(seed = "best", count = 10, dayOffset = 0) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: count }, (_, i) => {
    const idx = (h + i * 7 + dayOffset) % SAMPLE_NAMES.length;
    const name = SAMPLE_NAMES[idx];
    return {
      productId: String(100000 + idx),
      name,
      price: 9900 + ((h + idx * 1373) % 50) * 1000,
      image: `/api/placeholder?text=${encodeURIComponent(name.split(" ")[0])}&n=${idx}`,
      link: `https://www.coupang.com/vp/products/${100000 + idx}`,
      rank: i + 1,
      category: "샘플",
      isRocket: idx % 2 === 0,
      isFreeShipping: true,
      sample: true,
    };
  });
}
