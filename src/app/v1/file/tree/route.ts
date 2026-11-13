import { type NextRequest } from 'next/server';
import { jsonSuccess, runApi } from '@/lib/api-route';
import { queryFileTree } from '@/lib/file-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 获取文件树（用户规范版本）
 * GET /v1/file/tree?parentId=xxx&searchKey=xxx
 * FastGPT 官方同功能接口为 POST /v1/file/list，两个端点行为一致。
 */
export async function GET(req: NextRequest) {
  return runApi(async () => {
    const parentId = req.nextUrl.searchParams.get('parentId');
    const searchKey = req.nextUrl.searchParams.get('searchKey');
    const data = await queryFileTree({ parentId, searchKey });
    return jsonSuccess(data);
  });
}
