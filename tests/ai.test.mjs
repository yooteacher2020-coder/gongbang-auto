import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.LOCAL_DATA_DIR = mkdtempSync(path.join(tmpdir(), "gongbang-ai-"));
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.ELEVENLABS_API_KEY = "el-key";
process.env.HIGGSFIELD_KEY_ID = "kid";
process.env.HIGGSFIELD_KEY_SECRET = "ksecret";
delete process.env.ADMIN_PASSWORD;

const ai = await import("../netlify/functions/lib/ai.mjs");
const realFetch = globalThis.fetch;
const calls = [];
function mockFetch(handler) {
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const body = init.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    const call = { url, method: init.method ?? input.method ?? "GET", headers, body };
    calls.push(call);
    return handler(call);
  };
}
const jsonRes = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

test("AI 대본: Claude 요청 형식과 마지막 상품번호 문장", async () => {
  const script = {
    title_line1: "보일러 안 틀어도", title_line2: "*온돌*처럼 따뜻해요",
    captions: ["겨울 거실 바닥 얼음장 같아 *힘드셨죠*?", "이거 하나면 해결돼요"],
    youtube_title: "전기장판 #Shorts", description_intro: "겨울 필수템", hashtags: ["#전기장판"],
    pinned_comment: "상품번호 13번", video_prompts: ["a", "b", "c"],
  };
  mockFetch(() => jsonRes({
    id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify(script) }],
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
  }));
  const out = await ai.writeScript({ no: 13, name: "한일의료기 전기장판", price: 59000, image: "https://thumbnail.coupangcdn.com/a.jpg" }, "온도 6단계");
  const req = calls.at(-1);
  assert.match(req.url, /\/v1\/messages/);
  assert.match(req.headers.get("anthropic-beta"), /server-side-fallback-2026-07-01/);
  const body = JSON.parse(req.body);
  assert.equal(body.model, "claude-opus-5-5");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(body.messages[0].content[0].type, "image");
  assert.match(body.messages[0].content[1].text, /온도 6단계/);
  assert.equal(out.captions.at(-1), "상품번호 13번 고정댓글 링크에 있어요.");
});

test("AI 목소리: ElevenLabs 타임스탬프 요청", async () => {
  mockFetch(() => jsonRes({ audio_base64: "AAAA", alignment: { characters: ["가"], character_start_times_seconds: [0], character_end_times_seconds: [0.2] } }));
  const out = await ai.speak("안녕하세요", "voice123");
  const req = calls.at(-1);
  assert.match(req.url, /text-to-speech\/voice123\/with-timestamps/);
  assert.equal(req.headers.get("xi-api-key"), "el-key");
  assert.equal(JSON.parse(req.body).model_id, "eleven_multilingual_v2");
  assert.equal(out.audioBase64, "AAAA");
});

test("AI 영상: Higgsfield 요청과 상태 확인", async () => {
  mockFetch((c) => {
    if (c.method === "POST") return jsonRes({ request_id: "r1", status_url: "https://api.higgsfield.ai/requests/r1/status" });
    return jsonRes({ status: "completed", video: { url: "https://cdn.example.com/out.mp4" } });
  });
  const sub = await ai.submitVideo("https://thumbnail.coupangcdn.com/a.jpg", "slow push-in", 5);
  const post = calls.at(-1);
  assert.equal(post.url, "https://api.higgsfield.ai/kling-video/v3.0/std/image-to-video");
  assert.equal(post.headers.get("authorization"), "Key kid:ksecret");
  assert.deepEqual(JSON.parse(post.body), { image_url: "https://thumbnail.coupangcdn.com/a.jpg", prompt: "slow push-in", duration: 5, sound: "off" });
  const st = await ai.videoStatus(sub.statusUrl);
  assert.equal(st.videoUrl, "https://cdn.example.com/out.mp4");
  await assert.rejects(ai.videoStatus("https://evil.example.com/x"));
});

test("영상 주소 찾기: 다양한 응답 모양", () => {
  assert.equal(ai.findVideoUrl({ result: { videos: [{ url: "https://x.com/a.mp4?sig=1" }] } }), "https://x.com/a.mp4?sig=1");
  assert.equal(ai.findVideoUrl({ status: "queued" }), null);
});

test.after(() => (globalThis.fetch = realFetch));
