import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorized } from '@/lib/auth';

/**
 * Next.js 16 Proxy（旧称 middleware）。
 * Proxy 始终运行在 Node.js runtime，可直接读取部署时注入的运行时环境变量
 * （Edge middleware 的 process.env 会在构建期内联，无法读取控制台后配的 Token）。
 *
 * 受保护端点：知识库文件库接口，以及对外只读的知识库文件、用户、聊天记录接口。
 * - GET  /v1/file/tree     （用户规范的文件树接口）
 * - POST /v1/file/list     （FastGPT 官方规范的文件树接口，同一实现）
 * - GET  /v1/file/content
 * - GET  /v1/file/read
 * - GET  /v1/file/detail
 *
 * 原始文件下载地址 /v1/raw/* 不在此保护范围内：FastGPT 下载 previewUrl 时
 * 不会携带 Authorization 头，因此默认公开（可通过 REQUIRE_RAW_TOKEN=true 收紧）。
 */
const ENDPOINT_RULES: Record<string, string[]> = {
  // FastGPT API 文件库（第一阶段：/v1 前缀）
  '/v1/file/tree': ['GET'],
  '/v1/file/list': ['POST'],
  '/v1/file/content': ['GET'],
  '/v1/file/read': ['GET'],
  '/v1/file/detail': ['GET'],
  // FastGPT API 文件库（第二阶段：/api/open 前缀，兼容既有中台前缀）
  '/api/open/v1/file/list': ['POST'],
  '/api/open/v1/file/content': ['GET'],
  '/api/open/v1/file/read': ['GET'],
  '/api/open/v1/file/detail': ['GET'],
  // 对外只读数据接口（底层知识库正式库 / 用户与聊天数据）
  '/api/open/v1/knowledge-files': ['GET'],
  '/api/open/v1/agent-users': ['GET'],
  '/api/open/v1/calibrated-users': ['GET'],
  '/api/open/v1/chat-messages': ['GET'],
  // 第三方上传（写入 staging，属写操作，强制 Bearer）
  '/api/open/upload': ['POST'],
  // 管理后台写操作（一律强制 Bearer，不允许免鉴权写）
  '/api/admin/confirm': ['POST'],
  '/api/admin/upload': ['POST'],
  '/api/admin/file': ['DELETE'],
  '/api/admin/folder': ['POST'],
  '/api/admin/flush-cache': ['POST'],
  '/api/admin/stats': ['GET'],
  '/api/admin/files': ['GET'],
  '/api/admin/sync': ['POST'],
  '/api/admin/sync-to-volcano': ['POST'],
  '/api/admin/restore': ['POST'],
  // 数据库持久化（备份正式库到数据库 / 从数据库恢复）
  '/api/admin/db/stats': ['GET'],
  // 暂存区管理（先上传暂存、确认后入库）
  '/api/admin/stage/upload': ['POST'],
  '/api/admin/stage/commit': ['POST'],
  '/api/admin/stage/file': ['DELETE'],
  '/api/admin/stage/list': ['GET'],
  // 用户信息管理（与底层知识库完全独立）
  '/api/admin/user-kb/files': ['GET'],
  '/api/admin/user-kb/upload': ['POST'],
  '/api/admin/user-kb/fetch': ['POST'],
  '/api/admin/user-kb/file': ['DELETE'],
  '/api/admin/user-kb/content': ['GET'],
  '/api/admin/user-kb/download': ['GET'],
  '/api/admin/user-kb/parse': ['POST'],
  '/api/admin/user-kb/commit': ['POST'],
  // 用户聊天记录（外部 API -> 暂存 -> 正式库 -> chat_message）
  '/api/admin/chat-records': ['GET'],
  '/api/admin/chat-records/files': ['GET'],
  '/api/admin/chat-records/upload': ['POST'],
  '/api/admin/chat-records/fetch': ['POST'],
  '/api/admin/chat-records/confirm': ['POST'],
  '/api/admin/chat-records/commit': ['POST'],
  '/api/admin/chat-records/file': ['DELETE'],
  '/api/admin/chat-records/content': ['GET'],
};

function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: Headers,
): NextResponse {
  return NextResponse.json(
    { success: false, message, error: { code } },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(headers ? Object.fromEntries(headers.entries()) : {}),
      },
    },
  );
}

export function proxy(req: NextRequest): NextResponse | undefined {
  const { pathname } = req.nextUrl;

  // /admin 后台页面由客户端守卫（localStorage）控制登录态，
  // 因为预览环境为跨域 iframe，服务端 Cookie 可能无法写入。
  // 这里直接放行 HTML 页面路由，不在此拦截，避免登录后弹回死循环。
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return undefined;
  }

  const allowedMethods = ENDPOINT_RULES[pathname];
  if (!allowedMethods) return undefined;

  if (!allowedMethods.includes(req.method)) {
    return jsonError(
      405,
      'METHOD_NOT_ALLOWED',
      `${pathname} 仅允许 ${allowedMethods.join(', ')}`,
      new Headers({ Allow: allowedMethods.join(', ') }),
    );
  }

  if (!isAuthorized(req)) {
    return jsonError(
      401,
      'UNAUTHORIZED',
      '未授权：请在请求头携带 Authorization: Bearer <token>',
      new Headers({ 'WWW-Authenticate': 'Bearer' }),
    );
  }

  return undefined;
}

export const config = {
  matcher: [
    '/v1/file/tree',
    '/v1/file/list',
    '/v1/file/content',
    '/v1/file/read',
    '/v1/file/detail',
    '/api/open/v1/file/list',
    '/api/open/v1/file/content',
    '/api/open/v1/file/read',
    '/api/open/v1/file/detail',
    '/api/open/v1/knowledge-files',
    '/api/open/v1/agent-users',
    '/api/open/v1/calibrated-users',
    '/api/open/v1/chat-messages',
    '/api/open/upload',
    '/api/admin/confirm',
    '/api/admin/upload',
    '/api/admin/file',
    '/api/admin/folder',
    '/api/admin/flush-cache',
    '/api/admin/stats',
    '/api/admin/files',
    '/api/admin/stage/upload',
    '/api/admin/stage/commit',
    '/api/admin/stage/file',
    '/api/admin/stage/list',
    '/api/admin/sync-to-volcano',
    '/api/admin/restore',
    '/api/admin/user-kb/files',
    '/api/admin/user-kb/upload',
    '/api/admin/user-kb/fetch',
    '/api/admin/user-kb/file',
    '/api/admin/user-kb/content',
    '/api/admin/user-kb/download',
    '/api/admin/user-kb/parse',
    '/api/admin/user-kb/commit',
    '/api/admin/chat-records',
    '/api/admin/chat-records/files',
    '/api/admin/chat-records/upload',
    '/api/admin/chat-records/confirm',
    '/api/admin/chat-records/commit',
    '/api/admin/chat-records/file',
    '/api/admin/chat-records/content',
    // 后台管理页面（登录态守卫）
    '/admin',
    '/admin/staging',
    '/admin/api',
    '/admin/chat-records',
  ],
};









