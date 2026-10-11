// 쇼츠 영상 렌더러: 1080x1920 캔버스에 그리고 MediaRecorder 로 녹화합니다.
export const W = 1080;
export const H = 1920;
export const INTRO = 2.5;
export const OUTRO = 3.5;
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
export const DISCLOSURE = "이 영상은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

// 쿠팡 CDN 이미지는 프록시를 거쳐야 캔버스 녹화가 가능합니다(CORS).
export function proxied(src) {
  if (!src) return "";
  if (src.startsWith("//")) src = "https:" + src;
  if (src.startsWith("/") || src.startsWith("data:") || src.startsWith("blob:")) return src;
  return "/api/img?url=" + encodeURIComponent(src);
}

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = proxied(src);
  });
}

// 내 컴퓨터에서 올린 사진/영상 파일 → 캔버스에 그릴 수 있는 요소
export function loadFile(file) {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith("video/")) {
    return new Promise((resolve) => {
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.loop = true;
      v.preload = "auto";
      v.onloadeddata = () => resolve({ kind: "video", el: v, name: file.name });
      v.onerror = () => resolve(null);
      v.src = url;
    });
  }
  return loadImage(url).then((img) => img && { kind: "image", el: img, name: file.name });
}

// products: [{..., image}], media: { [no]: [{kind, el}] }, scripts: { [no]: [줄...] }
export async function prepare(products, media = {}, scripts = {}) {
  return Promise.all(products.map(async (p) => {
    const img = await loadImage(p.image);
    const list = [...(img ? [{ kind: "image", el: img }] : []), ...(media[p.no] || [])];
    return { ...p, img, media: list, script: scripts[p.no] || [] };
  }));
}

// spec: { template, items, hook, cta, color, perItem, showPrice, showDisclosure }
export function timeline(spec) {
  if (spec.template === "ad") {
    const total = spec.ad.duration;
    return { segs: [{ type: "ad", start: 0, end: total, item: spec.items[0] }], total };
  }
  const segs = [{ type: "intro", start: 0, end: INTRO }];
  let t = INTRO;
  if (spec.template === "single") {
    segs.push({ type: "single", start: t, end: t + spec.perItem, item: spec.items[0] });
    t += spec.perItem;
  } else {
    // 랭킹은 N위 → 1위 순서로 카운트다운
    const n = spec.items.length;
    spec.items.slice().reverse().forEach((item, i) => {
      segs.push({ type: "rank", start: t, end: t + spec.perItem, item, rank: n - i });
      t += spec.perItem;
    });
  }
  segs.push({ type: "outro", start: t, end: t + OUTRO });
  return { segs, total: t + OUTRO };
}

const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
const won = (n) => Number(n || 0).toLocaleString("ko-KR") + "원";

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    // 한 단어가 너무 길면 글자 단위로 자릅니다.
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + "…").width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + "…";
  }
  return lines;
}

