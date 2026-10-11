// 공통 응답/인증 도우미
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

// ADMIN_PASSWORD 가 설정되어 있으면 x-admin-key 헤더가 일치해야 합니다.
export function isAdmin(req) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return true;
  return req.headers.get("x-admin-key") === password;
}

export function requireAdmin(req) {
  return isAdmin(req) ? null : error("관리자 비밀번호가 필요합니다. 설정 탭에서 입력하세요.", 401);
}
