import path from 'path';
import { type NextRequest, NextResponse } from 'next/server';
import { jsonErrorResponse, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { config } from '@/lib/config';
import { promoteToActive, removeFile } from '@/lib/file-utils';
import { markPendingSync } from '@/lib/volcano-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 确认上传 API
 * POST /api/admin/confirm   body: { "filename": "xxx.docx" }
 * 将暂存区文件确认上传到正式库（active）本地，仅本地入库、不同步火山。
 * - 正式库无同名 → 新增本地文件（状态：本地）
 * - 正式库有同名 → 覆盖更新本地文件（状态：修改）
 * 火山上传到知识库由文件行的「同步」按钮单独触发。
 * 此步骤只操作本地文件系统，不写数据库。
 */
export async function POST(req: NextRequest) {
  return runApi(async () => {
    let body: unknown = {};
    const text = await req.text();
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        return jsonErrorResponse(badRequest('请求体必须是合法 JSON'));
      }
    }
    const { filename } = (body ?? {}) as { filename?: unknown };
    if (typeof filename !== 'string' || filename.trim() === '') {
      return jsonErrorResponse(badRequest('缺少 filename 参数'));
    }
    const rel = filename.trim();

    // 第一步：先入库到 active（只有进入 active 才有公网 /v1/raw 地址可供火山拉取）
    // 若正式库已存在同名文件，按「覆盖更新」处理：先删除旧文件，再移入新文件（而非自动改名）
    const relName = path.basename(rel);
    let finalName: string;
    let overwritten = false;
    try {
      overwritten = await removeFile(config.activeRoot, relName);
      finalName = await promoteToActive(config.stagingRoot, config.activeRoot, rel);
    } catch (err) {
      const e = err as { status?: number; message?: string };
      return jsonErrorResponse({
        status: e.status ?? 500,
        code: e.status === 404 ? 'NOT_FOUND' : 'PROMOTE_FAILED',
        message: e.message ?? '入库失败',
      });
    }

    // 入库只移动本地文件，不写数据库；数据库和知识库由正式库行的「同步」按钮写入。
    // 覆盖更新旧文件 → 标记为"待同步"，使其状态显示「修改」，直到点击「同步」
    if (overwritten) {
      await markPendingSync(relName);
    }
    return NextResponse.json(
      {
        success: true,
        message: overwritten
          ? '已更新至正式库（修改，待同步到知识库）'
          : '已确认上传至正式库（本地）',
        data: { filename: finalName, overwritten },
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}