import { type NextRequest } from 'next/server';
import { jsonErrorResponse, jsonSuccess, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { config } from '@/lib/config';
import { listFiles, ensureDirs } from '@/lib/file-utils';
import { dbListFiles } from '@/lib/db-files';
import { bumpTodayCalls } from '@/lib/call-counter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * FastGPT 文件列表接口
 * POST /api/open/v1/file/list   body: { "parentId"?: string | null, "searchKey"?: string }
 *
 * 正式库（active）文件以数据库 kb_files 为权威来源（生产 /tmp 会在重建时清空）。
 * 数据库有记录则优先返回；数据库为空时回退扫描文件系统 active 目录。
 * 统一信封：{ success: true, data: [{ id, name }] }
 */
export async function POST(req: NextRequest) {
  return runApi(async () => {
    await ensureDirs();

    let body: unknown = {};
    const text = await req.text();
    if (text.trim() !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        return jsonErrorResponse(badRequest('请求体必须是合法 JSON'));
      }
    }
    if (typeof body !== 'object' || body === null) {
      return jsonErrorResponse(badRequest('请求体必须是 JSON 对象'));
    }
    const { parentId, searchKey } = body as {
      parentId?: string | null;
      searchKey?: string | null;
    };
    if (
      parentId !== undefined &&
      parentId !== null &&
      typeof parentId !== 'string'
    ) {
      return jsonErrorResponse(badRequest('parentId 必须是字符串或 null'));
    }

    const keyword =
      typeof searchKey === 'string' ? searchKey.trim().toLowerCase() : '';

    // 1) 优先数据库正式库
    let dbRows: { name: string; size: number; updated_at?: string }[] = [];
    try {
      dbRows = await dbListFiles('active');
    } catch {
      dbRows = [];
    }

    const useDb = dbRows.length > 0;
    const files = useDb
      ? dbRows.map(r => ({
          name: r.name,
          size: r.size,
          mtimeMs:
            r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        }))
      : await listFiles(config.activeRoot);

    bumpTodayCalls(); // 计入看板「今日调用次数」

    const data = files
      .filter(f => !keyword || f.name.toLowerCase().includes(keyword))
      .map(f => ({
        id: f.name,
        name: f.name,
        parentId: null as string | null,
        type: 'file' as const,
        updateTime: new Date(f.mtimeMs).toISOString(),
        createTime: new Date(f.mtimeMs).toISOString(),
        hasChild: false,
      }));

    return jsonSuccess(data);
  });
}