function text(ctx, str, x, y, { size = 60, weight = 800, color = "#fff", align = "center", stroke = 0, strokeColor = "#000" } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if (stroke) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = strokeColor;
    ctx.lineJoin = "round";
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function background(ctx, color, t) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, shade(color, 30));
  g.addColorStop(1, shade(color, -70));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // 은은하게 움직이는 원
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 5; i++) {
    const x = (W * ((i * 0.27 + t * 0.03) % 1.2)) - 100;
    const y = 300 + i * 330 + Math.sin(t + i) * 40;
    ctx.beginPath();
    ctx.arc(x, y, 120 + i * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function disclosure(ctx) {
  ctx.font = `500 26px ${FONT}`;
  const lines = wrap(ctx, DISCLOSURE, 900, 2);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  roundRect(ctx, 70, 1800, 940, 30 + lines.length * 32, 16);
  ctx.fill();
  lines.forEach((l, i) => text(ctx, l, W / 2, 1832 + i * 32, { size: 24, weight: 500, color: "rgba(255,255,255,.85)" }));
}

// 녹화/재생 중인 영상 클립은 하나만 재생합니다.
let activeVideo = null;
function useVideo(el, playing) {
  if (activeVideo && activeVideo !== el) activeVideo.pause();
  if (activeVideo !== el && el) el.currentTime = 0;
  activeVideo = el;
  if (el && playing && el.paused) el.play().catch(() => {});
}
export function stopVideos() {
  activeVideo?.pause();
  activeVideo = null;
}

// 사진은 잘리지 않게(contain), 영상은 꽉 차게(cover) 그립니다. zoom/pan 으로 움직임을 줍니다.
function drawMedia(ctx, m, x, y, size, progress, playing) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#fff";
  roundRect(ctx, x, y, size, size, 48);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.clip();
  if (m) {
    const el = m.el;
    const iw = m.kind === "video" ? el.videoWidth : el.width;
    const ih = m.kind === "video" ? el.videoHeight : el.height;
    if (m.kind === "video") useVideo(el, playing);
    if (iw && ih) {
      const zoom = 1 + 0.12 * progress;
      const base = m.kind === "video" ? Math.max(size / iw, size / ih) : Math.min(size / iw, size / ih) * 0.92;
      const s = base * zoom;
      const w = iw * s;
      const h = ih * s;
      const pan = (progress - 0.5) * size * 0.04;
      ctx.drawImage(el, x + (size - w) / 2 + pan, y + (size - h) / 2, w, h);
    }
  }
  ctx.restore();
}

function numberBadge(ctx, no, y, pulse) {
  const label = `상품번호 ${no}`;
  ctx.font = `900 76px ${FONT}`;
  const w = ctx.measureText(label).width + 110;
  const s = 1 + Math.sin(pulse * Math.PI * 2) * 0.03;
  ctx.save();
  ctx.translate(W / 2, y);
  ctx.scale(s, s);
  ctx.fillStyle = "#ffe600";
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 24;
  roundRect(ctx, -w / 2, -64, w, 128, 64);
  ctx.fill();
  ctx.shadowBlur = 0;
  text(ctx, label, 0, 4, { size: 76, weight: 900, color: "#111" });
  ctx.restore();
}

// 대본 자막: 줄마다 시간을 나눠 하나씩 보여줍니다.
function caption(ctx, lines, local, dur) {
  if (!lines.length) return;
  const slot = dur / lines.length;
  const i = Math.min(Math.floor(local / slot), lines.length - 1);
  const k = local - i * slot;
  const pop = ease(k / 0.25);
  ctx.font = `900 70px ${FONT}`;
  const rows = wrap(ctx, lines[i], 900, 2);
  const h = rows.length * 88 + 40;
  const y = 1420 - h / 2;
  ctx.save();
  ctx.globalAlpha = 0.3 + 0.7 * pop;
  ctx.translate(W / 2, 1420);
  ctx.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop);
  ctx.translate(-W / 2, -1420);
  ctx.fillStyle = "rgba(0,0,0,.6)";
  roundRect(ctx, 70, y, 940, h, 34);
  ctx.fill();
  rows.forEach((r, j) => text(ctx, r, W / 2, y + 20 + 44 + j * 88, { size: 70, weight: 900, color: j === 0 && i === 0 ? "#ffe600" : "#fff" }));
  ctx.restore();
}

