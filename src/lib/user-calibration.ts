import { getAlzhujiaoSupabaseClient as getSupabaseClient } from '@/lib/supabase-clients';
import { tableName } from '@/storage/database/table-names';

type Row = Record<string, unknown>;

export interface CalibrationResult {
  agents: number;
  miniUsers: number;
  success: number;
  failed: number;
  calibratedAt: string;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Row | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Row)
    : null;
}

function firstNonNull(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}

function minTimestamp(...values: unknown[]): string | null {
  const times = values
    .map((value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value)) as number[];
  return times.length > 0 ? new Date(Math.min(...times)).toISOString() : null;
}

function maxTimestamp(...values: unknown[]): string | null {
  const times = values
    .map((value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value)) as number[];
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

async function fetchAllRows(table: string, select: string): Promise<Row[]> {
  const client = getSupabaseClient();
  const pageSize = 1000;
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select(select)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`读取 ${table} 失败：${error.message}`);
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** 以智能体用户为基础，按手机号匹配小程序用户，生成最终校准表 user_info。 */
export async function calibrateUsersByPhone(): Promise<CalibrationResult> {
  const client = getSupabaseClient();
  const calibratedAt = new Date().toISOString();
  const agentFields = [
    'id',
    'phone',
    'nick_name',
    'real_name',
    'avatar_url',
    'openid',
    'unionid',
    'group_openid',
    'gender',
    'birthday',
    'location',
    'source_detail',
    'status',
    'raw_data',
    'created_at',
    'updated_at',
  ].join(',');
  const miniFields = [
    'id',
    'phone',
    'nick_name',
    'real_name',
    'avatar_url',
    'openid',
    'unionid',
    'mini_openid',
    'mp_openid',
    'gender',
    'birthday',
    'location',
    'source_detail',
    'status',
    'raw_data',
    'created_at',
    'updated_at',
  ].join(',');

  const [agents, miniUsers] = await Promise.all([
    fetchAllRows(tableName('user_info_agent'), agentFields),
    fetchAllRows(tableName('user_info_mini'), miniFields),
  ]);
  if (agents.length === 0) throw new Error('智能体用户信息表为空，无法开始校准');

  const miniByPhone = new Map<string, Row>();
  for (const user of miniUsers) {
    const phone = asText(user.phone);
    if (phone) miniByPhone.set(phone, user);
  }

  // 只重置上一轮校准生成的记录，避免影响手工导入的其他用户。
  const reset = await client
    .from(tableName('user_info'))
    .update({ calibration_status: 'pending', calibration_at: null })
    .eq('source_type', 'calibrated');
  if (reset.error) throw new Error(`重置校准状态失败：${reset.error.message}`);

  let success = 0;
  let failed = 0;

  for (const agent of agents) {
    const phone = asText(agent.phone);
    if (!phone) {
      failed += 1;
      continue;
    }
    const mini = miniByPhone.get(phone);
    const matched = Boolean(mini);
    const agentRaw = asRecord(agent.raw_data) ?? {};
    const miniRaw = mini ? asRecord(mini.raw_data) ?? {} : null;

    const genderValue = Number(firstNonNull(mini?.gender, agent.gender));
    const statusValue = Number(firstNonNull(agent.status, mini?.status));
    const row: Row = {
      nick_name: asText(firstNonNull(mini?.nick_name, agent.nick_name)) || phone,
      real_name: firstNonNull(mini?.real_name, agent.real_name),
      avatar_url: firstNonNull(mini?.avatar_url, agent.avatar_url),
      openid: firstNonNull(agent.openid, mini?.openid),
      unionid: firstNonNull(agent.unionid, mini?.unionid),
      mini_openid: mini?.mini_openid ?? null,
      mp_openid: mini?.mp_openid ?? null,
      group_openid: agent.group_openid ?? null,
      gender: Number.isFinite(genderValue) ? Math.trunc(genderValue) : 0,
      phone,
      birthday: firstNonNull(mini?.birthday, agent.birthday),
      location: firstNonNull(mini?.location, agent.location),
      source_type: 'calibrated',
      source_detail: matched
        ? '智能体用户为主，小程序用户手机号校准成功'
        : '智能体用户，未找到对应小程序用户',
      profile: {
        agent: agentRaw,
        mini: miniRaw,
      },
      status: Number.isFinite(statusValue) ? Math.trunc(statusValue) : 1,
      privacy_consent: 1,
      first_seen_at: minTimestamp(agent.created_at, mini?.created_at),
      last_active_at: maxTimestamp(agent.updated_at, mini?.updated_at),
      merge_status: matched ? '已校准' : '校准失败',
      calibration_status: matched ? 'success' : 'failed',
      calibration_at: calibratedAt,
      calibration_message: matched ? '手机号匹配成功' : '小程序用户信息缺失',
      survey_answers_raw: {},
      health_questionnaire_raw: {},
      health_consent: 1,
    };

    const { data: calibrated, error: upsertError } = await client
      .from(tableName('user_info'))
      .upsert(row, { onConflict: 'phone' })
      .select('id')
      .maybeSingle();
    if (upsertError) throw new Error(`写入校准用户失败（${phone}）：${upsertError.message}`);
    const calibratedId = Number((calibrated as { id?: number | string } | null)?.id);
    const calibratedUserId = Number.isFinite(calibratedId) ? calibratedId : null;

    const agentUpdate = await client
      .from(tableName('user_info_agent'))
      .update({
        calibration_status: matched ? 'success' : 'failed',
        calibration_at: calibratedAt,
        calibrated_user_id: calibratedUserId,
      })
      .eq('id', agent.id);
    if (agentUpdate.error) throw new Error(`更新智能体校准状态失败：${agentUpdate.error.message}`);

    if (mini) {
      const miniUpdate = await client
        .from(tableName('user_info_mini'))
        .update({
          calibration_status: 'success',
          calibration_at: calibratedAt,
          calibrated_user_id: calibratedUserId,
        })
        .eq('id', mini.id);
      if (miniUpdate.error) throw new Error(`更新小程序校准状态失败：${miniUpdate.error.message}`);
    }

    if (matched) success += 1;
    else failed += 1;
  }

  return {
    agents: agents.length,
    miniUsers: miniUsers.length,
    success,
    failed,
    calibratedAt,
  };
}


export interface CalibrationStats {
  success: number;
  failed: number;
  pending: number;
}

/** 校准结果统计，用于用户信息管理页展示。 */
export async function getUserCalibrationStats(): Promise<CalibrationStats> {
  const client = getSupabaseClient();
  const count = async (status: string) => {
    const { count: total, error } = await client
      .from(tableName('user_info'))
      .select('id', { count: 'exact', head: true })
      .eq('source_type', 'calibrated')
      .eq('calibration_status', status);
    if (error) throw new Error(`读取校准统计失败：${error.message}`);
    return total ?? 0;
  };
  const [success, failed, pending] = await Promise.all([
    count('success'),
    count('failed'),
    count('pending'),
  ]);
  return { success, failed, pending };
}
