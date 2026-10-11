// 유튜브 바로 업로드 (YouTube Data API v3, 브라우저에서 직접 업로드)
// 구글 로그인은 Google Identity Services 토큰 방식을 씁니다. 서버에 비밀키가 필요 없습니다.
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
let gisReady = null;
let token = null; // { value, expiresAt }

export function loadGoogle() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisReady ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisReady = null;
      reject(new Error("구글 로그인 스크립트를 불러오지 못했습니다."));
    };
    document.head.appendChild(s);
  });
  return gisReady;
}

export function hasToken() {
  return Boolean(token && token.expiresAt > Date.now() + 60_000);
}

// 클릭 이벤트 안에서 바로 호출해야 팝업이 막히지 않습니다(loadGoogle 은 미리 해 두기).
export function signIn(clientId) {
  if (hasToken()) return Promise.resolve(token.value);
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error("구글 로그인 준비 중입니다. 잠시 후 다시 눌러주세요."));
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (res) => {
        if (res.error) return reject(new Error(`구글 로그인 실패: ${res.error_description || res.error}`));
        token = { value: res.access_token, expiresAt: Date.now() + Number(res.expires_in || 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (err) => reject(new Error(err?.type === "popup_closed" ? "로그인 창이 닫혔습니다." : `구글 로그인 실패: ${err?.message || err?.type}`)),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

const clean = (s, max) => String(s || "").replace(/[<>]/g, "").trim().slice(0, max);

// meta: { title, description, tags, privacy }
export async function uploadVideo(accessToken, blob, meta, onProgress) {
  const body = {
    snippet: {
      title: clean(meta.title, 100) || "쇼핑 쇼츠",
      description: clean(meta.description, 4900),
      tags: (meta.tags || []).map((t) => t.replace(/^#/, "")).slice(0, 15),
      categoryId: "26", // 노하우/스타일
      defaultLanguage: "ko",
    },
    status: { privacyStatus: meta.privacy || "private", selfDeclaredMadeForKids: false, embeddable: true },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": blob.type || "video/webm",
      "X-Upload-Content-Length": String(blob.size),
    },
    body: JSON.stringify(body),
  });
  if (!init.ok) throw new Error(await apiError(init));
  const uploadUrl = init.headers.get("Location");
  if (!uploadUrl) throw new Error("업로드 주소를 받지 못했습니다.");

  // 진행률을 보려고 XHR 사용
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", blob.type || "video/webm");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const video = JSON.parse(xhr.responseText);
        resolve({ id: video.id, url: `https://youtube.com/shorts/${video.id}`, status: video.status });
      } else reject(new Error(`업로드 실패 (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error("업로드 중 네트워크 오류가 났습니다."));
    xhr.send(blob);
  });
}

async function apiError(res) {
  const text = await res.text();
  let reason = "";
  try {
    const err = JSON.parse(text).error;
    reason = err.errors?.[0]?.reason || err.status || "";
    if (reason === "quotaExceeded") return "오늘 유튜브 API 업로드 한도를 다 썼습니다(기본 하루 약 6개). 내일 다시 시도하세요.";
    if (reason === "youtubeSignupRequired") return "이 구글 계정에 유튜브 채널이 없습니다. 채널이 있는 계정으로 로그인하세요.";
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/.test(text)) return "구글 클라우드에서 YouTube Data API v3 를 '사용 설정' 해야 합니다.";
    return `유튜브 API 오류 (${res.status}): ${err.message}`;
  } catch {
    return `유튜브 API 오류 (${res.status}): ${text.slice(0, 200)}`;
  }
}
