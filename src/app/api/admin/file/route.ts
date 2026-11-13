import path from 'path';
import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { removeNode } from '@/lib/adminfs';
import { refreshIndex } from '@/lib/file-repo';
import { deleteVolcanoDoc } from '@/lib/volcano-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 删除知识库内的文件（或空文件夹）。
 * DELETE /api/admin/file?path=<相对路径>&remote=1
 * remote=1 表示文件状态为「入库」或「修改」，删除时同步清理火山知识库；
 * 其它状态只删除本地文件。该接口不访问 Supabase。
 */
export async function DELETE(req: NextRequest) {
  return runAdmin(req, async () => {
    const rel = req.nextUrl.searchParams.get('path')?.trim() ?? '';
    const remote = req.nextUrl.searchParams.get('remote') === '1';
    const isFile = !rel.endsWith('/') && rel.includes('.');
    const name = path.basename(rel);

    if (isFile && remote) {
      const del = await deleteVolcanoDoc(name);
      if (!del.ok) {
        throw new Error(`删除火山知识库文档失败：${del.error ?? '未知错误'}`);
      }
    }

    const result = await removeNode(rel);
    await refreshIndex();
    return adminOk({ ...result, remoteDeleted: isFile && remote });
  });
}