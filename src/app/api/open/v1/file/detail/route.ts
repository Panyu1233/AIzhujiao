import { type NextRequest } from 'next/server';
import { jsonSuccess, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { getNodeDTO } from '@/lib/file-repo';
import { dbGetFileContent } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 获取文件详情
 * GET /api/open/v1/file/detail?id=xxx
 * 优先从数据库正式库读取（生产 /tmp 会清空）；数据库无记录/无内容回退文件系统。
 */
export async function GET(req: NextRequest) {
  return runApi(async () => {
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) throw badRequest('缺少必填参数 id');

    // 数据库正式库优先
    try {
      const dbHit = await dbGetFileContent(id, 'active');
      if (dbHit.row) {
        return jsonSuccess({
          id,
          name: id,
          parentId: null,
          type: 'file',
          size: dbHit.row.size,
          contentType:
            dbHit.row.content_type ?? null,
        });
      }
    } catch {
      // 数据库不可用时忽略，回退文件系统
    }

    const data = await getNodeDTO(id);
    return jsonSuccess(data);
  });
}