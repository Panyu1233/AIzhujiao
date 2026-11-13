import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { userKbGetFile } from '@/lib/user-kb-files';
import { getMimeType } from '@/lib/file-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 用户信息文件详情。
 * GET /api/admin/user-kb/content?name=<文件名>
 * 返回元数据 + 文本类文件内联 content；二进制/超大仅给下载用的元信息。
 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    const detail = await userKbGetFile(name);
    if (!detail) throw new Error('文件不存在');
    const contentType = detail.content_type ?? getMimeType(name);
    return adminOk({
      name: detail.name,
      size: detail.size,
      contentType,
      format: detail.format,
      updatedAt: detail.updated_at,
    });
  });
}
