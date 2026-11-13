import { type NextRequest } from 'next/server';
import { jsonSuccess, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { getNode } from '@/lib/file-repo';
import { buildRawFileUrl } from '@/lib/urls';
import { dbGetFileContent } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 获取文件阅读链接（FastGPT 中点击「查看原文」时打开）
 * GET /v1/file/read?id=xxx -> { data: { url } }
 * 优先以数据库正式库判断文件存在，再回退文件系统；返回可公网访问的 /v1/raw 链接。
 */
export async function GET(req: NextRequest) {
  return runApi(async () => {
    const id = req.nextUrl.searchParams.get('id')?.trim() ?? '';
    if (!id) throw badRequest('缺少必填参数 id');

    // 数据库正式库存在性优先
    let dbFound = false;
    try {
      const dbHit = await dbGetFileContent(id, 'active');
      dbFound = !!dbHit.row;
    } catch {
      dbFound = false;
    }

    if (dbFound) {
      const url = buildRawFileUrl(req.headers, id);
      return jsonSuccess({ url });
    }

    const node = await getNode(id);
    if (node.type !== 'file') throw badRequest('id 指向的是文件夹，不是文件');

    const url = buildRawFileUrl(req.headers, node.id);
    return jsonSuccess({ url });
  });
}