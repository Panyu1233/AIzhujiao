import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * /v1 下任何未匹配路径都返回 JSON 404，
 * 保证 API 调用方永远不会收到 HTML 错误页。
 */
function json404(): NextResponse {
  return NextResponse.json(
    {
      success: false,
      message: '接口不存在，请参考 / 首页上的接口列表',
      error: { code: 'NOT_FOUND' },
    },
    { status: 404, headers: { 'Cache-Control': 'no-store' } },
  );
}

export const GET = json404;
export const POST = json404;
export const PUT = json404;
export const DELETE = json404;
export const PATCH = json404;
export const HEAD = json404;
export const OPTIONS = json404;
