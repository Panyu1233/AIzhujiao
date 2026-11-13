/** API 统一错误类型。所有错误最终都序列化为 JSON，绝不回退到 HTML 错误页。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string): ApiError =>
  new ApiError(400, 'BAD_REQUEST', message);

export const unauthorized = (message = '未授权：缺失或无效的 Authorization 头'): ApiError =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const notFound = (message = '文件不存在'): ApiError =>
  new ApiError(404, 'NOT_FOUND', message);

export const methodNotAllowed = (message: string): ApiError =>
  new ApiError(405, 'METHOD_NOT_ALLOWED', message);

export const configError = (message: string): ApiError =>
  new ApiError(503, 'SERVICE_NOT_CONFIGURED', message);

/** 未知异常统一转 500，避免把堆栈泄露给调用方。 */
export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  const message = err instanceof Error ? err.message : '内部服务器错误';
  return new ApiError(500, 'INTERNAL_ERROR', message);
}

export function errorBody(err: ApiError): {
  success: false;
  message: string;
  error: { code: string };
} {
  return { success: false, message: err.message, error: { code: err.code } };
}
