/**
 * 服务端运行时配置。
 *
 * 所有部署相关的值都从环境变量读取，禁止硬编码绝对路径与密钥。
 * - KNOWLEDGE_BASE_ROOT: 知识库根目录（文件仓库适配层的挂载点，即"索引区"）
 * - STAGING_ROOT: 暂存区目录（上传先落这里，确认后才移入索引区；缺省为 cwd/staging）
 * - FASTGPT_FILE_LIBRARY_TOKEN: Bearer Token
 * - PUBLIC_BASE_URL: 对外绝对地址（用于拼接 previewUrl / read url），缺省时按请求头推断
 * - MAX_TEXT_BYTES: 文本文件直接内联返回 content 的体积上限
 * - SCAN_CACHE_TTL_MS: 文件索引缓存时间
 * - IGNORE_NAMES: 额外忽略的文件/目录名（逗号分隔）
 * - INCLUDE_HIDDEN: 是否纳入点号开头的隐藏文件（默认 false）
 * - REQUIRE_RAW_TOKEN: 原始文件下载是否强制鉴权（默认 false，FastGPT 下载 previewUrl 时不带鉴权头）
 */
import path from 'path';
import fs from 'fs';

export const ROOT_FOLDER_ID = 'root';

/**
 * 运行时读取环境变量。
 * 生产环境（部署面板注入、无 .env.local）以 process.env 为准；
 * 开发环境 .env.local 是运行时权威（避免 dev server 启动时带入的历史旧值，
 * 导致运行中拿不到最新配置——例如更新 VOLCANO_API_KEY 后无需重启即生效）。
 * 注意：仅在 Node runtime（非 edge）下使用，且不做任何密钥输出。
 */
export function loadEnvLocal(name: string): string {
  const isDev = process.env.APP_ENV !== 'PROD' && process.env.NODE_ENV !== 'production';
  // 开发环境：以 .env.local 为运行时权威（避免 dev server 启动时带入的历史旧值覆盖用户最新配置）
  if (isDev) {
    const localVal = readDotEnvLocal(name);
    if (localVal !== '') return localVal;
  }
  // 1) 优先部署面板 / 运行时注入的环境变量（生产环境以此为权威）
  const injected = process.env[name];
  if (injected !== undefined && injected !== '') return injected;
  // 2) 回退：本地开发时读项目根 .env.local（dev server 未注入该变量的情况下兜底）
  const localFallback = readDotEnvLocal(name);
  if (localFallback !== '') return localFallback;
  return '';
}

