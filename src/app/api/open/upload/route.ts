import { type NextRequest, NextResponse } from 'next/server';
import { jsonErrorResponse, runApi } from '@/lib/api-route';
import { badRequest } from '@/lib/errors';
import { uploadToStaging } from '@/lib/stage-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 第三方上传 API
 * POST /api/open/upload   Content-Type: multipart/form-data
 * 表单字段：file（必填，单个文件）
 * 仅保存到本地 staging 目录，等待审核；最终同步前不写数据库。
 * 返回 { success: true, message: "上传成功，等待审核" }。
 */
export async function POST(req: NextRequest) {
  return runApi(async () => {
    const formData = await req.formData();
    const file = formData.get('file');
    if (!(file instanceof File) || file.size === 0) {
      return jsonErrorResponse(badRequest('缺少 file 字段，或上传文件为空'));
    }

    const { name, size } = await uploadToStaging(file);

    return NextResponse.json(
      { success: true, message: '上传成功，等待审核', data: { name, size } },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  });
}