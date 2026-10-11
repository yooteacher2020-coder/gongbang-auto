import { prepare, timeline, drawFrame, play, record, proxied, loadFile, stopVideos, INTRO, OUTRO, DISCLOSURE } from "./video.js";
import * as ai from "./ai.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  findMode: "trending",
  results: [],
  selected: new Set(),
  registry: [],
  template: "ad",
  ai: {}, // 상품번호 → { script, voice: { buffer, timings, forText } }
  picked: [], // 영상에 넣을 상품번호 (순서 = 순위)
  media: {}, // 상품번호 → 직접 올린 사진/영상 [{kind, el, name}]
  live: false,
};

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
}

function toast(msg, ms = 2600) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), ms);
}

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-admin-key": storage("adminKey") || "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ ok: false, error: `서버 오류 (${res.status})` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

async function busy(btn, fn) {
  btn.disabled = true;
  try {
    return await fn();
  } catch (err) {
    toast("⚠️ " + err.message, 5000);
  } finally {
    btn.disabled = false;
  }
}

// ---------- 탭 ----------
function showTab(name) {
  $$("nav.tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$("section.tab").forEach((s) => s.classList.toggle("active", s.id === "tab-" + name));
  storage("tab", name);
  if (name === "video") refreshPreview();
}
$$("nav.tabs button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- API 상태 ----------
async function loadStatus() {
  try {
    const data = await api("/api/coupang?type=categories");
    state.live = data.live;
    const sel = $("#category");
    sel.innerHTML = `<option value="all">전체 (수집 카테고리)</option>` +
      Object.entries(data.categories).map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join("");
    sel.value = storage("category") || "all";
    $("#apiBadge").className = "badge " + (data.live ? "live" : "sample");
    $("#apiBadge").textContent = data.live ? "쿠팡 API 연결됨" : "샘플 모드 (API 키 없음)";
    $("#apiStatus").innerHTML = data.live
      ? "✅ 쿠팡 파트너스 오픈 API 키가 설정되어 있습니다. 실제 베스트 상품과 수수료 링크를 가져옵니다."
      : `🟡 API 키 인식 상태 — COUPANG_ACCESS_KEY: ${data.keys?.access ? "✅ 있음" : "❌ 없음"}, COUPANG_SECRET_KEY: ${data.keys?.secret ? "✅ 있음" : "❌ 없음"}<br>` +
        "API 키가 없어 샘플 데이터로 동작합니다. 쿠팡 파트너스 → 추가기능 → 오픈 API 에서 키를 발급받아 Netlify 환경변수 <code>COUPANG_ACCESS_KEY</code>, <code>COUPANG_SECRET_KEY</code> 에 넣으세요. (오픈 API는 누적 판매 실적 조건을 채운 뒤 발급됩니다. 그 전에는 ‘상품번호’ 탭에서 직접 링크를 등록해 쓰면 됩니다.)";
  } catch (err) {
    $("#apiBadge").textContent = err.message.includes("비밀번호") ? "🔒 설정에서 비밀번호 입력" : "API 오류";
    $("#apiStatus").textContent = err.message;
  }
}

// ---------- 1. 상품 찾기 ----------
const findHints = {
  trending: "3일 베스트 = 매일 저장되는 카테고리 베스트 순위를 최근 3일치 합산한 순위입니다. 3일 연속 상위권인 상품이 위로 올라옵니다.",
  best: "쿠팡이 제공하는 카테고리별 실시간 베스트 순위입니다.",
  goldbox: "오늘의 골드박스 특가 상품입니다. (매일 오전 7시 갱신)",
  search: "키워드로 상품을 검색합니다. (쿠팡 정책상 검색 API는 시간당 호출 수 제한이 있어요)",
};
$$("#findMode button").forEach((b) => (b.onclick = () => {
  state.findMode = b.dataset.mode;
  $$("#findMode button").forEach((x) => x.classList.toggle("active", x === b));
  $("#catWrap").style.display = ["trending", "best"].includes(state.findMode) ? "" : "none";
  $("#kwWrap").style.display = state.findMode === "search" ? "" : "none";
  $("#category option[value=all]").disabled = state.findMode === "best";
  if (state.findMode === "best" && $("#category").value === "all") $("#category").value = "1014";
  $("#findHint").textContent = findHints[state.findMode];
}));
$("#category").onchange = () => storage("category", $("#category").value);
$("#keyword").onkeydown = (e) => e.key === "Enter" && $("#findBtn").click();

$("#findBtn").onclick = (e) => busy(e.target, async () => {
  const q = new URLSearchParams({ type: state.findMode, limit: $("#limit").value });
  if (["trending", "best"].includes(state.findMode)) q.set("category", $("#category").value);
  if (state.findMode === "search") q.set("keyword", $("#keyword").value);
  $("#results").innerHTML = `<div class="empty">불러오는 중…</div>`;
  const data = await api("/api/coupang?" + q);
  state.results = data.items;
  state.selected.clear();
  renderResults();
  if (data.days) toast(`${data.days.length}일치 순위 합산 (${data.days.join(", ")})`);
});

function renderResults() {
  const registered = new Map(state.registry.filter((p) => p.productId).map((p) => [p.productId, p.no]));
  $("#results").innerHTML = state.results.length ? state.results.map((p, i) => {
    const no = registered.get(p.productId);
    const meta = p.days ? `${p.days}일 연속` : p.isRocket ? "로켓" : "";
    return `<div class="pcard ${state.selected.has(i) ? "selected" : ""}" data-i="${i}">
      <span class="rank">${p.trendRank || p.rank || i + 1}</span>
      ${meta ? `<span class="meta">${meta}</span>` : ""}
      <img src="${esc(proxied(p.image))}" loading="lazy" alt="">
      <div class="info">
        <div class="name">${esc(p.name)}</div>
        <div class="price">${won(p.price)}</div>
        ${no ? `<div class="hint" style="margin:2px 0 0">✅ 상품번호 ${no}</div>` : ""}
      </div></div>`;
  }).join("") : `<div class="empty">결과가 없습니다.</div>`;
  $$("#results .pcard").forEach((el) => (el.onclick = () => {
    const i = Number(el.dataset.i);
    state.selected.has(i) ? state.selected.delete(i) : state.selected.add(i);
    el.classList.toggle("selected");
    $("#selCount").textContent = `선택 ${state.selected.size}개`;
  }));
  $("#selCount").textContent = `선택 ${state.selected.size}개`;
}
$("#selectTop5").onclick = () => {
  state.selected = new Set(state.results.slice(0, 5).map((_, i) => i));
  renderResults();
};
$("#clearSel").onclick = () => {
  state.selected.clear();
  renderResults();
};

// 선택한 검색 결과를 레지스트리에 등록하고 상품번호 배열을 돌려줍니다. 이미 등록된 상품은 기존 번호를 씁니다.
async function registerSelected() {
  const picks = [...state.selected].sort((a, b) => a - b).map((i) => state.results[i]);
  if (!picks.length) throw new Error("상품을 먼저 선택하세요.");
  const toBody = (p) => ({ name: p.name, price: p.price, image: p.image, link: p.link, productId: p.productId, category: p.category, isRocket: p.isRocket, source: "coupang" });
  // 번호를 직접 지정한 경우 (예: 영상에 이미 "상품번호 13번"을 넣었을 때)
  const forcedNo = Number($("#regNo").value);
  if (forcedNo) {
    if (picks.length !== 1) throw new Error("번호 지정은 상품을 1개만 선택했을 때 쓸 수 있어요.");
    const exists = state.registry.find((x) => x.no === forcedNo);
    if (exists) {
      if (exists.productId !== picks[0].productId && !confirm(`${forcedNo}번에 이미 "${exists.name}" 이(가) 있어요. 이 상품으로 바꿀까요?`)) throw new Error("취소했습니다.");
      await api(`/api/products?no=${forcedNo}`, { method: "PUT", body: toBody(picks[0]) });
    } else {
      await api("/api/products", { method: "POST", body: { ...toBody(picks[0]), no: forcedNo } });
    }
    $("#regNo").value = "";
    await loadRegistry();
    renderResults();
    return [forcedNo];
  }
  const existing = new Map(state.registry.filter((p) => p.productId).map((p) => [p.productId, p.no]));
  const fresh = picks.filter((p) => !existing.has(p.productId));
  if (fresh.length) {
    const { items } = await api("/api/products", {
      method: "POST",
      body: fresh.map(toBody),
    });
    items.forEach((it) => existing.set(it.productId, it.no));
  }
  await loadRegistry();
  renderResults();
  return picks.map((p) => existing.get(p.productId));
}
$("#registerSel").onclick = (e) => busy(e.target, async () => {
  const nos = await registerSelected();
  toast(`상품번호 ${nos.join(", ")} 등록 완료`);
});
$("#videoSel").onclick = (e) => busy(e.target, async () => {
  state.picked = await registerSelected();
  setTemplate(state.picked.length > 1 ? "ranking" : "ad");
  renderPickList();
  regenerateScript();
  showTab("video");
});

// ---------- 2. 상품번호 ----------
async function loadRegistry() {
  try {
    const data = await api("/api/products?all=1");
    state.registry = data.items;
    $("#fNo").placeholder = `자동 (${data.nextNo})`;
  } catch (err) {
    state.registry = [];
    $("#regBody").innerHTML = `<tr><td colspan="7" class="empty">${esc(err.message)}</td></tr>`;
    return;
  }
  renderRegistry();
  renderPickList();
}

function renderRegistry() {
  const origin = location.origin;
  $("#regBody").innerHTML = state.registry.length ? state.registry.map((p) => `
    <tr style="${p.hidden ? "opacity:.45" : ""}">
      <td class="no">${p.no}</td>
      <td>${p.image ? `<img src="${esc(proxied(p.image))}" alt="">` : ""}</td>
      <td>${esc(p.name)}<div class="hint" style="margin:0">${p.source === "naver" ? "스마트스토어" : p.source === "etc" ? "기타" : "쿠팡"}${p.sample || /\/vp\/products\/1000\d\d$/.test(p.link) ? " · 샘플" : ""}</div></td>
      <td>${won(p.price)}</td>
      <td>${p.clicks || 0}</td>
      <td><button class="btn secondary small" data-golink="${origin}/go/${p.no}">/go/${p.no} 복사</button></td>
      <td style="white-space:nowrap">
        <button class="btn secondary small" data-edit="${p.no}">수정</button>
        <button class="btn secondary small" data-hide="${p.no}">${p.hidden ? "공개" : "숨김"}</button>
        <button class="btn danger small" data-del="${p.no}">삭제</button>
      </td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty">아직 등록된 상품이 없습니다. 위에서 직접 등록하거나 ‘상품 찾기’에서 선택해 등록하세요.</td></tr>`;

  $$("[data-golink]").forEach((b) => (b.onclick = () => copy(b.dataset.golink)));
  $$("[data-del]").forEach((b) => (b.onclick = () => busy(b, async () => {
    if (!confirm(`${b.dataset.del}번 상품을 삭제할까요? 이 번호가 나온 영상의 링크가 끊깁니다.`)) return;
    await api("/api/products?no=" + b.dataset.del, { method: "DELETE" });
    await loadRegistry();
  })));
  $$("[data-hide]").forEach((b) => (b.onclick = () => busy(b, async () => {
    const p = state.registry.find((x) => x.no === Number(b.dataset.hide));
    await api("/api/products?no=" + p.no, { method: "PUT", body: { hidden: !p.hidden } });
    await loadRegistry();
  })));
  $$("[data-edit]").forEach((b) => (b.onclick = () => busy(b, async () => {
    const p = state.registry.find((x) => x.no === Number(b.dataset.edit));
    const link = prompt(`${p.no}번 링크 (쿠팡 파트너스/스마트스토어)`, p.link);
    if (link === null) return;
    const name = prompt("상품명", p.name);
    if (name === null) return;
    const price = prompt("가격", p.price);
    await api("/api/products?no=" + p.no, { method: "PUT", body: { link, name, price: price ?? p.price } });
    await loadRegistry();
  })));
}

$("#reloadReg").onclick = (e) => busy(e.target, loadRegistry);
$("#pickClear").onclick = () => {
  state.picked = [];
  renderPickList();
  refreshPreview();
};
$("#delSamples").onclick = (e) => busy(e.target, async () => {
  const samples = state.registry.filter((p) => /\/vp\/products\/1000\d\d$/.test(p.link) || String(p.image || "").startsWith("/api/placeholder"));
  if (!samples.length) return toast("지울 샘플 상품이 없어요.");
  if (!confirm(`샘플 상품 ${samples.length}개(${samples.map((p) => p.no).join(", ")}번)를 모두 삭제할까요?`)) return;
  for (const p of samples) await api("/api/products?no=" + p.no, { method: "DELETE" });
  state.picked = state.picked.filter((no) => !samples.some((p) => p.no === no));
  await loadRegistry();
  toast(`샘플 상품 ${samples.length}개 삭제`);
});
$("#openShop").onclick = () => window.open("/shop", "_blank");
$("#convertBtn").onclick = (e) => busy(e.target, async () => {
  const url = $("#fOrig").value.trim();
  const { items } = await api("/api/coupang?type=deeplink", { method: "POST", body: { urls: [url] } });
  $("#fLink").value = items[0].shortenUrl;
  toast("파트너스 링크로 변환했습니다.");
});
$("#addBtn").onclick = (e) => busy(e.target, async () => {
  const body = {
    no: $("#fNo").value || undefined,
    name: $("#fName").value,
    price: $("#fPrice").value,
    link: $("#fLink").value || $("#fOrig").value,
    originalUrl: $("#fOrig").value,
    image: $("#fImage").value,
    source: $("#fSource").value,
  };
  const { items } = await api("/api/products", { method: "POST", body });
  ["#fNo", "#fName", "#fPrice", "#fLink", "#fOrig", "#fImage"].forEach((s) => ($(s).value = ""));
  toast(`상품번호 ${items[0].no} 등록 완료`);
  await loadRegistry();
});

// ---------- 3. 영상 ----------
const HOOKS = [
  "요즘 3일 동안 제일 많이 팔린 꿀템",
  "쿠팡에서 지금 난리난 살림템",
  "이거 모르면 손해! 품절 직전 꿀템",
  "자취생 필수템 TOP {n}",
  "후기 수천 개, 다들 이거 삼",
  "3일 연속 베스트, 이유가 있다",
  "사고 나서 제일 만족한 것들",
];
let hookIdx = 0;
$("#hookShuffle").onclick = () => {
  hookIdx = (hookIdx + 1) % HOOKS.length;
  $("#vHook").value = HOOKS[hookIdx].replace("{n}", state.picked.length || 5);
  refreshPreview();
};

function setTemplate(tpl) {
  state.template = tpl;
  $$("#tplMode button").forEach((b) => b.classList.toggle("active", b.dataset.tpl === tpl));
  $("#tplHint").textContent = {
    ad: "상품 1개를 AI 대본·AI 목소리·AI 상품 영상으로 소개합니다. 상단 고정 제목 + 상품번호 + 목소리에 맞춘 자막. (선택한 상품 중 첫 번째)",
    ranking: "여러 상품을 순위대로 소개합니다(최대 7개, 5위→1위 카운트다운). 3일 베스트 TOP5 영상에 좋아요.",
    single: "상품 1개를 크게 보여줍니다. 선택한 상품 중 첫 번째만 사용합니다.",
  }[tpl];
  $("#aiCard").style.display = tpl === "ad" ? "" : "none";
  $("#scriptCard").style.display = tpl === "ad" ? "none" : "";
}
$$("#tplMode button").forEach((b) => (b.onclick = () => {
  setTemplate(b.dataset.tpl);
  renderPickList();
  regenerateScript();
  refreshPreview();
}));

function renderPickList() {
  const visible = state.registry.filter((p) => !p.hidden);
  state.picked = state.picked.filter((no) => visible.some((p) => p.no === no));
  $("#pickList").innerHTML = visible.length ? visible.slice().reverse().map((p) => `
    <div class="pick-row">
      <label><input type="checkbox" value="${p.no}" ${state.picked.includes(p.no) ? "checked" : ""}>
        <b>${p.no}</b>${p.image ? `<img src="${esc(proxied(p.image))}" alt="">` : ""}<span>${esc(p.name)}</span></label>
      <button class="btn secondary small" data-media="${p.no}" title="사진·영상 추가">📷 ${(state.media[p.no] || []).length || "+"}</button>
      ${(state.media[p.no] || []).length ? `<button class="btn secondary small" data-media-clear="${p.no}" title="올린 사진·영상 지우기">🧹</button>` : ""}
      <button class="btn danger small" data-pick-del="${p.no}" title="이 상품 삭제">🗑</button>
    </div>`).join("")
    : `<div class="empty">등록된 상품이 없습니다.</div>`;
  $$("#pickList input[type=checkbox]").forEach((cb) => (cb.onchange = () => {
    const no = Number(cb.value);
    state.picked = cb.checked ? [...state.picked, no] : state.picked.filter((x) => x !== no);
    if (state.template === "ranking" && state.picked.length > 7) {
      state.picked = state.picked.slice(0, 7);
      cb.checked = false;
      toast("랭킹은 최대 7개까지 넣을 수 있어요.");
    }
    updatePickCount();
    regenerateScript();
    refreshPreview();
  }));
  $$("[data-media]").forEach((b) => (b.onclick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*";
    input.multiple = true;
    input.onchange = async () => {
      const no = Number(b.dataset.media);
      const loaded = (await Promise.all([...input.files].map(loadFile))).filter(Boolean);
      state.media[no] = [...(state.media[no] || []), ...loaded];
      if (!state.picked.includes(no)) state.picked.push(no);
      toast(`${no}번에 사진·영상 ${loaded.length}개 추가`);
      renderPickList();
      refreshPreview();
    };
    input.click();
  }));
  $$("[data-pick-del]").forEach((b) => (b.onclick = () => busy(b, async () => {
    const no = Number(b.dataset.pickDel);
    const p = state.registry.find((x) => x.no === no);
    if (!confirm(`${no}번 "${p?.name || ""}" 상품을 삭제할까요?`)) return;
    await api("/api/products?no=" + no, { method: "DELETE" });
    state.picked = state.picked.filter((x) => x !== no);
    delete state.media[no];
    await loadRegistry();
    await refreshPreview();
  })));
  $$("[data-media-clear]").forEach((b) => (b.onclick = () => {
    delete state.media[Number(b.dataset.mediaClear)];
    renderPickList();
    refreshPreview();
  }));
  updatePickCount();
}
function updatePickCount() {
  $("#pickCount").textContent = state.picked.length
    ? `선택 순서 = 순위: ${state.picked.map((n, i) => `${i + 1}위 #${n}`).join(", ")}`
    : "";
}

// ----- 대본 -----
const shortName = (name) => {
  const words = String(name || "").replace(/[\[\(].*?[\]\)]/g, "").split(/[\s,]+/).filter(Boolean);
  let out = "";
  for (const w of words) {
    if ((out + " " + w).trim().length > 14) break;
    out = (out + " " + w).trim();
  }
  return out || words[0] || "";
};
const EXTRA_LINES = [
  (p) => `${p.category && p.category !== "샘플" ? p.category + " " : ""}베스트에서 계속 상위권!`,
  () => "써본 사람들 후기가 진짜 좋아요",
  () => "한 번 쓰면 없던 때로 못 돌아가요",
  () => "가성비로는 이만한 게 없어요",
  () => "선물용으로도 반응 최고",
  () => "살림 고수들은 이미 다 쓰는 중",
  () => "품절되기 전에 꼭 확인하세요",
];

function lineCount(seconds) {
  return Math.max(2, Math.min(7, Math.round(seconds / 2.3)));
}

function productLines(p, rank, seconds, seed) {
  const name = shortName(p.name);
  const lines = [rank ? `${rank}위! ${name}` : `${name}, 이거 진짜 물건이에요`];
  if (p.price) lines.push(`가격은 ${won(p.price)}${p.isRocket ? ", 로켓배송까지" : ""}`);
  const want = lineCount(seconds);
  for (let i = 0; lines.length < want - 1; i++) lines.push(EXTRA_LINES[(seed + i) % EXTRA_LINES.length](p));
  lines.push(`상품번호 ${p.no}번 기억하세요!`);
  return lines;
}

function perItemSeconds(count) {
  const len = Math.min(60, Math.max(25, Number($("#vLen").value) || 30));
  return (len - INTRO - OUTRO) / Math.max(1, count);
}

function regenerateScript() {
  const nos = state.template === "single" ? state.picked.slice(0, 1) : state.picked;
  const products = nos.map((no) => state.registry.find((p) => p.no === no)).filter(Boolean);
  const sec = perItemSeconds(products.length);
  // 랭킹은 N위부터 나오므로 그 순서로 씁니다.
  const ordered = state.template === "single" ? products.map((p) => [p, null]) : products.map((p, i) => [p, i + 1]).reverse();
  $("#vScript").value = ordered.map(([p, rank], i) => `[${p.no}]\n${productLines(p, rank, sec, i * 2).join("\n")}`).join("\n\n");
}

function parseScript() {
  const out = {};
  let current = null;
  for (const raw of $("#vScript").value.split("\n")) {
    const line = raw.trim();
    const head = line.match(/^\[(\d+)\]$/);
    if (head) current = out[Number(head[1])] = [];
    else if (line && current) current.push(line);
  }
  return out;
}

$("#scriptGen").onclick = () => {
  regenerateScript();
  refreshPreview();
};
$("#vScript").onchange = refreshPreview;

function adProduct() {
  const p = state.registry.find((x) => x.no === state.picked[0]);
  if (!p) throw new Error("영상에 넣을 상품을 선택하세요.");
  return p;
}
const captionLines = () => $("#aiCaptions").value.split("\n").map((l) => l.trim()).filter(Boolean);
const voiceFresh = (no) => state.ai[no]?.voice && state.ai[no].voice.forText === $("#aiCaptions").value;

async function buildAdSpec() {
  const p = adProduct();
  const lines = captionLines();
  if (!lines.length) throw new Error("자막 대본이 비어 있어요. ✍️ AI 대본을 먼저 만들어 주세요.");
  const voice = voiceFresh(p.no) ? state.ai[p.no].voice : null;
  // 목소리가 없으면 한 줄에 2.6초씩
  const captions = voice ? voice.timings : lines.map((text, i) => ({ text, start: i * 2.6, end: (i + 1) * 2.6 }));
  const lastStart = captions[captions.length - 1].start;
  const duration = Math.max(voice ? voice.buffer.duration + 1.2 : lines.length * 2.6 + 1, lastStart + 3.2);
  return {
    template: "ad",
    items: await prepare([p], state.media, {}),
    ad: { title1: $("#aiTitle1").value || stripTitle(p.name), title2: $("#aiTitle2").value || "", captions, duration },
    voice: voice?.buffer || null,
    cta: $("#vCta").value,
    showDisclosure: $("#vDisclosure").checked,
  };
}
const stripTitle = (name) => shortName(name);

async function buildSpec() {
  if (state.template === "ad") return buildAdSpec();
  const nos = state.template === "single" ? state.picked.slice(0, 1) : state.picked;
  const products = nos.map((no) => state.registry.find((p) => p.no === no)).filter(Boolean);
  if (!products.length) throw new Error("영상에 넣을 상품을 선택하세요.");
  return {
    template: state.template,
    items: await prepare(products, state.media, parseScript()),
    hook: $("#vHook").value,
    cta: $("#vCta").value,
    color: $("#vColor").value,
    perItem: perItemSeconds(products.length),
    showPrice: $("#vPrice").value === "1",
    showDisclosure: $("#vDisclosure").checked,
  };
}

let stopPlay = null;
async function refreshPreview() {
  writeCopy();
  const canvas = $("#canvas");
  if (!state.picked.length) {
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return;
  }
  try {
    const spec = await buildSpec();
    const tl = timeline(spec);
    drawFrame(canvas.getContext("2d"), spec, tl, spec.template === "ad" ? 2 : tl.segs[1].start + 1.2);
    stopVideos();
  } catch (err) {
    toast(err.message);
  }
}
["#vHook", "#vCta", "#vColor", "#vPrice", "#vDisclosure"].forEach((s) => ($(s).onchange = refreshPreview));
$("#vLen").onchange = () => {
  regenerateScript();
  refreshPreview();
};

$("#playBtn").onclick = (e) => busy(e.target, async () => {
  stopPlay?.();
  const spec = await buildSpec();
  let resolve;
  const done = new Promise((r) => (resolve = r));
  stopPlay = await play($("#canvas"), spec, resolve, { bgmFile: $("#vBgm").files[0] });
  await done;
});

$("#recBtn").onclick = (e) => busy(e.target, async () => {
  stopPlay?.();
  const spec = await buildSpec();
  const bar = $("#recProgress");
  $("#recHint").textContent = "녹화 중… 탭을 바꾸지 마세요.";
  const { blob, ext, duration } = await record($("#canvas"), spec, {
    bgmFile: $("#vBgm").files[0],
    onProgress: (p) => (bar.style.width = (p * 100).toFixed(1) + "%"),
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `shorts_${new Date().toISOString().slice(0, 10)}_${spec.items.map((p) => p.no).join("-")}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  bar.style.width = "0";
  $("#recHint").textContent = `저장 완료 (${duration.toFixed(1)}초, ${ext.toUpperCase()}). 유튜브에 바로 업로드할 수 있어요.`;
});

function writeCopy() {
  const products = state.picked.map((no) => state.registry.find((p) => p.no === no)).filter(Boolean);
  const shop = location.origin + "/shop";
  if (!products.length) return;
  const script = state.template === "ad" && state.ai[products[0].no]?.script;
  if (script) {
    const p = products[0];
    const go = `${location.origin}/go/${p.no}`;
    const tags = script.hashtags.join(" ");
    $("#outTitle").value = script.youtube_title;
    $("#outDesc").value = `${script.description_intro}\n\n📌 상품번호 ${p.no}번 바로가기 👉 ${go}\n🔎 다른 상품번호 찾기 👉 ${shop}\n\n${DISCLOSURE}\n\n${tags}`;
    $("#outComment").value = `${script.pinned_comment}\n\n📌 상품번호 ${p.no}번 👉 ${go}\n\n${DISCLOSURE}`;
    return;
  }
  const single = state.template === "single";
  const first = products[0];
  const tags = ["#쇼핑쇼츠", "#쿠팡추천", "#꿀템", "#살림템", single ? "#내돈내산" : "#베스트템"];
  $("#outTitle").value = single
    ? `${first.name.slice(0, 40)} | 상품번호 ${first.no} ${tags.slice(0, 2).join(" ")}`
    : `${$("#vHook").value} TOP${products.length} ${tags.slice(0, 2).join(" ")}`;
  const list = products.map((p, i) => `${single ? "" : `${i + 1}위 `}상품번호 ${p.no} | ${p.name}\n👉 ${location.origin}/go/${p.no}`).join("\n\n");
  $("#outDesc").value = `📦 영상 속 상품 바로가기\n프로필 링크 → 상품번호 검색: ${shop}\n\n${list}\n\n${DISCLOSURE}\n\n${tags.join(" ")}`;
  $("#outComment").value = `📌 상품번호로 찾기 → 프로필 링크 클릭!\n${products.map((p) => `#${p.no} ${p.name.slice(0, 24)}`).join("\n")}\n\n${DISCLOSURE}`;
}

// ---------- 3-1. AI 자동 제작 ----------
function aiLog(id, text, cls = "") {
  let el = document.querySelector(`#aiLog [data-id="${id}"]`);
  if (!el) {
    el = document.createElement("div");
    el.dataset.id = id;
    $("#aiLog").appendChild(el);
  }
  el.className = cls;
  el.textContent = text;
}

let aiInfo = { script: false, voice: false, video: false };
let voiceList = [];
async function loadAi() {
  try {
    aiInfo = await ai.aiStatus();
  } catch {
    return;
  }
  const mark = (b) => (b ? "✅" : "❌");
  $("#aiKeys").textContent = `대본 ${mark(aiInfo.script)} 목소리 ${mark(aiInfo.voice)} 영상 ${mark(aiInfo.video)}`;
  $("#aiStatusText").innerHTML = `AI 대본(ANTHROPIC_API_KEY): ${mark(aiInfo.script)} · AI 목소리(ELEVENLABS_API_KEY): ${mark(aiInfo.voice)} · AI 영상(HIGGSFIELD_KEY_ID/SECRET): ${mark(aiInfo.video)}`;
  if (!aiInfo.voice) {
    $("#aiVoice").innerHTML = `<option value="">ElevenLabs 키를 넣으면 목소리를 고를 수 있어요</option>`;
    return;
  }
  try {
    voiceList = await ai.voices();
  } catch (err) {
    $("#aiVoice").innerHTML = `<option value="">${esc(err.message)}</option>`;
    return;
  }
  // 한국어 · 여성 목소리를 위로
  const score = (v) => (/korean|ko\b|한국/i.test(`${v.accent} ${v.name} ${v.description}`) ? 2 : 0) + (v.gender === "female" ? 1 : 0);
  voiceList.sort((a, b) => score(b) - score(a));
  const saved = storage("voiceId") || aiInfo.defaultVoiceId;
  $("#aiVoice").innerHTML = voiceList.map((v) => `<option value="${esc(v.id)}">${esc(v.name)}${v.gender ? ` · ${v.gender === "female" ? "여성" : v.gender === "male" ? "남성" : v.gender}` : ""}${v.accent ? ` · ${esc(v.accent)}` : ""}</option>`).join("");
  if (saved && voiceList.some((v) => v.id === saved)) $("#aiVoice").value = saved;
}
$("#aiVoice").onchange = () => storage("voiceId", $("#aiVoice").value);
$("#aiVoicePreview").onclick = () => {
  const v = voiceList.find((x) => x.id === $("#aiVoice").value);
  if (v?.preview) new Audio(v.preview).play();
  else toast("미리듣기가 없는 목소리예요.");
};
$("#aiCaptions").oninput = () => {
  const p = state.registry.find((x) => x.no === state.picked[0]);
  if (p && state.ai[p.no]?.voice && !voiceFresh(p.no)) aiLog("voice", "✏️ 대본이 바뀌었어요. 🎙️ 목소리를 다시 만들어야 자막과 목소리가 맞아요.", "err");
};
["#aiTitle1", "#aiTitle2", "#aiCaptions"].forEach((s) => $(s).addEventListener("change", refreshPreview));

async function aiScriptStep() {
  const p = adProduct();
  if (!aiInfo.script) throw new Error("ANTHROPIC_API_KEY 를 Netlify 환경변수에 넣어 주세요.");
  aiLog("script", "✍️ AI가 대본을 쓰는 중…");
  const script = await ai.writeScript(p, $("#aiNotes").value, (sec) => aiLog("script", `✍️ AI가 대본을 쓰는 중… ${sec}초`));
  state.ai[p.no] = { ...state.ai[p.no], script };
  $("#aiTitle1").value = script.title_line1;
  $("#aiTitle2").value = script.title_line2;
  $("#aiCaptions").value = script.captions.join("\n");
  aiLog("script", `✅ 대본 완성 (${script.captions.length}줄)`, "ok");
  writeCopy();
  await refreshPreview();
  return script;
}

async function aiVoiceStep() {
  const p = adProduct();
  if (!aiInfo.voice) throw new Error("ELEVENLABS_API_KEY 를 Netlify 환경변수에 넣어 주세요.");
  const lines = captionLines();
  if (!lines.length) throw new Error("자막 대본이 비어 있어요.");
  const forText = $("#aiCaptions").value;
  aiLog("voice", "🎙️ AI 목소리 녹음 중…");
  const voice = await ai.makeVoice(lines, $("#aiVoice").value, (sec) => aiLog("voice", `🎙️ AI 목소리 녹음 중… ${sec}초`));
  state.ai[p.no] = { ...state.ai[p.no], voice: { ...voice, forText } };
  const d = voice.buffer.duration + 1.2;
  const note = d < 25 ? " — 25초보다 짧아요. 대본을 1~2줄 늘려 보세요." : d > 38 ? " — 조금 길어요. 대본을 줄여 보세요." : "";
  aiLog("voice", `✅ 목소리 완성 (영상 길이 약 ${d.toFixed(0)}초)${note}`, note ? "err" : "ok");
  await refreshPreview();
}

const DEFAULT_PROMPTS = [
  "slow cinematic push-in on the product in a bright cozy home, soft natural light, product stays identical",
  "smooth orbit camera around the product, realistic everyday use scene, warm tones, product stays identical",
  "close-up detail shot of the product texture with gentle camera slide, shallow depth of field, product stays identical",
];

async function aiClipsStep() {
  const p = adProduct();
  if (!aiInfo.video) throw new Error("HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET 를 Netlify 환경변수에 넣어 주세요.");
  if (!/^https:\/\//.test(p.image || "")) throw new Error("이 상품은 쿠팡 이미지 주소가 없어 AI 영상을 만들 수 없어요. (쿠팡 검색으로 등록한 상품만 가능)");
  const prompts = (state.ai[p.no]?.script?.video_prompts || DEFAULT_PROMPTS).slice(0, 3);
  let done = 0;
  const results = await Promise.allSettled(prompts.map((prompt, i) => {
    aiLog(`clip${i}`, `🎬 AI 영상 ${i + 1} 요청 중…`);
    return ai.makeClip(p.image, prompt, (status, sec) => aiLog(`clip${i}`, `🎬 AI 영상 ${i + 1}: ${status || "대기"} (${sec}초)`)).then(async (clip) => {
      state.media[p.no] = [...(state.media[p.no] || []), clip];
      aiLog(`clip${i}`, `✅ AI 영상 ${i + 1} 완성`, "ok");
      done++;
      renderPickList();
      await refreshPreview();
    }).catch((err) => {
      aiLog(`clip${i}`, `⚠️ AI 영상 ${i + 1} 실패: ${err.message}`, "err");
      throw err;
    });
  }));
  if (!done) throw new Error(results.find((r) => r.status === "rejected")?.reason?.message || "AI 영상을 만들지 못했어요.");
}

$("#aiScript").onclick = (e) => busy(e.target, aiScriptStep);
$("#aiSpeak").onclick = (e) => busy(e.target, aiVoiceStep);
$("#aiClips").onclick = (e) => busy(e.target, aiClipsStep);
$("#aiAll").onclick = (e) => busy(e.target, async () => {
  $("#aiLog").innerHTML = "";
  await aiScriptStep();
  // 목소리와 영상은 동시에 진행
  const jobs = [aiInfo.voice ? aiVoiceStep() : Promise.resolve(), aiInfo.video ? aiClipsStep() : Promise.resolve()];
  const results = await Promise.allSettled(jobs);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  toast("🎉 완성! ▶ 미리보기로 확인하고 ⏺ 영상 저장을 누르세요.", 5000);
});

// ---------- 4. 설정 ----------
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("복사했습니다.");
  } catch {
    prompt("복사하세요", text);
  }
}
$$("[data-copy]").forEach((b) => (b.onclick = (e) => {
  e.preventDefault();
  copy($("#" + b.dataset.copy).value);
}));
$("#adminKey").value = storage("adminKey") || "";
$("#saveKey").onclick = async () => {
  storage("adminKey", $("#adminKey").value);
  toast("저장했습니다.");
  await Promise.all([loadStatus(), loadRegistry(), loadAi()]);
};
$("#shopUrl").value = location.origin + "/shop";
$("#goExample").textContent = location.origin + "/go/1";
$("#snapBtn").onclick = (e) => busy(e.target, async () => {
  const data = await api("/api/coupang?type=snapshot", { method: "POST" });
  toast(`${data.date} 순위 저장 (${data.categories}개 카테고리)${data.errors.length ? " / 오류 " + data.errors.length : ""}`, 4000);
});

// ---------- 시작 ----------
setTemplate(state.template);
await Promise.all([loadStatus(), loadRegistry(), loadAi()]);
showTab(storage("tab") || "find");
