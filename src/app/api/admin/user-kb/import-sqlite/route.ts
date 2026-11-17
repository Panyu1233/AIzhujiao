import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { importUnidentifiedAgentUsersSqlite } from '@/lib/agent-sqlite-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 导入未标识智能体用户 SQLite，立即调用 DS 解析并保存到本地用户信息正式库。 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new Error('缺少上传文件（字段名 file）');
    }
    if (!/\.(db|sqlite|sqlite3)$/i.test(file.name)) {
      throw new Error('仅支持 .db / .sqlite / .sqlite3 文件');
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await importUnidentifiedAgentUsersSqlite(buffer, file.name);
    return adminOk(result, 201);
  });
}
