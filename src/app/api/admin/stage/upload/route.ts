import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { uploadToStaging } from '@/lib/stage-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 上传文件到暂存区（不进入索引，FastGPT 暂不可见）。
 * POST /api/admin/stage/upload  multipart/form-data
 *   - file: File（必填）
 *   - overwrite: 'true'? 同名是否覆盖（默认 false = 自动重命名）
 * 仅落本地暂存区；确认入库和最终同步前不会写数据库。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new Error('缺少上传文件（字段名 file）');
    }
    const overwrite = form.get('overwrite') === 'true';
    const result = await uploadToStaging(file, overwrite);
    return adminOk(result, 201);
  });
}