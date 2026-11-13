import { type NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { writeUpload } from '@/lib/adminfs';
import { refreshIndex } from '@/lib/file-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 上传文件到知识库根目录。
 * POST /api/admin/upload  multipart/form-data
 *   - file: File（必填）
 *   - folder: string? 目标文件夹相对路径（不传=根目录；'active' 表示正式库区）
 *   - overwrite: 'true'? 同名时是否覆盖（默认 false = 自动重命名，绝不静默覆盖）
 * 文件仅先落本地正式库并刷新索引；数据库写入由后续同步动作触发。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      throw new Error('缺少上传文件（字段名 file）');
    }
    const folderRaw = form.get('folder');
    const folder = typeof folderRaw === 'string' && folderRaw.trim() !== '' ? folderRaw.trim() : null;
    const overwrite = form.get('overwrite') === 'true';

    const result = await writeUpload(file, folder, { overwrite });
    // 文件先只落本地正式库；数据库/知识库由后续同步动作写入。
    // 主动刷新内存索引，消除 TTL 延迟，让 FastGPT 立刻拉到新文件
    await refreshIndex();

    return adminOk(
      {
        name: result.savedName,
        relPath: folder ? `${folder}/${result.savedName}` : result.savedName,
        overwritten: result.overwritten,
        size: result.size,
      },
      201,
    );
  });
}