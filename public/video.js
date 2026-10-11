// 쇼츠 영상 렌더러: 1080x1920 캔버스에 그리고 MediaRecorder 로 녹화합니다.
export const W = 1080;
export const H = 1920;
const INTRO = 2;
const OUTRO = 2.8;
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
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = proxied(src);
  });
}

export async function prepare(products) {
  return Promise.all(products.map(async (p) => ({ ...p, img: await loadImage(p.image) })));
}

// spec: { template: "ranking"|"single", items, hook, cta, color, perItem, showPrice }
export function timeline(spec) {
  const segs = [{ type: "intro", start: 0, end: INTRO }];
  let t = INTRO;
  if (spec.template === "single") {
    const item = spec.items[0];
    segs.push({ type: "single", start: t, end: t + spec.perItem * 2, item });
    t += spec.perItem * 2;
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
  const push = (l) => lines.push(l);
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) push(line);
    line = "";
    // 한 단어가 너무 길면 글자 단위로 자릅니다.
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > maxWidth) {
        push(line);
        line = ch;
      } else line += ch;
    }
  }
  if (line) push(line);
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
  roundRect(ctx, 70, 120, 940, 40 + lines.length * 34, 16);
  ctx.fill();
  lines.forEach((l, i) => text(ctx, l, W / 2, 158 + i * 34, { size: 26, weight: 500, color: "rgba(255,255,255,.9)" }));
}

function productImage(ctx, img, x, y, size, zoom) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 40;
  ctx.fillStyle = "#fff";
  roundRect(ctx, x, y, size, size, 48);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.clip();
  if (img) {
    const s = Math.min(size / img.width, size / img.height) * zoom * 0.92;
    const w = img.width * s;
    const h = img.height * s;
    ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
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

function productScene(ctx, spec, item, local, dur, rank) {
  // 화면 밖에서 시작하지 않도록 35% 지점에서 미끄러져 들어옵니다(프레임이 빠져도 빈 화면이 안 보임).
  const enter = ease(local / 0.4);
  ctx.save();
  ctx.translate((1 - enter) * W * 0.35, 0);
  ctx.globalAlpha = 0.4 + 0.6 * enter;

  if (rank) {
    ctx.fillStyle = "#111";
    roundRect(ctx, 80, 250, 230, 120, 30);
    ctx.fill();
    text(ctx, `${rank}위`, 195, 312, { size: 80, weight: 900, color: "#ffe600" });
    if (item.category) text(ctx, item.category, 1000, 312, { size: 40, weight: 700, align: "right", color: "rgba(255,255,255,.85)" });
  }

  const zoom = 1 + 0.08 * (local / dur);
  productImage(ctx, item.img, 110, 410, 860, zoom);

  ctx.font = `800 64px ${FONT}`;
  const lines = wrap(ctx, item.name, 940, 2);
  const fade = ease((local - 0.25) / 0.4);
  ctx.globalAlpha = 0.25 + 0.75 * fade;
  lines.forEach((l, i) => text(ctx, l, W / 2, 1360 + i * 82, { size: 64, stroke: 10, strokeColor: "rgba(0,0,0,.45)" }));
  if (spec.showPrice && item.price) {
    text(ctx, won(item.price), W / 2, 1360 + lines.length * 82 + 30, { size: 72, weight: 900, color: "#ffe600", stroke: 10, strokeColor: "rgba(0,0,0,.45)" });
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  if (local > 0.5) numberBadge(ctx, item.no, 1690, local / 1.2);
}

export function drawFrame(ctx, spec, tl, t) {
  background(ctx, spec.color, t);
  const seg = tl.segs.find((s) => t >= s.start && t < s.end) || tl.segs[tl.segs.length - 1];
  const local = t - seg.start;
  const dur = seg.end - seg.start;

  if (seg.type === "intro") {
    const first = spec.items[0];
    if (first?.img) {
      ctx.globalAlpha = 0.25;
      productImage(ctx, first.img, 110, 520, 860, 1 + local * 0.03);
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
    productScene(ctx, spec, seg.item, local, dur, seg.rank);
  } else if (seg.type === "single") {
    productScene(ctx, spec, seg.item, local, dur, null);
  } else if (seg.type === "outro") {
    const a = ease(local / 0.4);
    ctx.globalAlpha = a;
    ctx.font = `900 92px ${FONT}`;
    const lines = wrap(ctx, spec.cta, 920, 2);
    lines.forEach((l, i) => text(ctx, l, W / 2, 470 + i * 116, { size: 92, weight: 900, stroke: 14, strokeColor: "#000" }));
    const list = spec.template === "single" ? [{ label: "이 상품", no: spec.items[0].no }] : spec.items.map((p, i) => ({ label: `${i + 1}위`, no: p.no }));
    const top = 470 + lines.length * 116 + 90;
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
  disclosure(ctx);
}

export function play(canvas, spec, onDone) {
  const ctx = canvas.getContext("2d");
  const tl = timeline(spec);
  const start = performance.now();
  let raf;
  const loop = () => {
    const t = (performance.now() - start) / 1000;
    drawFrame(ctx, spec, tl, Math.min(t, tl.total - 0.001));
    if (t < tl.total) raf = requestAnimationFrame(loop);
    else onDone?.();
  };
  loop();
  return () => cancelAnimationFrame(raf);
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
  let audioCtx;
  let source;
  if (bgmFile) {
    audioCtx = new AudioContext();
    const buffer = await audioCtx.decodeAudioData(await bgmFile.arrayBuffer());
    source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(0.8, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.8, audioCtx.currentTime + tl.total - 1);
    gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + tl.total);
    const dest = audioCtx.createMediaStreamDestination();
    source.connect(gain).connect(dest);
    dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  }

  const mimeType = pickMime();
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (recorder.onstop = r));

  const ctx = canvas.getContext("2d");
  drawFrame(ctx, spec, tl, 0);
  recorder.start(250);
  source?.start();
  const start = performance.now();
  await new Promise((resolve) => {
    const loop = () => {
      const t = (performance.now() - start) / 1000;
      drawFrame(ctx, spec, tl, Math.min(t, tl.total - 0.001));
      onProgress?.(Math.min(t / tl.total, 1));
      if (t < tl.total) requestAnimationFrame(loop);
      else resolve();
    };
    loop();
  });
  recorder.stop();
  await stopped;
  source?.stop();
  audioCtx?.close();
  stream.getTracks().forEach((track) => track.stop());
  const type = mimeType.split(";")[0] || "video/webm";
  return { blob: new Blob(chunks, { type }), ext: type.includes("mp4") ? "mp4" : "webm", duration: tl.total };
}
