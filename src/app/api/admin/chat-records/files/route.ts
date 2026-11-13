import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { chatRecordFileList, chatRecordFileStats } from '@/lib/chat-record-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/admin/chat-records/files：本地暂存区 + 正式库文件清单。 */
export async function GET(req: NextRequest) {
  return runAdmin(req, async () => {
    const [files, stats] = await Promise.all([chatRecordFileList(), chatRecordFileStats()]);
    return adminOk({ files, stats, source: 'filesystem' });
  });
}
