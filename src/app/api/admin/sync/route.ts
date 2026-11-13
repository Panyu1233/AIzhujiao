import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { refreshIndex } from '@/lib/file-repo';
import { restoreModifiedFilesFromVolcano } from '@/lib/volcano-sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/admin/sync
 * 一键还原所有「修改」状态的文件：从火山知识库读取原始版本并覆盖本地 active。
 * 不访问 Supabase；火山中不存在、未同步或已入库的文件均跳过。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const result = await restoreModifiedFilesFromVolcano();
    if (result.restored > 0) await refreshIndex();
    return adminOk({
      ...result,
      total: result.restored + result.skipped + result.failed,
      volcAvailable: !result.error,
    });
  });
}
