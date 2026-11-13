import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { userKbPutFile, type UserDataSource } from '@/lib/user-kb-files';
import { DOCX_MIME } from '@/lib/user-docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 上传用户信息 DOCX 到暂存区（仅存本地，不写数据库）。
 * POST /api/admin/user-kb/upload  multipart/form-data
 *   - file: File（必填，仅支持 .docx）
 *   - source: gulesi_mini_program | agent_api（可选）
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new Error('缺少上传文件（字段名 file）');
    }
    if (!/\.docx$/i.test(file.name)) {
      throw new Error('用户信息文件必须是 DOCX 格式');
    }
    const sourceValue = String(form.get('source') || '');
    const dataSource: UserDataSource = sourceValue === 'agent_api' ? 'agent_api' : 'gulesi_mini_program';
    const buf = Buffer.from(await file.arrayBuffer());
    await userKbPutFile(file.name, buf, {
      contentType: DOCX_MIME,
      format: 'DOCX',
      dataSource,
    });
    return adminOk(
      {
        name: file.name,
        size: buf.length,
        contentType: DOCX_MIME,
        dataSource,
        overwritten: true,
      },
      201,
    );
  });
}