function readDotEnvLocal(name: string): string {
  try {
    const raw = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf8');
    const line = raw.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    if (line) {
      let val = line.slice(name.length + 1).trim();
      // 去掉可能的引号
      if (val.length >= 2) {
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
      }
      if (val !== '') return val;
    }
  } catch {
    /* 无 .env.local 时忽略 */
  }
  return '';
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function resolveKnowledgeBaseRoot(): string {
  const custom = process.env.KNOWLEDGE_BASE_ROOT?.trim();
  if (custom) return path.resolve(custom);
  // 默认挂载点：项目根目录下的 knowledge-base（仓库自带示例目录，部署后可被挂载覆盖）
  return path.resolve(process.cwd(), 'knowledge-base');
}

function resolveStagingRoot(): string {
  const custom = process.env.STAGING_ROOT?.trim();
  if (custom) return path.resolve(custom);
  // 默认暂存区：知识库根目录下的 staging（上传待审）
  return path.resolve(resolveKnowledgeBaseRoot(), 'staging');
}

function resolveActiveRoot(): string {
  const custom = process.env.ACTIVE_ROOT?.trim();
  if (custom) return path.resolve(custom);
  // 默认有效区：知识库根目录下的 active（审核通过后 FastGPT 只读这里）
  return path.resolve(resolveKnowledgeBaseRoot(), 'active');
}

export const config = {
  knowledgeBaseRoot: resolveKnowledgeBaseRoot(),
  stagingRoot: resolveStagingRoot(),
  activeRoot: resolveActiveRoot(),
  // 用户信息、聊天记录等中间文件的本地持久化根目录（正式上传数据库前只落本地）。
  localDataRoot: process.env.LOCAL_DATA_ROOT?.trim()
    ? path.resolve(process.env.LOCAL_DATA_ROOT.trim())
    : path.resolve(resolveKnowledgeBaseRoot(), 'local-data'),
  authToken: loadEnvLocal('FASTGPT_FILE_LIBRARY_TOKEN'),
  publicBaseUrl: (loadEnvLocal('PUBLIC_BASE_URL') || loadEnvLocal('APP_BASE_URL')).trim().replace(/\/+$/, ''),
  maxTextBytes: readNumber('MAX_TEXT_BYTES', 5 * 1024 * 1024),
  scanCacheTtlMs: readNumber('SCAN_CACHE_TTL_MS', 10_000),
  includeHidden: readBool('INCLUDE_HIDDEN', false),
  requireRawToken: readBool('REQUIRE_RAW_TOKEN', false),
  ignoreNames: new Set(
    (process.env.IGNORE_NAMES ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  ),
  // 同步状态记录文件（记录每个正式库文件最后成功同步到火山的时间戳），存放于知识库根目录
  volcanoSyncStatePath: path.resolve(resolveKnowledgeBaseRoot(), '.volcano-sync-state.json'),
  // ===== 火山知识库（KnowledgeBase / VikingDB）同步 =====
  volcanoBaseUrl: loadEnvLocal('VOLCANO_BASE_URL')
    .trim()
    .replace(/\/+$/, '')
    .replace(/^https?:\/\//, '') || 'api-knowledgebase.mlp.cn-beijing.volces.com',
  volcanoApiKey: loadEnvLocal('VOLCANO_API_KEY'),
  volcanoServiceId: loadEnvLocal('VOLCANO_SERVICE_ID'),
  volcanoCollection: loadEnvLocal('VOLCANO_COLLECTION') || 'DCAI',
  volcanoProject: loadEnvLocal('VOLCANO_PROJECT') || 'default',
  // 文档处理策略（doc/v2/add 的 strategy 参数，指定切分/解析策略）
  volcanoStrategy: loadEnvLocal('VOLCANO_STRATEGY') || 'kb-strategy-49b76d085c9572f1',
  // 从火山知识库下载 tos_fe 原始文件所需的对象存储凭据（不是 VIKING_API_KEY）
  volcanoTosAccessKey:
    loadEnvLocal('VOLCANO_TOS_ACCESS_KEY') || loadEnvLocal('TOS_ACCESS_KEY'),
  volcanoTosSecretKey:
    loadEnvLocal('VOLCANO_TOS_SECRET_KEY') || loadEnvLocal('TOS_SECRET_KEY'),
  volcanoTosSecurityToken:
    loadEnvLocal('VOLCANO_TOS_SECURITY_TOKEN') || loadEnvLocal('TOS_SECURITY_TOKEN'),
  volcanoTosRegion: loadEnvLocal('VOLCANO_TOS_REGION') || 'cn-beijing',
  volcanoTosEndpoint:
    loadEnvLocal('VOLCANO_TOS_ENDPOINT')
      .trim()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '') || 'tos-cn-beijing.volces.com',
  volcanoTosBucket: loadEnvLocal('VOLCANO_TOS_BUCKET').trim(),

  // ===== 用户信息加工 =====
  // DS 模型（DeepSeek）API：用于「解析」用户信息 docx 内容，生成用户信息数据
  // 支持两种模型来源：
  //  - 火山方舟（Volcano Ark）托管 DeepSeek：配置 ARK_API_KEY / ARK_MODEL（或 ARK_BASE_URL）
  //  - 官方 DeepSeek：配置 DS_API_KEY / DS_BASE_URL / DS_MODEL
  // provider 规则：配置了 ARK_API_KEY 优先走方舟，否则走官方 DeepSeek。
  arkApiKey: loadEnvLocal('ARK_API_KEY'),
  arkBaseUrl:
    loadEnvLocal('ARK_BASE_URL').trim().replace(/\/+$/, '') || 'https://ark.cn-beijing.volces.com/api/v3',
  arkModel: loadEnvLocal('ARK_MODEL') || loadEnvLocal('ARK_ENDPOINT') || 'deepseek-v3.1',
  dsApiKey: loadEnvLocal('DS_API_KEY'),
  dsBaseUrl: loadEnvLocal('DS_BASE_URL').trim().replace(/\/+$/, '') || 'https://api.deepseek.com',
  dsModel: loadEnvLocal('DS_MODEL') || 'deepseek-chat',
  // 用户数据使用独立的 Alzhujiao Supabase 实例，不与火山知识库实例混用。
  // 旧 SUPABASE_* / SHARE_SUPABASE_* 变量仅作为兼容回退。
  shareSupabaseUrl:
    loadEnvLocal('ALZHUJIAO_SUPABASE_URL') ||
    loadEnvLocal('SUPABASE_URL') ||
    loadEnvLocal('SHARE_SUPABASE_URL'),
  shareSupabaseKey:
    loadEnvLocal('ALZHUJIAO_SUPABASE_KEY') ||
    loadEnvLocal('ALZHUJIAO_SUPABASE_PUBLISHABLE_KEY') ||
    loadEnvLocal('SUPABASE_PUBLISHABLE_KEY') ||
    loadEnvLocal('SUPABASE_ANON_KEY') ||
    loadEnvLocal('SHARE_SUPABASE_KEY') ||
    loadEnvLocal('SHARE_SUPABASE_PUBLISHABLE_KEY'),
  shareSupabaseSecretKey:
    loadEnvLocal('ALZHUJIAO_SUPABASE_KEY') ||
    loadEnvLocal('ALZHUJIAO_SUPABASE_SECRET_KEY') ||
    loadEnvLocal('SUPABASE_SECRET_KEY') ||
    loadEnvLocal('SUPABASE_SERVICE_ROLE_KEY') ||
    loadEnvLocal('SHARE_SUPABASE_SECRET_KEY') ||
    loadEnvLocal('SHARE_SUPABASE_SERVICE_ROLE_KEY'),
  shareTableName: loadEnvLocal('SHARE_TABLE_NAME') || 'user_info',

  // ===== 外部数据源 =====
  // 谷乐斯小程序全字段用户数据：服务端使用 X-API-Key 读取，密钥不得下发浏览器。
  gulesiBaseUrl:
    loadEnvLocal('GULESI_BASE_URL').trim().replace(/\/+$/, '') || 'https://api.gulesi.com',
  gulesiApiKey: loadEnvLocal('GULESI_API_KEY'),
  // 智能体聊天记录 API：地址和密钥在用户提供后通过部署环境变量注入。
  agentChatApiUrl: loadEnvLocal('AGENT_CHAT_API_URL').trim(),
  agentChatApiKey: loadEnvLocal('AGENT_CHAT_API_KEY'),
  agentChatApiKeyHeader: loadEnvLocal('AGENT_CHAT_API_KEY_HEADER').trim() || 'Authorization',
  // 智能体用户信息 API：独立于聊天记录 API，待提供后配置。
  agentUserApiUrl: loadEnvLocal('AGENT_USER_API_URL').trim(),
  agentUserApiKey: loadEnvLocal('AGENT_USER_API_KEY'),
  agentUserApiKeyHeader: loadEnvLocal('AGENT_USER_API_KEY_HEADER').trim() || 'Authorization',
};

export function isAuthConfigured(): boolean {
  return config.authToken.length > 0;
}

/** 常量时间比较，避免令牌比较的计时侧信道。 */
export function tokenEqual(provided: string, expected: string): boolean {
  if (!expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}




