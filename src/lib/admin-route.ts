/**
 * admin 管理端路由包装：强制 Bearer 鉴权 + 统一 JSON 成功/错误信封。
 * 所有 /api/admin/* 都必须经过这里，禁止任何免鉴权写操作。
 */
import { NextResponse } from 'next/server';
import { isAuthorized } from './auth';
import {
  AdminFsError,
  normalizeAdminError,
} from './adminfs';
import { unauthorized } from './errors';

/** 统一成功信封（与读接口一致：{ success, message, data }）。 */
export function adminOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, message: '', data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** 鉴权守卫：不通过则抛出 401 JSON。 */
export function requireAdmin(req: Request): void {
  if (!isAuthorized(req)) {
    // 复用 errors.unauthorized 的 message，保证文案统一
    throw unauthorized();
  }
}

/**
 * 包装 admin 路由处理函数：
 * - 先强制鉴权（Bearer Token）
 * - 统一 AdminFsError / 普通 Error -> JSON
 * - 路由内部只写业务逻辑，不写 try/catch
 */
export async function runAdmin<T>(
  req: Request,
  fn: () => Promise<T>,
): Promise<T | NextResponse> {
  try {
    requireAdmin(req);
    return await fn();
  } catch (err) {
    const apiError = normalizeAdminError(err);
    if (apiError.status >= 500) {
      console.error('[admin-api]', err);
    } else {
      console.warn(`[admin-api] ${apiError.status} ${apiError.code}: ${apiError.message}`);
    }
    const body = {
      success: false,
      message: apiError.message,
      error: { code: apiError.code },
    };
    // 401 时附带 WWW-Authenticate，提示浏览器走 Bearer
    const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
    if (apiError.status === 401) headers['WWW-Authenticate'] = 'Bearer';
    return NextResponse.json(body, { status: apiError.status, headers });
  }
}