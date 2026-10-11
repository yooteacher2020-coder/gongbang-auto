// 오래 걸리는 AI 작업(대본, 목소리)을 백그라운드로 처리하고 결과를 저장합니다.
// POST /.netlify/functions/ai-background  {jobId, kind: "script"|"voice", ...}
// 결과는 GET /api/ai?job=<jobId> 로 확인합니다.
import { isAdmin } from "./lib/http.mjs";
import { openStore } from "./lib/store.mjs";
import { writeScript, speak } from "./lib/ai.mjs";

export default async (req) => {
  if (!isAdmin(req)) return;
  const body = await req.json();
  if (!/^[a-z0-9-]{8,64}$/.test(body.jobId || "")) return;
  const jobs = await openStore("jobs");
  await jobs.setJSON(body.jobId, { status: "running", startedAt: Date.now() });
  try {
    let result;
    if (body.kind === "script") result = await writeScript(body.product, body.notes);
    else if (body.kind === "voice") result = await speak(body.text, body.voiceId);
    else throw new Error(`알 수 없는 작업: ${body.kind}`);
    await jobs.setJSON(body.jobId, { status: "done", result, finishedAt: Date.now() });
  } catch (err) {
    await jobs.setJSON(body.jobId, { status: "error", error: err.message, finishedAt: Date.now() });
  }
};
