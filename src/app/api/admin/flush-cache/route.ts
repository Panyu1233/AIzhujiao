import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { refreshIndex, getStats } from '@/lib/file-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 主动刷新文件索引缓存。
 * POST /api/admin/flush-cache
 * 清空内存索引并重新扫描 KNOWLEDGE_BASE_ROOT，消除上传/删除后的 TTL 延迟，
 * 让 FastGPT 下一次调用 list/content 立即可看到最新文件树。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    await refreshIndex();
    const stats = await getStats();
    return adminOk({
      refreshed: true,
      fileCount: stats.fileCount,
      folderCount: stats.folderCount,
      root: stats.root,
    });
  });
}