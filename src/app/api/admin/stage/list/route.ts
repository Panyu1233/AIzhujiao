import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { listStaging, getStagingSummary } from '@/lib/stage-repo';
import { getStats } from '@/lib/file-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 暂存区列表 + 汇总，文件来源仅为本机暂存目录。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const files = await listStaging();
    const summary = await getStagingSummary().catch(() => null);
    const indexedStats = await getStats().catch(() => null);
    return adminOk({
      files,
      stagedCount: files.length,
      indexedCount: indexedStats?.fileCount ?? summary?.indexedCount ?? 0,
      stagedRoot: summary?.root ?? '',
      source: 'filesystem',
    });
  });
}