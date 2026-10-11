// 브라우저 쪽 AI 제작 흐름: 대본 → 목소리 → 상품 영상 클립
import { loadFile } from "./video.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stripMarks = (s) => String(s || "").replace(/\*/g, "");

function adminHeaders() {
  let key = "";
  try {
    key = localStorage.getItem("adminKey") || "";
  } catch {
    // 저장소 사용 불가
  }
  return { "content-type": "application/json", "x-admin-key": key };
}

async function getJSON(url, init) {
  const res = await fetch(url, { ...init, headers: { ...adminHeaders(), ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({ ok: false, error: `서버 오류 (${res.status})` }));
  if (!res.ok || data.ok === false) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const aiStatus = () => getJSON("/api/ai?type=status");
export const voices = () => getJSON("/api/ai?type=voices").then((d) => d.voices);

// 오래 걸리는 작업은 백그라운드 함수로 보내고 결과를 기다립니다.
async function runJob(kind, payload, { timeoutMs = 240_000, onTick } = {}) {
  const jobId = crypto.randomUUID();
  const res = await fetch("/.netlify/functions/ai-background", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ jobId, kind, ...payload }),
  });
  if (res.status === 401) throw new Error("관리자 비밀번호가 필요합니다.");
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    await sleep(2000);
    onTick?.(Math.round((Date.now() - started) / 1000));
    const job = await getJSON(`/api/ai?job=${jobId}`);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
  }
  throw new Error("AI 작업 시간이 너무 오래 걸립니다. 다시 시도해 주세요.");
}

export function writeScript(product, notes, onTick) {
  return runJob("script", { product, notes }, { onTick });
}

// 자막 줄들을 한 번에 읽히고, 글자 타이밍으로 각 줄의 시작/끝 시각을 계산합니다.
export async function makeVoice(captions, voiceId, onTick) {
  const plain = captions.map(stripMarks);
  const text = plain.join(" ");
  const { audioBase64, alignment } = await runJob("voice", { text, voiceId }, { onTick });
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  const audioCtx = new AudioContext();
  const buffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
  audioCtx.close();
  return { buffer, base64: audioBase64, timings: captionTimings(captions, plain, alignment, buffer.duration) };
}

export function captionTimings(captions, plain, alignment, duration) {
  const starts = alignment?.character_start_times_seconds || [];
  const chars = alignment?.characters || [];
  const joined = plain.join(" ");
  const exact = chars.length === joined.length;
  const out = [];
  let offset = 0;
  plain.forEach((line, i) => {
    let start;
    if (exact) {
      // 줄 첫 글자(공백 제외)의 시작 시각
      let k = offset;
      while (k < offset + line.length && /\s/.test(joined[k])) k++;
      start = starts[k] ?? 0;
    } else {
      start = (offset / joined.length) * duration;
    }
    out.push({ text: captions[i], start });
    offset += line.length + 1;
  });
  out.forEach((c, i) => (c.end = i + 1 < out.length ? out[i + 1].start : duration + 3.5));
  if (out.length) out[0].start = 0;
  return out;
}

// Higgsfield: 상품 사진 → 5초 영상. 다 만들어지면 캔버스용 <video> 로 불러옵니다.
export async function makeClip(imageUrl, prompt, onStatus) {
  const { statusUrl } = await getJSON("/api/ai?type=video", {
    method: "POST",
    body: JSON.stringify({ imageUrl, prompt, duration: 5 }),
  });
  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    await sleep(8000);
    const st = await getJSON(`/api/ai?type=video-status&url=${encodeURIComponent(statusUrl)}`);
    onStatus?.(st.status, Math.round((Date.now() - started) / 1000));
    if (st.videoUrl) return loadRemoteVideo(st.videoUrl);
    if (["failed", "nsfw", "canceled", "cancelled"].includes(st.status)) throw new Error(`AI 영상 생성 실패 (${st.status})`);
    if (st.status === "completed") throw new Error("AI 영상은 완료됐는데 영상 주소를 찾지 못했습니다.");
  }
  throw new Error("AI 영상 생성이 15분을 넘겼습니다.");
}

async function loadRemoteVideo(url) {
  let blob;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error();
    blob = await res.blob();
  } catch {
    const res = await fetch(`/api/media?url=${encodeURIComponent(url)}`, { headers: adminHeaders() });
    if (!res.ok) throw new Error(`AI 영상 파일을 받지 못했습니다 (${res.status})`);
    blob = await res.blob();
  }
  const file = new File([blob], "ai-clip.mp4", { type: blob.type || "video/mp4" });
  const media = await loadFile(file);
  if (!media) throw new Error("AI 영상 파일을 열 수 없습니다.");
  return { ...media, ai: true, sourceUrl: url };
}
