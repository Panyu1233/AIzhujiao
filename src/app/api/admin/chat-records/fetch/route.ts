import type { NextRequest } from 'next/server';
import path from 'node:path';
import { adminOk, runAdmin } from '@/lib/admin-route';
import { chatRecordFilePut, extractChatRows } from '@/lib/chat-record-files';
import { fetchExternalResource, filenameFromUrl } from '@/lib/external-fetch';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AGENT_CHAT_SOURCE = 'agent_chat_api';

function defaultName(): string {
  return `chat-records-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.json`;
}

function agentChatHeaders(): Record<string, string> {
  if (!config.agentChatApiKey) return {};
  const header = config.agentChatApiKeyHeader || 'Authorization';
  const value =
    header.toLowerCase() === 'authorization' && !/^bearer\s+/i.test(config.agentChatApiKey)
      ? `Bearer ${config.agentChatApiKey}`
      : config.agentChatApiKey;
  return { [header]: value };
}

/** POST /api/admin/chat-records/fetch：按数据源读取聊天记录 JSON，先落到暂存区。 */
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

    let url = body?.url?.trim() ?? '';
    let headers = body?.headers;
    if (source === AGENT_CHAT_SOURCE || (!url && source)) {
      if (!config.agentChatApiUrl) {
        throw new Error('智能体聊天记录 API 尚未配置：请设置 AGENT_CHAT_API_URL 和 AGENT_CHAT_API_KEY');
      }
      url = config.agentChatApiUrl;
      headers = agentChatHeaders();
    }
    if (!url) throw new Error('请选择数据源');

    const fetched = await fetchExternalResource(url, { headers });
    let payload: unknown;
    try {
      payload = JSON.parse(fetched.buffer.toString('utf8'));
    } catch {
      throw new Error('外部 API 返回内容不是合法 JSON');
    }
    if (extractChatRows(payload).length === 0) {
      throw new Error('外部 API 中没有可识别的聊天记录数组');
    }

    const rawName = body?.name?.trim() || filenameFromUrl(fetched.finalUrl, defaultName());
    const suggested = path.basename(rawName).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || defaultName();
    const parsed = path.parse(suggested);
    const name = parsed.ext.toLowerCase() === '.json'
      ? suggested
      : `${suggested.replace(/\.[^.]*$/, '') || defaultName().replace(/\.json$/, '')}.json`;

    const row = await chatRecordFilePut(name, fetched.buffer, {
      contentType: 'application/json',
      sourceUrl: fetched.finalUrl,
    });
    return adminOk(row, 201);
  });
}
