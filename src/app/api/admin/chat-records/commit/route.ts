import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { chatRecordFileCommit } from '@/lib/chat-record-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/admin/chat-records/commit：正式库文件 -> chat_message。 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    return adminOk({ name, ...(await chatRecordFileCommit(name)) });
  });
}
