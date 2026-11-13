import { config } from './config';

const GULESI_USERS_PATH = '/api/external/v1/users';
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
const MAX_RETRIES = 3;

type JsonRecord = Record<string, unknown>;

export const GULESI_USER_SOURCE = 'gulesi_mini_program';

export interface GulesiFetchResult {
  rows: JsonRecord[];
  total: number;
  pages: number;
  skipped: number;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const n = asNumber(value);
  return n === null ? null : Math.trunc(n);
}

function asDateOnly(value: unknown): string | null {
  const text = asText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function asTimestamp(value: unknown): string | null {
  const text = asText(value);
  if (!text || text.includes('*')) return null;
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text) ? text : null;
}

function maskPhone(phone: string): string | null {
  if (phone.length < 7) return null;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function normalizeGender(value: unknown): number {
  const text = asText(value).toLowerCase();
  if (['1', 'male', 'm', '男'].includes(text)) return 1;
  if (['2', 'female', 'f', '女'].includes(text)) return 2;
  return 0;
}

function calculateAge(birthday: string | null): number | null {
  if (!birthday) return null;
  const born = new Date(`${birthday}T00:00:00+08:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const month = now.getMonth() - born.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < born.getDate())) age -= 1;
  return age >= 0 && age <= 150 ? age : null;
}

/** 判断一个对象是否是谷乐斯 UserProfile（批量页与单手机号接口共用结构）。 */
export function isGulesiUserProfile(value: unknown): value is JsonRecord {
  const profile = asRecord(value);
  return Boolean(profile && asRecord(profile.basic) && asText(profile.id));
}

/** 从原始谷乐斯响应中提取 UserProfile；也兼容 data.items[] 分页包装。 */
export function extractGulesiProfiles(payload: unknown): JsonRecord[] {
  const root = asRecord(payload);
  if (!root) return [];
  if (asRecord(root.basic) && asText(root.id)) return [root];
  const data = asRecord(root.data);
  if (!data) return [];
  if (Array.isArray(data.items)) return data.items.filter(isGulesiUserProfile);
  if (asRecord(data.basic) && asText(data.id)) return [data];
  return [];
}

/**
 * 将谷乐斯全字段档案映射为本项目 user_info 行。
 * 谷乐斯原始档案完整保存在 profile 字段，映射列用于列表检索和手机号关联。
 */
export function gulesiProfileToUserInfo(value: JsonRecord): JsonRecord {
  const profile = value;
  const basic = asRecord(profile.basic) ?? {};
  const firstSource = asRecord(profile.first_source) ?? {};
  const enrollment = asRecord(profile.enrollment) ?? {};
  const latestAssessment = asRecord(profile.latest_assessment) ?? {};
  const assessmentResult = asRecord(latestAssessment.result) ?? {};
  const geneTest = asRecord(profile.current_gene_test) ?? {};
  const scale = asRecord(profile.scale) ?? {};
  const dashboard = asRecord(scale.dashboard) ?? {};
  const latest = asRecord(dashboard.latest) ?? {};
  const latestCheckin = Array.isArray(scale.recent_checkins)
    ? asRecord(scale.recent_checkins[0]) ?? {}
    : {};

  const phone = asText(basic.phone);
  const realName = asText(basic.name);
  const nickname = asText(basic.nickname) || realName || phone || '谷乐斯用户';
  const birthday = asDateOnly(basic.birthday);
  const sourceCode = asText(firstSource.source_code);
  const groupName = asText(firstSource.group_name);

  return {
    user_no: asText(profile.id) || null,
    nick_name: nickname,
    avatar_url: asText(basic.avatar_url) || null,
    gender: normalizeGender(enrollment.gender),
    phone,
    phone_mask: maskPhone(phone),
    phone_verified: Boolean(phone),
    phone_source: '谷乐斯小程序',
    phone_authorized: Boolean(phone),
    real_name: realName || null,
    is_authorized: true,
    birthday,
    age: calculateAge(birthday),
    location: asText(basic.location) || null,
    source_type: 'mini_program',
    source_detail: '谷乐斯小程序全字段 API',
    tags: [
      sourceCode ? { type: 'source_code', value: sourceCode } : null,
      groupName ? { type: 'wechat_group', value: groupName } : null,
    ].filter(Boolean),
    profile,
    status: 1,
    remark: '谷乐斯小程序 API 同步',
    privacy_consent: 1,
    consent_time: asTimestamp(basic.created_at),
    first_seen_at: asTimestamp(basic.created_at),
    last_active_at: asTimestamp(basic.last_measured_at) || asTimestamp(profile.updated_at),
    merge_status: '正常',
    wechat_profile_updated_at: asTimestamp(profile.updated_at),
    enroll_status: asText(basic.enrollment_status) || asText(enrollment.status) || null,
    enroll_time: asTimestamp(enrollment.completed_at),
    first_source_group_id: asText(firstSource.group_id) || null,
    first_source_group_name: groupName || null,
    join_group_at: asTimestamp(firstSource.visited_at),
    customer_info_raw: Object.keys(firstSource).length > 0 ? firstSource : null,
    gene_bind_status: asText(basic.gene_status) || asText(geneTest.status) || null,
    gene_phone: phone || null,
    gene_sample_id: asText(geneTest.code) || null,
    gene_bindings_raw: Object.keys(geneTest).length > 0 ? geneTest : null,
    scale_completed: Boolean(dashboard.latest),
    scale_created_at: asTimestamp(latest.measured_at) || asTimestamp(latestCheckin.checkin_date),
    scale_updated_at: asTimestamp(latest.measured_at) || asTimestamp(latestCheckin.checkin_date),
    scale_weight_kg: asNumber(latest.weight_kg),
    bmi: asNumber(latest.bmi),
    body_fat_rate: asNumber(latest.body_fat_percent),
    muscle_mass: asNumber(latest.muscle_mass_kg),
    water_rate: asNumber(latest.water_percent),
    basal_metabolism: asInteger(latest.bmr_kcal),
    bone_mass: asNumber(latest.bone_mass_kg),
    visceral_fat_level: asInteger(latest.visceral_fat_level),
    protein_rate: asNumber(latest.protein_percent),
    body_age: asInteger(latest.body_age),
    fat_free_mass: asNumber(latest.lean_body_mass_kg),
    body_type: asText(latest.body_shape) || null,
    scale_score: asInteger(latest.body_score),
    scale_history_raw: scale,
    survey_answers_raw: latestAssessment.answers ?? {},
    health_questionnaire_id: asText(latestAssessment.id) || null,
    health_survey_time: asTimestamp(latestAssessment.submitted_at),
    health_questionnaire_raw: enrollment.extra ?? enrollment ?? {},
    health_profile_ext: {
      first_source: firstSource,
      enrollment,
      latest_assessment: latestAssessment,
      current_gene_test: geneTest,
      learning: profile.learning ?? null,
    },
    health_data_source: 'gulesi',
    health_data_updated_at: asTimestamp(profile.updated_at),
    health_consent: 1,
    height_cm: asNumber(enrollment.height_cm),
    health_weight_kg: asNumber(latest.weight_kg) ?? asNumber(enrollment.baseline_weight_kg),
    heart_rate: asInteger(latest.heart_rate_bpm),
    health_goal: enrollment.goals ?? null,
    health_risk_tags: assessmentResult.code ? [assessmentResult.code] : null,
    current_stage: asText(basic.enrollment_status) || asText(enrollment.status) || null,
    progress_raw: profile.learning ?? null,
    progress_updated_at: asTimestamp(profile.updated_at),
    report_images_raw: dashboard.ketone_photos ?? [],
  };
}

function errorDetail(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  const message = asText(error?.message) || asText(root?.message);
  const code = asText(error?.code) || asText(root?.code);
  const requestId = asText(error?.request_id) || asText(root?.request_id);
  return [code, message, requestId ? `request_id=${requestId}` : ''].filter(Boolean).join(' / ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestGulesiPage(page: number, pageSize: number): Promise<JsonRecord> {
  const url = new URL(GULESI_USERS_PATH, config.gulesiBaseUrl);
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));

  let lastError = '';
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-API-Key': config.gulesiApiKey,
        },
        signal: AbortSignal.timeout(30_000),
        cache: 'no-store',
      });
      const text = await response.text();
      let payload: unknown = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = text;
      }
      if (response.ok) {
        const root = asRecord(payload);
        const data = asRecord(root?.data);
        return data ?? {};
      }

      const detail = errorDetail(payload) || `HTTP ${response.status}`;
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES - 1) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      throw new Error(`谷乐斯 API 请求失败：${detail}`);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
    }
  }
  throw new Error(lastError || '谷乐斯 API 请求失败');
}

/** 读取谷乐斯全部用户，返回已经映射好的 user_info 行。 */
export async function fetchGulesiUserRows(): Promise<GulesiFetchResult> {
  if (!config.gulesiApiKey) {
    throw new Error('谷乐斯 API 未配置：请设置 GULESI_API_KEY');
  }

  const rows: JsonRecord[] = [];
  let page = 1;
  let total = 0;
  let pages = 0;
  let skipped = 0;

  while (page <= MAX_PAGES) {
    const data = await requestGulesiPage(page, PAGE_SIZE);
    const items = Array.isArray(data.items) ? data.items.filter(isGulesiUserProfile) : [];
    total = asInteger(data.total) ?? total;
    pages = page;

    for (const profile of items) {
      if (asText(profile.sensitive_data_mode) !== 'full') {
        throw new Error('谷乐斯 API 未返回完整敏感字段，请确认密钥具备 sensitive_data.full 权限');
      }
      const row = gulesiProfileToUserInfo(profile);
      if (!asText(row.phone)) {
        skipped += 1;
        continue;
      }
      rows.push(row);
    }

    if (items.length === 0 || page * PAGE_SIZE >= total) break;
    page += 1;
  }

  if (page > MAX_PAGES) {
    throw new Error(`谷乐斯用户数量超过单次安全读取上限（${MAX_PAGES * PAGE_SIZE} 条）`);
  }
  if (rows.length === 0) throw new Error('谷乐斯 API 没有返回带手机号的用户数据');

  return { rows, total: total || rows.length, pages, skipped };
}
