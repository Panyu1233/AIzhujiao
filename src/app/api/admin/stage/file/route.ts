import path from 'path';
import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { removeStagingFile } from '@/lib/stage-repo';
import { dbDeleteFile } from '@/lib/db-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 删除暂存文件。
 * DELETE /api/admin/stage/file?rel=<暂存相对路径>
 * 仅操作本地暂存文件；数据库不参与暂存流程。
 */
export async function DELETE(req: NextRequest) {
  return runAdmin(req, async () => {
    const rel = req.nextUrl.searchParams.get('rel')?.trim() ?? '';
    if (!rel) throw new Error('缺少参数 rel');
    // 兼容旧版本可能存在的数据库暂存记录；本地文件是当前流程的权威来源。
    const name = path.basename(rel.replace(/\\/g, '/'));
    try {
      await removeStagingFile(rel);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[stage/file] 文件系统删除跳过：${msg}`);
    }
    try {
      await dbDeleteFile(name, 'staging');
    } catch (e) {
      console.error('[stage/file] 数据库删除失败:', (e as Error)?.message);
    }
    return adminOk({ removed: rel });
  });
}