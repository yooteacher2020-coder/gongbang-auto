// GET  /api/ai?type=status                 AI 키 설정 상태
// GET  /api/ai?type=voices                 ElevenLabs 목소리 목록
// GET  /api/ai?job=<id>                    백그라운드 작업(대본/목소리) 결과
// POST /api/ai?type=video  {imageUrl, prompt, duration}  Higgsfield 영상 생성 요청
// GET  /api/ai?type=video-status&url=...   Higgsfield 진행 상태
import { json, error, requireAdmin } from "./lib/http.mjs";
import { openStore } from "./lib/store.mjs";
import { aiStatus, listVoices, submitVideo, videoStatus } from "./lib/ai.mjs";

export default async (req) => {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = aiStatus();

  try {
    const job = url.searchParams.get("job");
    if (job) {
      const data = await (await openStore("jobs")).getJSON(job);
      return json({ ok: true, ...(data || { status: "pending" }) });
    }
    if (type === "status") return json({ ok: true, ...status });

    if (type === "voices") {
      if (!status.voice) return error("ELEVENLABS_API_KEY 가 설정되지 않았습니다.");
      return json({ ok: true, voices: await listVoices() });
    }

    if (type === "video") {
      if (!status.video) return error("HIGGSFIELD_KEY_ID / HIGGSFIELD_KEY_SECRET 이 설정되지 않았습니다.");
      const { imageUrl, prompt, duration } = await req.json();
      if (!/^https:\/\//.test(imageUrl || "")) return error("상품 이미지가 https 주소여야 AI 영상을 만들 수 있습니다.");
      return json({ ok: true, ...(await submitVideo(imageUrl, String(prompt || "").slice(0, 2400), Number(duration) || 5)) });
    }

    if (type === "video-status") {
      return json({ ok: true, ...(await videoStatus(url.searchParams.get("url"))) });
    }
    return error(`알 수 없는 type: ${type}`);
  } catch (err) {
    return error(err.message, 502);
  }
};

export const config = { path: "/api/ai" };
