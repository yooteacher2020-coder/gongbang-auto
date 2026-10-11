// AI 연동: 대본(Claude), 목소리(ElevenLabs), 상품 영상(Higgsfield)
import Anthropic from "@anthropic-ai/sdk";

export function aiStatus() {
  return {
    script: Boolean(process.env.ANTHROPIC_API_KEY),
    voice: Boolean(process.env.ELEVENLABS_API_KEY),
    video: Boolean(process.env.HIGGSFIELD_KEY_ID && process.env.HIGGSFIELD_KEY_SECRET),
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID || "",
  };
}

// ---------------- 대본 (Claude) ----------------
const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    title_line1: { type: "string", description: "화면 상단 고정 제목 1줄째, 공백 포함 11자 이내" },
    title_line2: { type: "string", description: "상단 제목 2줄째, 11자 이내. 핵심 단어 하나를 *별표*로 감싼다" },
    captions: {
      type: "array",
      items: { type: "string" },
      description: "성우가 읽고 자막으로 나갈 문장들. 10~13개, 각 22자 이내. 줄마다 핵심 단어 하나를 *별표*로 감싼다",
    },
    youtube_title: { type: "string", description: "유튜브 제목, 60자 이내, #Shorts 포함" },
    description_intro: { type: "string", description: "설명란 첫 2~3줄" },
    hashtags: { type: "array", items: { type: "string" }, description: "해시태그 5~8개, # 포함" },
    pinned_comment: { type: "string", description: "고정 댓글 본문(링크 제외), 2~3줄" },
    video_prompts: {
      type: "array",
      items: { type: "string" },
      description: "상품 사진을 첫 프레임으로 쓰는 image-to-video 프롬프트 3개(영어)",
    },
  },
  required: ["title_line1", "title_line2", "captions", "youtube_title", "description_intro", "hashtags", "pinned_comment", "video_prompts"],
  additionalProperties: false,
};

const SYSTEM = `당신은 한국 유튜브 쇼핑 쇼츠(쿠팡 파트너스) 전문 대본 작가입니다.
30초 안팎(성우 낭독 기준 공백 포함 180~230자)의 대본을 씁니다.

목표: 보는 사람이 "이거 나한테 필요하다, 지금 사야겠다"고 느끼게 만드는 것.

설득 구조(이 순서를 지킬 것):
1. 후킹(1줄): 시청자가 실제로 겪는 구체적인 불편 장면을 콕 집는다. 예: "겨울 거실 바닥 얼음장 같아 힘드셨죠?"
2. 공감·자극(1~2줄): 그 불편이 왜 짜증나는지, 지금까지의 해결책이 왜 별로였는지(돈, 시간, 번거로움).
3. 해결(1줄): 이 상품이 그 문제를 어떻게 끝내는지 한 문장으로.
4. 구매 이유 3가지(3~4줄): 기능 나열이 아니라 "그래서 내 생활이 어떻게 좋아지는지"로 바꿔 말한다. 숫자·크기·사용 장면을 구체적으로.
5. 망설임 해소(1줄): 가격·설치·관리·보관 중 가장 걸릴 만한 점을 풀어준다.
6. 가격과 지금 사야 할 이유(1줄): 가격을 말하고 계절·상황상 지금이 필요한 이유(거짓 할인·마감 압박 금지).
7. 마지막 줄: 반드시 "상품번호 {번호}번 고정댓글 링크에 있어요."

말투:
- 20~30대 여성이 친한 친구에게 진심으로 추천하듯 친근하고 산뜻한 구어체(~요, ~죠). 문장마다 리듬감 있게.
- "가성비 최고", "강추", "대박", "꿀템" 같은 뻔한 말 대신 구체적인 장면과 결과로 말한다.
- 자막 한 줄은 22자 이내, 한 호흡에 읽히게. 줄마다 강조할 핵심 단어 하나를 *별표*로.
- 상단 제목 2줄은 영상 내내 고정되는 가장 강한 혜택 문구(예: "보일러 안 틀어도" / "*온돌*처럼 따뜻해요").

정직하게:
- 장점과 수치는 제공된 상품명·카테고리·가격·메모·사진에서 확인되는 것만 씁니다. 없는 기능, 인증, 판매량, 후기 수를 지어내지 않습니다.
- 메모에 직접 사용했다는 말이 없으면 "제가 써봤는데" 같은 거짓 사용 경험은 쓰지 않습니다. 대신 "이거 하나면 ~해요" 같은 자연스러운 추천 말투를 씁니다.
- 의학적 효능·최고/최초 같은 과장 표현은 피합니다.

video_prompts: 상품 사진이 첫 프레임인 5초 영상용 영어 프롬프트 3개. 상품의 모양·색·로고는 그대로 유지하고,
실제 사용 장면/클로즈업/부드러운 카메라 이동을 묘사합니다(예: "slow push-in, cozy living room, warm morning light, product stays identical").
사람 얼굴 클로즈업과 텍스트 생성은 피합니다.`;

