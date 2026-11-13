import path from 'path';
import { promises as fs } from 'fs';
import { type NextRequest, NextResponse } from 'next/server';
import { jsonErrorResponse, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { config } from '@/lib/config';
import { safeRelIn } from '@/lib/file-utils';
import {
  syncToVolcano,
  deleteVolcanoDoc,
  listVolcanoDocNames,
  safeDocId,
} from '@/lib/volcano-sync';
import { lastSyncedAt, markSynced } from '@/lib/volcano-state';
import { getPublicBaseUrl } from '@/lib/urls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 单文件同步到火山知识库 API。
 * POST /api/admin/sync-to-volcano  body: { "filename": "xxx.docx" }
 *
 * - 以本地正式库 active 文件为内容来源；
 * - “修改”状态先删除火山旧文档，再上传新版本；
 * - “本地”状态直接上传；
 * - 只写火山知识库并记录同步时间，不写 Supabase。
 */
export async function POST(req: NextRequest) {
  return runApi(async () => {
    const body = (await req.json().catch(() => null)) as { filename?: unknown } | null;
    const name = typeof body?.filename === 'string' ? path.basename(body.filename.trim()) : '';
    if (!name) return jsonErrorResponse(badRequest('缺少 filename 参数'));

    const abs = safeRelIn(config.activeRoot, name);
    let content: Buffer;
    let mtime: number;
    try {
      content = await fs.readFile(abs);
      mtime = (await fs.stat(abs)).mtimeMs;
    } catch {
      return jsonErrorResponse(badRequest(`本地正式库中不存在该文件：${name}`));
    }
    if (content.byteLength === 0) {
      return jsonErrorResponse(badRequest(`文件内容为空，无法同步：${name}`));
    }

    const lastSynced = await lastSyncedAt(name);
    const volcanoNames = await listVolcanoDocNames();
    const inVolcano = volcanoNames.has(name) || volcanoNames.has(safeDocId(name));
    const status = !inVolcano ? 'local' : lastSynced === 0 || mtime > lastSynced ? 'modified' : 'synced';

    if (status === 'modified') {
      const del = await deleteVolcanoDoc(name);
      if (!del.ok) {
        return jsonErrorResponse({
          status: 502,
          code: 'VOLCANO_DELETE_FAILED',
          message: `删除火山旧文档失败：${del.error ?? '未知错误'}（${name}）`,
        });
      }
    }

    const base = getPublicBaseUrl(req.headers);
    let baseHost = '';
    try {
      baseHost = new URL(base).hostname.toLowerCase();
    } catch {
      return jsonErrorResponse({
        status: 400,
        code: 'PUBLIC_BASE_URL_INVALID',
        message: 'PUBLIC_BASE_URL 不是合法地址，无法提供给火山知识库回源',
      });
    }
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(baseHost)) {
      return jsonErrorResponse({
        status: 400,
        code: 'PUBLIC_BASE_URL_REQUIRED',
        message: '当前是本地地址，火山知识库无法访问。请通过正式域名操作。',
      });
    }

    const publicFileUrl = `${base}/v1/raw/${name.split('/').map(encodeURIComponent).join('/')}`;
    const synced = await syncToVolcano(name, publicFileUrl);
    if (!synced.ok) {
      return jsonErrorResponse({
        status: 502,
        code: 'VOLCANO_SYNC_FAILED',
        message: `同步到火山知识库失败：${synced.error ?? '未知错误'}（${name}）`,
      });
    }

    await markSynced(name, mtime);
    return NextResponse.json(
      {
        success: true,
        message: `已同步到火山知识库（${synced.requestId ?? 'ok'}）`,
        data: { filename: name, syncedAt: mtime, storage: 'volcano-only' },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}
