import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { userKbDeleteFile } from '@/lib/user-kb-files';
import { deleteCommittedUserInfoFile } from '@/lib/user-kb-process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 删除用户信息文件。
 * 若文件状态为 committed（已上传数据库），先按手机号删除对应数据库用户，再删除本地文件。
 * DELETE /api/admin/user-kb/file?name=<文件名>
 */
export async function DELETE(req: NextRequest) {
  return runAdmin(req, async () => {
    const name = req.nextUrl.searchParams.get('name')?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');

    const remote = await deleteCommittedUserInfoFile(name);
    const removed = await userKbDeleteFile(name);
    return adminOk({ name, removed, ...remote });
  });
}