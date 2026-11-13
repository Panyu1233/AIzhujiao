/**
 * 后台管理会话口令（前端侧常量）。
 * 仅用于承载后台登录态：登录成功后写入 localStorage，
 * 访问 /api/admin/* 时以 Authorization: Bearer <adminToken> 携带。
 *
 * 该口令不是生产知识库读取 token（FASTGPT_FILE_LIBRARY_TOKEN），
 * 是独立的"后台接口接入口令"，服务端可通过 ADMIN_TOKEN 环境变量覆盖。
 */
export const ADMIN_SESSION_KEY = 'kb_admin_session';
export const ADMIN_TOKEN_KEY = 'kb_admin_token';
export const ADMIN_SESSION_TOKEN = 'kb-admin';

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  try {
    if (window.localStorage.getItem(ADMIN_SESSION_KEY) !== '1') return '';
    return window.localStorage.getItem(ADMIN_TOKEN_KEY) || ADMIN_SESSION_TOKEN;
  } catch {
    return '';
  }
}
/** 登录成功后保存服务端签发的后台口令（兼容旧版默认口令）。 */
export function setAdminToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* localStorage 不可用时仅保留会话标记 */
  }
}
