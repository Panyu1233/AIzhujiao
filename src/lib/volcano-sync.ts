import { promises as fs } from 'fs';
import path from 'path';
import { TosClient } from '@volcengine/tos-sdk';
import { config, loadEnvLocal } from './config';
import { ensureDir, safeRelIn, listFiles } from './file-utils';
import { getAllSyncState, markSynced } from './volcano-state';
import { refreshIndex } from './file-repo';

/**
 * 火山知识库（KnowledgeBase / VikingDB）同步适配层。
 *
 * 对接新一代服务化接口：POST /api/knowledge/doc/v2/add
 * - 用 uri 指定文档来源（url 公网可下载链接，或 tos:// 路径）。
 *   本系统使用 url 方式：把已进入 active 区的文件通过公网 /v1/raw 下载地址交给火山拉取，
 *   无需额外上传文件或开通 TOS。
 * - 知识库定位：collection_name + project（与用户示例代码一致），service 模式下也可走 resource_id。
 * - doc_id 规则：[1,128]，仅【英文字母、数字、下划线】，以英文字母或下划线开头；
 *   多次上传相同 doc_id 会覆盖旧文档（实现"更新"）。
 */

export interface VolcanoSyncResult {
  ok: boolean;
  /** 火山返回的请求标识（便于排查） */
  requestId?: string;
  /** 失败原因 */
  error?: string;
}

/** 文档类型映射（非结构化：txt/doc/docx/pdf/markdown/pptx/ppt/jpeg/png/...；结构化：xlsx/csv/jsonl） */
const DOC_TYPE_MAP: Record<string, string> = {
  '.txt': 'txt',
  '.doc': 'doc',
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.pptx': 'pptx',
  '.ppt': 'ppt',
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.bmp': 'bmp',
  '.xlsx': 'xlsx',
  '.csv': 'csv',
  '.jsonl': 'jsonl',
};

export function safeDocId(filename: string): string {
  const ext = filename.lastIndexOf('.');
  const stem = ext > 0 ? filename.slice(0, ext) : filename;
  // 仅保留合法字符：英文字母、数字、下划线、连字符（火山 doc_id 规则）
  let id = stem.replace(/[^a-zA-Z0-9_-]/g, '_');
  // 折叠连续下划线，并去掉首尾的下划线/连字符（最后不能是 -）
  id = id.replace(/_+/g, '_').replace(/^[_-]+|[_-]+$/g, '');
  // 必须非空，且首字符须为英文字母（火山要求首字符为 letter 或 _，为可读性用字母）
  if (!id) return docWithHash(stem);
  if (!/^[a-zA-Z]/.test(id)) id = `doc_${id}`;
  return id.slice(0, 128);
}

/** 当纯中文等无法提取出合法字符时，退化为稳定短哈希，保证唯一且合法。 */
function docWithHash(stem: string): string {
  let h = 0;
  for (let i = 0; i < stem.length; i++) {
    h = (h * 31 + stem.charCodeAt(i)) | 0;
  }
  const abs = Math.abs(h).toString(36);
  return `doc_${abs}`;
}

/**
 * 将已进入 active 区、能通过公网 /v1/raw 访问的文件同步到火山知识库。
 * @param filename 相对 active 根的文件名（含扩展名）
 * @param publicFileUrl 该文件在公网可下载的原始地址（/v1/raw/...）
 */
