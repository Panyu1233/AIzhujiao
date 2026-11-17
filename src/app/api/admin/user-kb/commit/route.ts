import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { commitUserInfo } from '@/lib/user-kb-process';
import { userKbGetFile, userKbGetParsed, userKbUpdateStatus, type UserDataSource } from '@/lib/user-kb-files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 存入：把已解析的用户信息数据写入共享库 Supabase 表格。
 * POST /api/admin/user-kb/commit  body: { name }
 * 需先「解析」成功（有 parsed_result）；成功后状态置为 committed（已上传数据库）。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');

    const detail = await userKbGetFile(name);
    if (!detail) throw new Error('文件不存在');
    if (detail.status !== 'parsed') {
      throw new Error('该文件当前不在「正式库待上传」状态，请先确认并解析');
    }
    const parsed = await userKbGetParsed(name);
    if (parsed === null || parsed === undefined) {
      throw new Error('该文件尚未确认，请先点击「确认」');
    }

    const source: UserDataSource = detail.data_source === 'agent_api'
      ? 'agent_api'
      : detail.data_source === 'unidentified_agent_user'
        ? 'unidentified_agent_user'
        : 'gulesi_mini_program';
    if (source === 'unidentified_agent_user') {
      throw new Error('未标识的智能体用户目前只做本地 DS 解析，尚未建立 Supabase 字段映射，暂不能上传');
    }
    const result = await commitUserInfo(parsed, source);
    await userKbUpdateStatus(name, 'committed', { committed_at: true });

    return adminOk({
      name,
      status: 'committed',
      source,
      table: result.table,
      inserted: result.inserted,
    });
  });
}
