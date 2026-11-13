import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { chatRecordFileDelete, deleteCommittedChatRecordFile } from '@/lib/chat-record-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/chat-records/file?name=<文件名>。
 * 已上传数据库的文件会先删除 chat_message 中对应消息，再删除本地文件。
 */
export async function DELETE(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');
    const remote = await deleteCommittedChatRecordFile(name);
    const removed = await chatRecordFileDelete(name);
    return adminOk({ name, removed, ...remote });
  });
}