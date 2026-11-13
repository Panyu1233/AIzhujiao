/**
 * Bearer Token 鉴权。
 * 同时兼容 Edge Runtime（middleware）与 Node Runtime（route handler），
 * 不依赖 Node 专有 API。token 来自环境变量 FASTGPT_FILE_LIBRARY_TOKEN。
 */

/** 常量时间字符串比较，避免计时侧信道。 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  return match ? match[1].trim() : null;
}

/**
 * 后台管理会话口令（ADMIN_TOKEN，缺省内置 kb-admin）。
 * 用于承载后台登录态：前端登录后以此为 Bearer 访问 /api/admin/*，
 * 避免把生产知识库读取 token（FASTGPT_FILE_LIBRARY_TOKEN）下发到浏览器端。
 */
function adminSessionToken(): string {
  return process.env.ADMIN_TOKEN?.trim() || 'kb-admin';
}

export function isAuthorized(req: Request): boolean {
  const expected = process.env.FASTGPT_FILE_LIBRARY_TOKEN?.trim() ?? '';
  const adminToken = adminSessionToken();
  if (!expected && !adminToken) return false;
  const provided = extractBearerToken(req.headers.get('authorization'));
  if (provided === null) return false;
  const okToken = !!expected && safeEqual(provided, expected);
  const okAdmin = safeEqual(provided, adminToken);
  return okToken || okAdmin;
}
