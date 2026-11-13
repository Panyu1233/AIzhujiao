import type { NextRequest } from 'next/server';
import path from 'path';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { refreshIndex } from '@/lib/file-repo';
import { restoreModifiedFilesFromVolcano } from '@/lib/volcano-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/restore  body: { filename: "xxx.docx" }
 * 将单个「修改」状态的 active 文件还原为火山知识库中的原始版本。
 * 不访问 Supabase；无法读取火山原文件时明确失败，不伪造成功状态。
 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as { filename?: unknown } | null;
    const filename = typeof body?.filename === 'string' ? path.basename(body.filename.trim()) : '';
    if (!filename) throw new Error('缺少参数 filename');

    const result = await restoreModifiedFilesFromVolcano({ filename });
    if (result.error) throw new Error(result.error);
    const item = result.items.find((entry) => entry.name === filename);
    if (!item || item.status !== 'restored') {
      throw new Error(item?.reason || '该文件无法从火山知识库还原');
    }
    await refreshIndex();
    return adminOk({
      filename,
      status: 'synced',
      size: item.size,
      mtimeMs: item.mtimeMs,
      restoredFrom: item.source === 'tos' ? 'volcano-tos' : 'volcano-url',
    });
  });
}