export async function syncToVolcano(
  filename: string,
  publicFileUrl: string,
): Promise<VolcanoSyncResult> {
  // 运行时读取最新 API Key（dev 更新 .env.local 后无需重启即生效）
  const apiKey = loadEnvLocal('VOLCANO_API_KEY');
  // 未配置 API Key：视为未启用，明确提示（不静默成功，让后台能看到原因）
  if (!config.volcanoApiKey && !apiKey) {
    return { ok: false, error: '未配置 VOLCANO_API_KEY，火山同步已跳过' };
  }

  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  const docType = DOC_TYPE_MAP[ext] ?? '';
  if (!docType) {
    return { ok: false, error: `暂不支持的文档类型：${ext}（火山 doc/add 不支持）` };
  }

  const endpoint = `https://${config.volcanoBaseUrl}/api/knowledge/doc/v2/add`;
  // v2/add 精简参数：用 uri 指定 url 来源；doc_name 可由 url 提取，但显式传更稳。
  // 知识库定位与用户示例代码一致：collection_name + project。
  const body: Record<string, string> = {
    doc_id: safeDocId(filename),
    doc_type: docType,
    uri: publicFileUrl,
    strategy_resource_id: config.volcanoStrategy,
  };
  if (config.volcanoCollection) {
    body.collection_name = config.volcanoCollection;
    body.project = config.volcanoProject;
  } else if (config.volcanoServiceId) {
    // 退路：仅当 collection 未配置时才用服务 ID 作为 resource_id
    body.resource_id = config.volcanoServiceId;
  }
  // doc_name 不能含 < > : ' " / \ | ? * 及空格
  if (filename) {
    body.doc_name = filename.replace(/[<>:'"/\\|?*\s]/g, '_');
  }

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      // 方舟知识库解析文档可能耗时较长，给足超时
      signal: AbortSignal.timeout(60_000),
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }

    if (!resp.ok) {
      return {
        ok: false,
        error: `火山接口响应 ${resp.status}：${formatPayload(parsed)}`,
      };
    }

    // 业务成功判定：code 为 0 表示成功
    const rc = (parsed as { code?: number })?.code;
    if (rc !== undefined && rc !== 0) {
      const p = parsed as { message?: string; request_id?: string };
      return { ok: false, error: `火山返回 code=${rc}：${p?.message ?? formatPayload(parsed)}`, requestId: p?.request_id };
    }

    const p2 = parsed as { request_id?: string; requestId?: string } | null;
    const rq = p2?.request_id ?? p2?.requestId;
    return { ok: true, requestId: rq };
  } catch (err) {
    return { ok: false, error: `调用火山失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

function formatPayload(v: unknown): string {
  if (v == null) return '空响应';
  if (typeof v === 'string') return v.slice(0, 300);
  try {
    const s = JSON.stringify(v);
    return (s ?? '').slice(0, 300);
  } catch {
    return String(v);
  }
}

// ======================= 从火山知识库拉取到本地 =======================

export interface VolcanoDocItem {
  doc_id: string;
  doc_name: string;
  doc_type: string;
  add_type?: string;
  url?: string;
  tos_path?: string;
  doc_size?: number;
  status?: { process_status?: number };
}

/** 分页拉取火山知识库全部文档清单 */
export async function listVolcanoDocs(): Promise<VolcanoDocItem[]> {
  const apiKey = loadEnvLocal('VOLCANO_API_KEY');
  if (!apiKey) {
    throw new Error('未配置 VOLCANO_API_KEY，无法从火山知识库拉取');
  }
  const docs: VolcanoDocItem[] = [];
  let nextToken: string | undefined;
  const endpoint = `https://${config.volcanoBaseUrl}/api/knowledge/doc/v2/list`;
  do {
    const body: Record<string, unknown> = { limit: 100 };
    if (config.volcanoCollection) {
      body.collection_name = config.volcanoCollection;
      body.project = config.volcanoProject;
    } else if (config.volcanoServiceId) {
      body.resource_id = config.volcanoServiceId;
    }
    if (nextToken) body.next_token = nextToken;

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await resp.text();
    let parsed: { code?: number; message?: string; data?: { doc_list?: VolcanoDocItem[]; next_token?: string } } | null = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!resp.ok || (parsed && parsed.code !== undefined && parsed.code !== 0)) {
      throw new Error(`火山 doc/list 失败：${resp.status} ${formatPayload(parsed)}`);
    }
    const data = parsed?.data;
    if (data?.doc_list) docs.push(...data.doc_list);
    nextToken = data?.next_token;
    if (!nextToken) break;
  } while (true);
  return docs;
}

export interface SyncFromVolcanoItem {
  doc_name: string;
  doc_type: string;
  /** synced=已下载 / skipped=已存在 / no-url=TOS无公网链接需手动导出 / failed=下载失败 */
  status: 'synced' | 'skipped' | 'no-url' | 'failed';
  reason?: string;
}

export interface SyncFromVolcanoResult {
  synced: number;
  skipped: number;
  noUrl: number;
  failed: number;
  items: SyncFromVolcanoItem[];
  /** 火山不可用时的诊断信息（可选） */
  error?: string;
}

/**
 * 获取火山知识库中全部文档名称集合（用于和本地 active 比对，判断某文件是否已入库）。
 * 返回 Map<docName, true>；未配置 API Key 时返回空 Map（调用方按"全部未入库/不可校验"处理）。
 */
export async function listVolcanoDocNames(): Promise<Map<string, boolean>> {
  const names = new Map<string, boolean>();
  if (!config.volcanoApiKey) return names;
  try {
    const docs = await listVolcanoDocs();
    for (const d of docs) {
      if (d.doc_name) names.set(d.doc_name, true);
      if (d.doc_id) names.set(d.doc_id, true);
    }
  } catch {
    // 拉取失败不抛，交由上层决定兜底语义（此处返回空集 = 无法比对）
  }
  return names;
}

/**
 * 删除火山知识库中的某个文档（按 doc_id 删除）。
 * 用于：单文件「删除」按钮、以及「修改」状态行级同步时先删旧文档再传新文档。
 * 未配置 API Key 时视为未启用，返回 ok=true（无操作），避免阻塞管理操作。
 */
export async function deleteVolcanoDoc(filename: string): Promise<VolcanoSyncResult> {
  const apiKey = loadEnvLocal('VOLCANO_API_KEY');
  if (!config.volcanoApiKey && !apiKey) {
    return { ok: true }; // 未启用火山：视为无需删除
  }
  const docId = safeDocId(filename);
  const endpoint = `https://${config.volcanoBaseUrl}/api/knowledge/doc/delete`;
  const body: Record<string, string> = {
    doc_id: docId,
  };
  if (config.volcanoCollection) {
    body.collection_name = config.volcanoCollection;
    body.project = config.volcanoProject;
  } else if (config.volcanoServiceId) {
    body.resource_id = config.volcanoServiceId;
  }
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await resp.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    const payload = parsed as { code?: number; message?: string } | null;
    const rc = typeof payload?.code === 'number' ? payload.code : undefined;
    const message = typeof payload?.message === 'string' ? payload.message : '';
    // 火山在 HTTP 400 中也可能返回“文档不存在”。删除本来就是幂等操作，
    // 旧文档不存在应视为已删除，继续执行后续上传，而不是中断同步。
    const missingDoc =
      rc === 100101 ||
      rc === 1001001 ||
      /doc\s+not\s+exist|document\s+not\s+exist|not\s+exist/i.test(message);
    if (missingDoc) return { ok: true };
    if (!resp.ok) {
      return { ok: false, error: `火山删除响应 ${resp.status}：${formatPayload(parsed)}` };
    }
    if (rc !== undefined && rc !== 0) {
      return { ok: false, error: `火山删除返回 code=${rc}：${message || formatPayload(parsed)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `调用火山删除失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

export interface VolcanoRestoreItem {
  name: string;
  status: 'restored' | 'skipped' | 'failed';
  source?: 'url' | 'tos';
  size?: number;
  mtimeMs?: number;
  reason?: string;
}

export interface VolcanoRestoreResult {
  restored: number;
  skipped: number;
  failed: number;
  items: VolcanoRestoreItem[];
  /** 火山清单/凭据级错误；单个文件失败仍放在 items 中。 */
  error?: string;
}

function parseTosPath(tosPath: string): { bucket: string; key: string } {
  const trimmed = tosPath.trim();
  const hasScheme = /^tos:\/\//i.test(trimmed);
  const segments = trimmed.replace(/^tos:\/\//i, '').replace(/^\/+/, '').split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('火山返回的 tos_path 格式无效，无法定位原始文件');
  }

  const configuredBucket = config.volcanoTosBucket;
  let bucket = '';
  let keySegments: string[] = [];

  if (configuredBucket && segments[0] === configuredBucket) {
    bucket = configuredBucket;
    keySegments = segments.slice(1);
  } else if (hasScheme) {
    bucket = segments[0] || '';
    keySegments = segments.slice(1);
  } else if (configuredBucket) {
    // 部分火山返回只给对象 key，不含桶名；此时使用环境变量中的桶。
    bucket = configuredBucket;
    keySegments = segments;
  } else {
    bucket = segments[0] || '';
    keySegments = segments.slice(1);
  }

  if (!bucket || keySegments.length === 0) {
    throw new Error('火山返回的 tos_path 缺少桶名或对象路径');
  }
  if (keySegments.some((s) => s === '..' || s === '.' || s.includes('\0'))) {
    throw new Error('火山返回的 tos_path 包含非法路径段');
  }
  return { bucket, key: keySegments.join('/') };
}

async function downloadVolcanoDocBuffer(doc: VolcanoDocItem): Promise<{ buffer: Buffer; source: 'url' | 'tos' }> {
  if (doc.url) {
    const resp = await fetch(doc.url, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`下载火山原始文件失败 HTTP ${resp.status}`);
    return { buffer: Buffer.from(await resp.arrayBuffer()), source: 'url' };
  }

  if (!doc.tos_path) {
    throw new Error('火山未返回可下载的 url 或 tos_path');
  }
  if (!config.volcanoTosAccessKey || !config.volcanoTosSecretKey) {
    throw new Error(
      '该文件存放在火山私有 TOS 桶，缺少 VOLCANO_TOS_ACCESS_KEY / VOLCANO_TOS_SECRET_KEY，无法读取原始文件',
    );
  }

  const { bucket, key } = parseTosPath(doc.tos_path);
  const client = new TosClient({
    accessKeyId: config.volcanoTosAccessKey,
    accessKeySecret: config.volcanoTosSecretKey,
    stsToken: config.volcanoTosSecurityToken || undefined,
    region: config.volcanoTosRegion,
    endpoint: config.volcanoTosEndpoint,
  });
  try {
    const resp = await client.getObjectV2({ bucket, key, dataType: 'buffer' });
    return { buffer: resp.data.content, source: 'tos' };
  } catch (err) {
    throw new Error(`从火山 TOS 读取原始文件失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

function docMatchesFile(doc: VolcanoDocItem, filename: string): boolean {
  const docName = path.basename(doc.doc_name || '');
  return docName === filename || doc.doc_id === safeDocId(filename);
}

/**
 * 将 local filesystem 中状态为「修改」、且火山知识库仍存在同名文档的文件还原为火山原始版本。
 * - 只处理 mtime > 最后同步时间 的文件；
 * - 本地(火山不存在/未同步)与已入库文件跳过；
 * - 成功覆盖后更新同步时间并刷新索引。
 */
export async function restoreModifiedFilesFromVolcano(options: { filename?: string } = {}): Promise<VolcanoRestoreResult> {
  const result: VolcanoRestoreResult = { restored: 0, skipped: 0, failed: 0, items: [] };
  let docs: VolcanoDocItem[];
  try {
    docs = await listVolcanoDocs();
  } catch (err) {
    result.error = err instanceof Error ? err.message : '火山知识库不可用';
    return result;
  }

  await ensureDir(config.activeRoot);
  const activeFiles = await listFiles(config.activeRoot);
  const syncState = await getAllSyncState();
  const requested = options.filename?.trim();
  if (requested && requested.includes('/')) throw new Error('filename 必须是 active 根目录下的文件名');

  for (const file of activeFiles) {
    if (requested && file.name !== requested) continue;
    const doc = docs.find((item) => docMatchesFile(item, file.name));
    if (!doc) {
      result.skipped++;
      result.items.push({ name: file.name, status: 'skipped', reason: '火山知识库中不存在该文件' });
      continue;
    }
    const last = syncState[file.name];
    if (last === undefined || file.mtimeMs <= last) {
      result.skipped++;
      result.items.push({ name: file.name, status: 'skipped', reason: '文件状态不是「修改」' });
      continue;
    }

    try {
      const downloaded = await downloadVolcanoDocBuffer(doc);
      if (doc.doc_size && downloaded.buffer.length !== doc.doc_size) {
        throw new Error(
          `原始文件大小校验失败（火山 ${doc.doc_size}B，下载 ${downloaded.buffer.length}B）`,
        );
      }
      const target = safeRelIn(config.activeRoot, file.name);
      const tmp = `${target}.volcano-restore-tmp`;
      await fs.writeFile(tmp, downloaded.buffer);
      try {
        await fs.rename(tmp, target);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST' || code === 'EPERM') {
          await fs.rm(target, { force: true });
          await fs.rename(tmp, target);
        } else {
          await fs.rm(tmp, { force: true });
          throw err;
        }
      }
      const stat = await fs.stat(target);
      await markSynced(file.name, stat.mtimeMs);
      result.restored++;
      result.items.push({
        name: file.name,
        status: 'restored',
        source: downloaded.source,
        size: downloaded.buffer.length,
        mtimeMs: stat.mtimeMs,
      });
    } catch (err) {
      result.failed++;
      result.items.push({
        name: file.name,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (requested && !activeFiles.some((f) => f.name === requested) && result.items.length === 0) {
    result.failed++;
    result.items.push({ name: requested, status: 'failed', reason: '正式库中不存在该文件' });
  }
  if (result.restored > 0) await refreshIndex();
  return result;
}

/**
 * 把火山知识库的文档拉取到本地 active 区。
 * - 仅当该文档本地缺失 且 火山提供了可下载的 url（add_type=url）时才下载；
 * - 本地已存在 → 跳过；
 * - TOS 来源（无 url）且本地缺失 → 记录 no-url（火山 API 不提供原始文件下载，需在控制台手动导出）；
 */
export async function syncFromVolcano(): Promise<SyncFromVolcanoResult> {
  let docs: VolcanoDocItem[];
  try {
    docs = await listVolcanoDocs();
  } catch (err) {
    // 火山不可用（如 key 无效/网络问题）时不整体崩溃，返回失败明细供前端降级展示
    const result: SyncFromVolcanoResult = {
      synced: 0,
      skipped: 0,
      noUrl: 0,
      failed: 0,
      error: err instanceof Error ? err.message : '火山知识库不可用',
      items: [],
    };
    return result;
  }

  await ensureDir(config.activeRoot);
  const localFiles = await listFiles(config.activeRoot);
  const localByName = new Map(localFiles.map(f => [f.name, true]));

  const result: SyncFromVolcanoResult = { synced: 0, skipped: 0, noUrl: 0, failed: 0, items: [] };

  for (const doc of docs) {
    const name = doc.doc_name || doc.doc_id || 'unnamed';
    // 跳过状态为处理失败的文档（process_status 非 0 且非 2：2 表示处理中？此处保守保留）
    const safeName = path.basename(name);
    const item: SyncFromVolcanoItem = {
      doc_name: name,
      doc_type: doc.doc_type,
      status: 'skipped',
    };

    if (localByName.has(safeName)) {
      // 本地已有同名文件，跳过
      item.status = 'skipped';
      result.skipped++;
      result.items.push(item);
      continue;
    }

    if (!doc.url) {
      // TOS 来源或无法获得公网链接
      item.status = 'no-url';
      item.reason = '火山未提供公网下载链接，需在火山控制台手动导出该文档';
      result.noUrl++;
      result.items.push(item);
      continue;
    }

    // 尝试下载
    try {
      const targetAbs = path.join(config.activeRoot, safeName);
      const resp = await fetch(doc.url, { signal: AbortSignal.timeout(60_000) });
      if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`);
      const buf = Buffer.from(await resp.arrayBuffer());
      // 用临时文件原子写入，避免写一半
      const tmp = `${targetAbs}.volcano-tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, targetAbs);
      localByName.set(safeName, true);
      item.status = 'synced';
      result.synced++;
    } catch (err) {
      item.status = 'failed';
      item.reason = err instanceof Error ? err.message : String(err);
      result.failed++;
    }
    result.items.push(item);
  }
  return result;
}