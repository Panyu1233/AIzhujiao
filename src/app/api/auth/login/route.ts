import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { account?: string; password?: string }
    | null;
  const account = body?.account?.trim() ?? '';
  const password = body?.password ?? '';
  const expectedAccount = process.env.ADMIN_ACCOUNT?.trim() || 'admin@aizhujiao';
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (account !== expectedAccount || password !== expectedPassword) {
    return NextResponse.json(
      { success: false, message: '账号或密码错误' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const token = process.env.ADMIN_TOKEN?.trim() || 'kb-admin';
  return NextResponse.json(
    { success: true, message: '', data: { token } },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