function productScene(ctx, spec, item, local, dur, rank, playing) {
  const enter = ease(local / 0.4);
  ctx.save();
  // 화면 밖에서 시작하지 않도록 35% 지점에서 미끄러져 들어옵니다(프레임이 빠져도 빈 화면이 안 보임).
  ctx.translate((1 - enter) * W * 0.35, 0);
  ctx.globalAlpha = 0.4 + 0.6 * enter;

  if (rank) {
    ctx.fillStyle = "#111";
    roundRect(ctx, 80, 130, 230, 120, 30);
    ctx.fill();
    text(ctx, `${rank}위`, 195, 192, { size: 80, weight: 900, color: "#ffe600" });
  }

  // 사진/영상이 여러 개면 일정 간격으로 넘깁니다.
  const media = item.media.length ? item.media : [null];
  const slot = dur / media.length;
  const mi = Math.min(Math.floor(local / slot), media.length - 1);
  const mp = (local - mi * slot) / slot;
  drawMedia(ctx, media[mi], 140, 290, 800, mp, playing);
  if (media.length > 1) {
    media.forEach((_, i) => {
      ctx.fillStyle = i === mi ? "#fff" : "rgba(255,255,255,.4)";
      ctx.beginPath();
      ctx.arc(W / 2 + (i - (media.length - 1) / 2) * 30, 1120, 9, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.font = `800 52px ${FONT}`;
  const name = wrap(ctx, item.name, 960, 1)[0] || "";
  text(ctx, name, W / 2, 1185, { size: 52, stroke: 10, strokeColor: "rgba(0,0,0,.45)" });
  if (spec.showPrice && item.price) {
    text(ctx, won(item.price), W / 2, 1262, { size: 64, weight: 900, color: "#ffe600", stroke: 10, strokeColor: "rgba(0,0,0,.45)" });
  }
  ctx.restore();

  caption(ctx, item.script, local, dur);
  if (local > 0.5) numberBadge(ctx, item.no, 1620, local / 1.2);
}

// ---------------- 광고형 템플릿 (상단 고정 제목 + 상품번호 + 꽉 찬 영상 + 목소리 자막) ----------------
// *별표* 로 감싼 단어는 강조색으로 그립니다.
function markedWords(str) {
  const words = [];
  let mark = false;
  for (const raw of String(str || "").split(/(\*)/)) {
    if (raw === "*") {
      mark = !mark;
      continue;
    }
    raw.split(/(\s+)/).forEach((w, i) => {
      if (!w) return;
      if (/^\s+$/.test(w)) words.push({ space: true });
      else if (i === 0 && words.length && !words[words.length - 1].space) words[words.length - 1].parts.push({ text: w, mark });
      else words.push({ parts: [{ text: w, mark }] });
    });
  }
  return words.filter((w) => !w.space);
}

function richLines(ctx, str, maxWidth, maxLines) {
  const words = markedWords(str);
  const width = (w) => ctx.measureText(w.parts.map((p) => p.text).join("")).width;
  const space = ctx.measureText(" ").width;
  const lines = [];
  let line = [];
  let lw = 0;
  for (const w of words) {
    const ww = width(w);
    if (line.length && lw + space + ww > maxWidth) {
      lines.push(line);
      line = [];
      lw = 0;
    }
    lw += (line.length ? space : 0) + ww;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawRichLine(ctx, line, cx, y, { color, markColor, stroke = 0, strokeColor = "#000" }) {
  const space = ctx.measureText(" ").width;
  const segs = [];
  line.forEach((w, i) => {
    if (i) segs.push({ text: " ", w: space, mark: false });
    w.parts.forEach((p) => segs.push({ ...p, w: ctx.measureText(p.text).width }));
  });
  const total = segs.reduce((a, b) => a + b.w, 0);
  let x = cx - total / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const seg of segs) {
    if (stroke) {
      ctx.lineWidth = stroke;
      ctx.strokeStyle = strokeColor;
      ctx.lineJoin = "round";
      ctx.strokeText(seg.text, x, y);
    }
    ctx.fillStyle = seg.mark ? markColor : color;
    ctx.fillText(seg.text, x, y);
    x += seg.w;
  }
  return total;
}

function mediaSize(m) {
  return m.kind === "video" ? [m.el.videoWidth, m.el.videoHeight] : [m.el.width, m.el.height];
}

function drawCover(ctx, m, x, y, w, h, zoom = 1) {
  const [iw, ih] = mediaSize(m);
  if (!iw || !ih) return;
  const s = Math.max(w / iw, h / ih) * zoom;
  ctx.drawImage(m.el, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
}

function titleBox(ctx, str, cy) {
  ctx.font = `900 84px ${FONT}`;
  const line = richLines(ctx, str, 960, 1)[0] || [];
  const w = Math.min(1010, ctx.measureText(line.map((x) => x.parts.map((p) => p.text).join("")).join(" ")).width + 70);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.25)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = "#fff";
  roundRect(ctx, W / 2 - w / 2, cy - 64, w, 128, 20);
  ctx.fill();
  ctx.restore();
  ctx.font = `900 84px ${FONT}`;
  drawRichLine(ctx, line, W / 2, cy + 4, { color: "#111", markColor: "#e8212b" });
}

function drawAd(ctx, spec, total, t, playing) {
  const item = spec.items[0];
  const ad = spec.ad;
  const media = item.media.length ? item.media : [];
  const slot = media.length ? Math.min(5.5, Math.max(3, total / media.length)) : total;
  const mi = media.length ? Math.floor(t / slot) % media.length : -1;
  const m = media[mi];
  const mp = media.length ? (t % slot) / slot : 0;
  if (m?.kind === "video") useVideo(m.el, playing);

  // 배경: 같은 장면을 흐리게
  ctx.fillStyle = "#1b1b1b";
  ctx.fillRect(0, 0, W, H);
  if (m) {
    ctx.save();
    ctx.filter = "blur(36px) brightness(0.65)";
    drawCover(ctx, m, -60, -60, W + 120, H + 120, 1.05);
    ctx.restore();
  }
  // 가운데 꽉 찬 상품 장면
  const top = 560;
  const height = 960;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, W, height);
  ctx.clip();
  if (m) drawCover(ctx, m, 0, top, W, height, 1 + 0.1 * mp);
  ctx.restore();

  // 상단 고정 제목 2줄 + 상품번호
  titleBox(ctx, ad.title1, 215);
  titleBox(ctx, ad.title2, 357);
  const pill = `상품번호 ${item.no}번`;
  ctx.font = `900 50px ${FONT}`;
  const pw = ctx.measureText(pill).width + 64;
  ctx.fillStyle = "#ffd43b";
  roundRect(ctx, W / 2 - pw / 2, 440, pw, 84, 42);
  ctx.fill();
  text(ctx, pill, W / 2, 484, { size: 50, weight: 900, color: "#222" });

  // 목소리에 맞춘 자막
  const cap = ad.captions.find((c) => t >= c.start && t < c.end) || (t < (ad.captions[0]?.start ?? 0) ? null : ad.captions[ad.captions.length - 1]);
  if (cap) {
    const k = t - cap.start;
    const pop = ease(k / 0.18);
    ctx.save();
    ctx.translate(W / 2, 1330);
    ctx.scale(0.92 + 0.08 * pop, 0.92 + 0.08 * pop);
    ctx.font = `900 74px ${FONT}`;
    const lines = richLines(ctx, cap.text, 980, 2);
    lines.forEach((line, i) => {
      ctx.font = `900 74px ${FONT}`;
      drawRichLine(ctx, line, 0, (i - (lines.length - 1) / 2) * 94, { color: "#fff", markColor: "#ffe14d", stroke: 13, strokeColor: "#000" });
    });
    ctx.restore();
  }

  // 마지막 안내 카드
  const endStart = total - 3.2;
  if (t >= endStart) {
    const a = ease((t - endStart) / 0.3);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(0, (1 - a) * 40);
    ctx.shadowColor = "rgba(0,0,0,.3)";
    ctx.shadowBlur = 24;
    ctx.fillStyle = "#fff";
    roundRect(ctx, 150, 1560, 780, 170, 28);
    ctx.fill();
    ctx.shadowBlur = 0;
    text(ctx, `📌 상품번호 ${item.no}번`, W / 2, 1618, { size: 54, weight: 900, color: "#e8212b" });
    text(ctx, spec.cta || "고정댓글 링크 확인 👇", W / 2, 1688, { size: 40, weight: 700, color: "#222" });
    ctx.restore();
  }
}

export function drawFrame(ctx, spec, tl, t, playing = false) {
  if (spec.template === "ad") {
    drawAd(ctx, spec, tl.total, t, playing);
    if (spec.showDisclosure) disclosure(ctx);
    return;
  }
  background(ctx, spec.color, t);
  const seg = tl.segs.find((s) => t >= s.start && t < s.end) || tl.segs[tl.segs.length - 1];
  const local = t - seg.start;
  const dur = seg.end - seg.start;

  if (seg.type === "intro") {
    stopVideos();
    const first = spec.template === "single" ? spec.items[0] : spec.items[spec.items.length - 1];
    if (first?.img) {
      ctx.globalAlpha = 0.3;
      drawMedia(ctx, { kind: "image", el: first.img }, 140, 520, 800, local / dur, false);
      ctx.globalAlpha = 1;
    }
    const pop = ease(local / 0.35);
    ctx.save();
    ctx.translate(W / 2, 900);
    ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
    ctx.font = `900 104px ${FONT}`;
    const lines = wrap(ctx, spec.hook, 940, 3);
    lines.forEach((l, i) => text(ctx, l, 0, (i - (lines.length - 1) / 2) * 130, { size: 104, weight: 900, stroke: 16, strokeColor: "#000" }));
    ctx.restore();
    if (spec.template === "ranking") {
      text(ctx, `TOP ${spec.items.length}`, W / 2, 1300, { size: 150, weight: 900, color: "#ffe600", stroke: 18, strokeColor: "#000" });
    }
  } else if (seg.type === "rank") {
    productScene(ctx, spec, seg.item, local, dur, seg.rank, playing);
  } else if (seg.type === "single") {
    productScene(ctx, spec, seg.item, local, dur, null, playing);
  } else if (seg.type === "outro") {
    stopVideos();
    const a = ease(local / 0.4);
    ctx.globalAlpha = a;
    ctx.font = `900 92px ${FONT}`;
    const lines = wrap(ctx, spec.cta, 920, 2);
    lines.forEach((l, i) => text(ctx, l, W / 2, 380 + i * 116, { size: 92, weight: 900, stroke: 14, strokeColor: "#000" }));
    const list = spec.template === "single" ? [{ label: "이 상품", no: spec.items[0].no }] : spec.items.map((p, i) => ({ label: `${i + 1}위`, no: p.no }));
    const top = 380 + lines.length * 116 + 90;
    const rowH = Math.min(150, 900 / list.length);
    list.forEach((r, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = "rgba(0,0,0,.4)";
      roundRect(ctx, 140, y - rowH * 0.4, 800, rowH * 0.8, 30);
      ctx.fill();
      text(ctx, r.label, 200, y, { size: Math.min(64, rowH * 0.45), align: "left" });
      text(ctx, `상품번호 ${r.no}`, 880, y, { size: Math.min(64, rowH * 0.45), weight: 900, align: "right", color: "#ffe600" });
    });
    ctx.globalAlpha = 1;
  }
  if (spec.showDisclosure) disclosure(ctx);
}

// 목소리(spec.voice: AudioBuffer)와 배경음악을 함께 재생합니다. 목소리가 있으면 배경음악은 작게 깔립니다.
async function startAudio(audioCtx, spec, bgmFile, total, out) {
  const sources = [];
  if (spec.voice) {
    const src = audioCtx.createBufferSource();
    src.buffer = spec.voice;
    src.connect(out);
    sources.push(src);
  }
  if (bgmFile) {
    const buffer = await audioCtx.decodeAudioData(await bgmFile.arrayBuffer());
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = audioCtx.createGain();
    const level = spec.voice ? 0.13 : 0.8;
    const now = audioCtx.currentTime;
    gain.gain.setValueAtTime(level, now);
    gain.gain.setValueAtTime(level, now + Math.max(0, total - 1));
    gain.gain.linearRampToValueAtTime(0, now + total);
    src.connect(gain).connect(out);
    sources.push(src);
  }
  sources.forEach((src) => src.start());
  return () => sources.forEach((src) => {
    try {
      src.stop();
    } catch {
      // 이미 멈춤
    }
  });
}

export async function play(canvas, spec, onDone, { bgmFile } = {}) {
  const ctx = canvas.getContext("2d");
  const tl = timeline(spec);
  const audioCtx = new AudioContext();
  const stopAudio = await startAudio(audioCtx, spec, bgmFile, tl.total, audioCtx.destination);
  const start = performance.now();
  let raf;
  const finish = () => {
    cancelAnimationFrame(raf);
    stopVideos();
    stopAudio();
    audioCtx.close();
  };
  const loop = () => {
    const t = (performance.now() - start) / 1000;
    drawFrame(ctx, spec, tl, Math.min(t, tl.total - 0.001), true);
    if (t < tl.total) raf = requestAnimationFrame(loop);
    else {
      finish();
      onDone?.();
    }
  };
  loop();
  return finish;
}

export function pickMime() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
}

export async function record(canvas, spec, { bgmFile, onProgress } = {}) {
  if (!window.MediaRecorder) throw new Error("이 브라우저는 영상 녹화를 지원하지 않습니다. PC 크롬을 사용하세요.");
  const tl = timeline(spec);
  const stream = canvas.captureStream(30);
  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  if (spec.voice || bgmFile) dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (recorder.onstop = r));

  const ctx = canvas.getContext("2d");
  drawFrame(ctx, spec, tl, 0, true);
  recorder.start(250);
  const stopAudio = await startAudio(audioCtx, spec, bgmFile, tl.total, dest);
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      drawFrame(ctx, spec, tl, Math.min(t, tl.total - 0.001), true);
      onProgress?.(Math.min(t / tl.total, 1));
      if (t < tl.total) requestAnimationFrame(loop);
      else resolve();
    };
    loop();
  });
  recorder.stop();
  await stopped;
  stopVideos();
  stopAudio();
  audioCtx.close();
  stream.getTracks().forEach((track) => track.stop());
  const type = mimeType.split(";")[0] || "video/webm";
  return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm", duration: tl.total };
}