export async function writeScript(product, notes = "") {
  const client = new Anthropic();
  const info = [
    `상품번호: ${product.no}`,
    `상품명: ${product.name}`,
    product.price ? `가격: ${Number(product.price).toLocaleString("ko-KR")}원` : "",
    product.category ? `카테고리: ${product.category}` : "",
    product.isRocket ? "로켓배송 가능" : "",
    notes ? `운영자 메모(상품 특징): ${notes}` : "",
  ].filter(Boolean).join("\n");

  const content = [];
  if (/^https:\/\//.test(product.image || "")) content.push({ type: "image", source: { type: "url", url: product.image } });
  content.push({ type: "text", text: `다음 상품의 쇼핑 쇼츠 대본을 써 주세요.\n\n${info}` });

  const request = (withImage) => client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCRIPT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: withImage ? content : content.filter((c) => c.type === "text") }],
  });

  let response;
  try {
    response = await request(true);
  } catch (err) {
    // 상품 이미지 주소를 Claude 가 못 가져오는 경우 이미지 없이 다시 시도
    if (err instanceof Anthropic.BadRequestError && content.length > 1) response = await request(false);
    else throw err;
  }
  if (response.stop_reason === "refusal") throw new Error("AI가 이 상품의 대본 작성을 거절했습니다. 상품명을 확인해 주세요.");
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const script = JSON.parse(text);
  // 마지막 문장은 항상 상품번호 안내
  const last = `상품번호 ${product.no}번 고정댓글 링크에 있어요.`;
  if (!script.captions.at(-1)?.includes(`${product.no}번`)) script.captions.push(last);
  return script;
}

// ---------------- 목소리 (ElevenLabs) ----------------
const ELEVEN = "https://api.elevenlabs.io/v1";

export async function listVoices() {
  const res = await fetch(`${ELEVEN}/voices`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`ElevenLabs 목소리 목록 오류 (${res.status}): ${(await res.text()).slice(0, 200)}`);
  const { voices } = await res.json();
  return voices.map((v) => ({
    id: v.voice_id,
    name: v.name,
    gender: v.labels?.gender || "",
    accent: v.labels?.accent || v.labels?.language || "",
    description: v.labels?.description || v.description || "",
    preview: v.preview_url || "",
  }));
}

// 글자 단위 타이밍이 함께 오는 TTS → 자막을 목소리에 정확히 맞출 수 있습니다.
export async function speak(text, voiceId) {
  const id = voiceId || process.env.ELEVENLABS_VOICE_ID;
  if (!id) throw new Error("목소리를 먼저 선택하세요.");
  const res = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(id)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.4, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.08 },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs 음성 생성 오류 (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return { audioBase64: data.audio_base64, alignment: data.alignment || data.normalized_alignment };
}

// ---------------- 상품 영상 (Higgsfield) ----------------
const HIGGS = "https://api.higgsfield.ai";

function higgsHeaders() {
  return {
    Authorization: `Key ${process.env.HIGGSFIELD_KEY_ID}:${process.env.HIGGSFIELD_KEY_SECRET}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function submitVideo(imageUrl, prompt, duration = 5) {
  const path = process.env.HIGGSFIELD_I2V_PATH || "/kling-video/v3.0/std/image-to-video";
  const res = await fetch(HIGGS + path, {
    method: "POST",
    headers: higgsHeaders(),
    body: JSON.stringify({ image_url: imageUrl, prompt, duration, sound: "off" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Higgsfield 오류 (${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  const statusUrl = data.status_url || (data.request_id && `${HIGGS}/requests/${data.request_id}/status`);
  if (!statusUrl) throw new Error(`Higgsfield 응답에 status_url 이 없습니다: ${text.slice(0, 200)}`);
  return { requestId: data.request_id, statusUrl };
}

// 응답 어딘가에 있는 영상 주소를 찾습니다(모델마다 응답 모양이 조금씩 다름).
export function findVideoUrl(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.video?.url === "string") return obj.video.url;
  for (const value of Object.values(obj)) {
    if (typeof value === "string" && /^https:\/\/\S+\.(mp4|webm|mov)(\?|$)/i.test(value)) return value;
    const nested = findVideoUrl(value);
    if (nested) return nested;
  }
  return null;
}

export async function videoStatus(statusUrl) {
  const url = new URL(statusUrl);
  if (url.hostname !== "api.higgsfield.ai") throw new Error("잘못된 상태 주소입니다.");
  const res = await fetch(url, { headers: higgsHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`Higgsfield 상태 확인 오류 (${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text);
  let videoUrl = findVideoUrl(data);
  // 상태 응답에 결과가 없으면 결과 주소를 한 번 더 확인
  if (!videoUrl && data.status === "completed") {
    const resultUrl = data.response_url || statusUrl.replace(/\/status$/, "");
    const r = await fetch(resultUrl, { headers: higgsHeaders() });
    if (r.ok) videoUrl = findVideoUrl(await r.json());
  }
  return { status: data.status, videoUrl, raw: videoUrl ? undefined : data };
}
