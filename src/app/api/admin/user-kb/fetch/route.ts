import type { NextRequest } from 'next/server';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { userKbGetFile, userKbPutFile, type UserDataSource } from '@/lib/user-kb-files';
import { fetchExternalResource, filenameFromUrl } from '@/lib/external-fetch';
import { fetchGulesiUserRows, GULESI_USER_SOURCE } from '@/lib/gulesi-api';
import { config } from '@/lib/config';
import { extractUserInfoRows } from '@/lib/user-kb-process';
import { DOCX_MIME, buildUserDocx, userDocxFilename, userPhoneOf } from '@/lib/user-docx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENT_USER_SOURCE = 'agent_api';

function agentUserHeaders(): Record<string, string> {
  if (!config.agentUserApiKey) return {};
  const header = config.agentUserApiKeyHeader || 'Authorization';
  const value =
    header.toLowerCase() === 'authorization' && !/^bearer\s+/i.test(config.agentUserApiKey)
      ? `Bearer ${config.agentUserApiKey}`
      : config.agentUserApiKey;
  return { [header]: value };
}

type PersistResult = {
  created: number;
  updated: number;
  preserved: number;
  skipped: number;
  names: string[];
};

/** 把 API 返回的每个用户分别生成一个 DOCX，禁止把多个用户合成一个文件。 */
async function persistUsersAsDocx(
  rows: Record<string, unknown>[],
  source: UserDataSource,
): Promise<PersistResult> {
  const names = new Set<string>();
  let created = 0;
  let updated = 0;
  let preserved = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!userPhoneOf(row)) {
      skipped += 1;
      continue;
    }
    const name = userDocxFilename(row, source);
    const existing = await userKbGetFile(name);

    // 外部读取只能更新暂存区。正式库待上传、已上传数据库的文件不能被同名数据覆盖。
    if (existing && existing.status !== 'staging') {
      preserved += 1;
      continue;
    }

    const buffer = await buildUserDocx(row, source);
    await userKbPutFile(name, buffer, {
      contentType: DOCX_MIME,
      format: 'DOCX',
      dataSource: source,
      sourcePayload: row,
    });
    names.add(name);
    if (existing) updated += 1;
    else created += 1;
  }

  return { created, updated, preserved, skipped, names: [...names] };
}

/** POST /api/admin/user-kb/fetch：按数据源读取外部用户数据，并为每个用户生成独立 DOCX 暂存文件。 */
export async function POST(req: NextRequest) {
  return runAdmin(req, async () => {
    const body = (await req.json().catch(() => null)) as
      | {
          source?: string;
          url?: string;
          name?: string;
          headers?: Record<string, string>;
        }
      | null;
    const source = body?.source?.trim() || '';

    if (source === GULESI_USER_SOURCE) {
      const result = await fetchGulesiUserRows();
      const persisted = await persistUsersAsDocx(result.rows, GULESI_USER_SOURCE);
      return adminOk(
        {
          source,
          sourceLabel: '谷乐斯小程序用户数据',
          ...persisted,
          count: persisted.created,
          total: result.total,
          pages: result.pages,
          skipped: persisted.skipped + result.skipped,
        },
        201,
      );
    }

    if (source === AGENT_USER_SOURCE) {
      if (!config.agentUserApiUrl) {
        throw new Error('智能体用户信息 API 尚未配置：请设置 AGENT_USER_API_URL 和 AGENT_USER_API_KEY');
      }
      const fetched = await fetchExternalResource(config.agentUserApiUrl, {
        headers: agentUserHeaders(),
      });
      let payload: unknown;
      try {
        payload = JSON.parse(fetched.buffer.toString('utf8'));
      } catch {
        throw new Error('智能体用户 API 返回内容不是合法 JSON');
      }
      const rows = extractUserInfoRows(payload);
      if (rows.length === 0) throw new Error('智能体用户 API 中没有可识别的用户数组');
      const persisted = await persistUsersAsDocx(rows, AGENT_USER_SOURCE);
      return adminOk(
        {
          source,
          sourceLabel: '智能体用户数据',
          ...persisted,
          count: persisted.created,
        },
        201,
      );
    }

    // 兼容接口调用；后台页面固定使用受控数据源。
    const url = body?.url?.trim() ?? '';
    if (!url) throw new Error('请选择数据源');
    const fetched = await fetchExternalResource(url, { headers: body?.headers });
    let payload: unknown;
    try {
      payload = JSON.parse(fetched.buffer.toString('utf8'));
    } catch {
      throw new Error(`外部地址返回内容不是 JSON：${filenameFromUrl(fetched.finalUrl, '数据文件')}`);
    }
    const rows = extractUserInfoRows(payload);
    if (rows.length === 0) throw new Error('外部地址中没有可识别的用户数组');
    const persisted = await persistUsersAsDocx(rows, GULESI_USER_SOURCE);
    return adminOk(
      {
        source: GULESI_USER_SOURCE,
        sourceLabel: '外部用户数据',
        ...persisted,
        count: persisted.created,
        sourceUrl: fetched.finalUrl,
      },
      201,
    );
  });
}
