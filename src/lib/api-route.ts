import { NextResponse } from 'next/server';
import { ApiError, errorBody, toApiError } from './errors';

/** 统一成功响应信封：{ success, message, data }（同时满足用户规范与 FastGPT 官方规范）。 */
export function jsonSuccess<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, message: '', data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** 将路由处理过程中的异常转换为 JSON 错误响应，绝不输出 HTML 错误页。 */
export function jsonErrorResponse(err: unknown): NextResponse {
  const apiError = normalizeError(err);
  return NextResponse.json(errorBody(apiError), {
    status: apiError.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** 兼容文件仓库层抛出的带 status 的普通 Error 与 ApiError。 */
function normalizeError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err && typeof err === 'object' && 'status' in err) {
    const e = err as { status?: number; code?: string; message?: string };
    if (typeof e.status === 'number') {
      return new ApiError(
        e.status,
        e.code ?? (e.status === 404 ? 'NOT_FOUND' : 'REQUEST_FAILED'),
        e.message ?? '请求失败',
      );
    }
  }
  return toApiError(err);
}

/** 包装路由处理函数，统一兜底异常 -> JSON 错误响应。 */
export async function runApi<T>(fn: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await fn();
  } catch (err) {
    const apiError = normalizeError(err);
    // 4xx 是调用方问题（预期内的业务错误），降级为 warn；仅 5xx 作为服务端错误记录
    if (apiError.status >= 500) {
      console.error('[file-api]', err);
    } else {
      console.warn(`[file-api] ${apiError.status} ${apiError.code}: ${apiError.message}`);
    }
    return jsonErrorResponse(apiError);
  }
}
