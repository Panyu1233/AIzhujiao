import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { config } from '@/lib/config';
import { listFiles } from '@/lib/file-utils';
import { readTodayCalls } from '@/lib/call-counter';
import { listVolcanoDocNames } from '@/lib/volcano-sync';
import { getAllSyncState } from '@/lib/volcano-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 数据看板统计 API：文件数量以本地暂存/正式库为准。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const [activeFiles, stagedFiles] = await Promise.all([
      listFiles(config.activeRoot),
      listFiles(config.stagingRoot),
    ]);

    let volcanoNames = new Map<string, boolean>();
    let volcanoStatus = 'degraded';
    try {
      volcanoNames = await listVolcanoDocNames();
      volcanoStatus = volcanoNames.size > 0 ? 'normal' : 'degraded';
    } catch {
      volcanoStatus = 'degraded';
    }

    const syncState = await getAllSyncState();
    const syncedCount = activeFiles.filter((file) => {
      if (!volcanoNames.has(file.name)) return false;
      const last = syncState[file.name];
      return last !== undefined && file.mtimeMs <= last;
    }).length;

    return adminOk({
      activeCount: activeFiles.length,
      stagedCount: stagedFiles.length,
      todayCalls: readTodayCalls(),
      volcanoStatus,
      syncedCount,
      localCount: Math.max(0, activeFiles.length - syncedCount),
    });
  });
}