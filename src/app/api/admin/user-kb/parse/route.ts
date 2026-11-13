import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { parseUserKbFileToFormal } from '@/lib/user-kb-process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 解析用户信息暂存 DOCX：解析成功后保持 DOCX 格式，并将文件状态置为 parsed，
 * 使其直接进入「用户信息正式库区」，等待用户点击「上传数据库」。
 * POST /api/admin/user-kb/parse  body: { name }
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim() ?? '';
    if (!name) throw new Error('缺少参数 name');

    const result = await parseUserKbFileToFormal(name);
    return adminOk({ ...result, status: 'parsed' });
  });
}