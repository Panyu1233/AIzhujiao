import type { NextRequest } from 'next/server';
import { runAdmin } from '@/lib/admin-route';
import { userKbGetFile } from '@/lib/user-kb-files';
import { getMimeType } from '@/lib/file-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 下载用户信息文件原始内容（仅数据库，生产 /tmp 清空不影响）。
 * GET /api/admin/user-kb/download?name=<文件名>&download=1
 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    const detail = await userKbGetFile(name);
    if (!detail || !detail.content) throw new Error('文件不存在或内容为空');
    const forceDownload = req.nextUrl.searchParams.get('download') === '1';
    const contentType = detail.content_type ?? getMimeType(name);
    const disposition = forceDownload ? 'attachment' : 'inline';
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Content-Length': String(detail.content.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=30',
    });
    const slice = new Uint8Array(detail.content.length);
    slice.set(detail.content);
    return new Response(slice.buffer, { status: 200, headers });
  });
}
