import { getAlzhujiaoSupabaseClient as getSupabaseClient } from '@/lib/supabase-clients';
import { tableName } from '@/storage/database/table-names';

export interface ChatRecordItem {
  message_id: string | number;
  wechat_msg_id?: string | null;
  session_id?: string | null;
  group_id: string;
  group_name_snapshot?: string | null;
  sender_openid?: string | null;
  sender_nickname_snapshot?: string | null;
  user_id?: string | number | null;
  phone_snapshot?: string | null;
  user_phone?: string | null;
  user_name?: string | null;
  customer_category_snapshot?: string | null;
  northland_member_id_snapshot?: string | null;
  box_type_snapshot?: string | null;
  detection_type_snapshot?: string | null;
  sample_id_snapshot?: string | null;
  enroll_status_snapshot?: string | null;
  business_domain_snapshot?: string | null;
  msg_type: string;
  content?: string | null;
  raw_content?: unknown;
  media_url?: string | null;
  send_time: string;
  msg_direction: string;
  is_ai_reply: number | boolean;
  robot_id?: string | number | null;
  related_knowledge_id?: string | number | null;
  hit_status?: string | null;
  is_sensitive: number | boolean;
  desensitized_content?: string | null;
  memory_summary?: string | null;
  memory_category?: string | null;
  created_at?: string | null;
}

export interface ChatRecordFilters {
  phone?: string;
  keyword?: string;
  direction?: string;
  msgType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface ChatRecordStats {
  total: number;
  today: number;
  sensitive: number;
}

export interface ChatRecordResult {
  items: ChatRecordItem[];
  total: number;
  page: number;
  pageSize: number;
  stats: ChatRecordStats;
}

type UserLookup = {
  id?: string | number | null;
  phone?: string | null;
  nick_name?: string | null;
  real_name?: string | null;
  status?: number | string | null;
};

const CHAT_COLUMNS = [
  'message_id',
  'wechat_msg_id',
  'session_id',
  'group_id',
  'group_name_snapshot',
  'sender_openid',
  'sender_nickname_snapshot',
  'user_id',
  'phone_snapshot',
  'customer_category_snapshot',
  'northland_member_id_snapshot',
  'box_type_snapshot',
  'detection_type_snapshot',
  'sample_id_snapshot',
  'enroll_status_snapshot',
  'business_domain_snapshot',
  'msg_type',
  'content',
  'raw_content',
  'media_url',
  'send_time',
  'msg_direction',
  'is_ai_reply',
  'robot_id',
  'related_knowledge_id',
  'hit_status',
  'is_sensitive',
  'desensitized_content',
  'memory_summary',
  'memory_category',
  'created_at',
].join(', ');

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function dayBoundary(value: string | undefined, endOfDay: boolean): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
  if (!date) return null;
  return new Date(`${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`).toISOString();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function describeDatabaseError(message: string): string {
  if (/fetch failed|ECONNRESET|ECONNREFUSED|TLS|SSL|certificate|network/i.test(message)) {
    return '无法连接 Supabase：当前网络到数据库主机的 TLS 连接被重置。请确认 Supabase 项目未暂停，并检查本机网络、代理或防火墙。';
  }
  return `查询用户聊天记录失败：${message}`;
}

async function enrichUsers(items: ChatRecordItem[]): Promise<ChatRecordItem[]> {
  const client = getSupabaseClient();
  const ids = [...new Set(items.map((item) => item.user_id).filter((id): id is string | number => id !== null && id !== undefined))];
  const phones = [...new Set(items.map((item) => item.phone_snapshot).filter((phone): phone is string => Boolean(phone)))];

  const users: UserLookup[] = [];
  if (ids.length > 0) {
    const { data } = await client
      .from(tableName('user_info'))
      .select('id, phone, nick_name, real_name, status')
      .in('id', ids);
    if (data) users.push(...(data as UserLookup[]));
  }
  if (phones.length > 0) {
    const { data } = await client
      .from(tableName('user_info'))
      .select('id, phone, nick_name, real_name, status')
      .in('phone', phones);
    if (data) users.push(...(data as UserLookup[]));
  }

  const byId = new Map<string, UserLookup>();
  const byPhone = new Map<string, UserLookup>();
  for (const user of users) {
    if (user.id !== null && user.id !== undefined) byId.set(String(user.id), user);
    if (user.phone) byPhone.set(user.phone, user);
  }

  return items.map((item) => {
    const user = (item.user_id !== null && item.user_id !== undefined ? byId.get(String(item.user_id)) : undefined)
      ?? (item.phone_snapshot ? byPhone.get(item.phone_snapshot) : undefined);
    return {
      ...item,
      user_phone: user?.phone ?? item.phone_snapshot ?? null,
      user_name: user?.real_name || user?.nick_name || item.sender_nickname_snapshot || null,
    };
  });
}

export async function listChatRecords(filters: ChatRecordFilters): Promise<ChatRecordResult> {
  const client = getSupabaseClient();
  const page = clampInt(filters.page ?? 1, 1, 100000);
  const pageSize = clampInt(filters.pageSize ?? 20, 1, 100);
  const offset = (page - 1) * pageSize;
  const phone = filters.phone?.trim() ?? '';
  const keyword = filters.keyword?.trim() ?? '';

  let matchedUserIds: Array<string | number> = [];
  if (phone) {
    const { data: matchedUsers } = await client
      .from(tableName('user_info'))
      .select('id')
      .ilike('phone', `%${escapeLike(phone)}%`)
      .limit(200);
    matchedUserIds = (matchedUsers ?? [])
      .map((row) => (row as { id?: string | number }).id)
      .filter((id): id is string | number => id !== null && id !== undefined);
  }

  let query = client
    .from(tableName('chat_message'))
    .select(CHAT_COLUMNS, { count: 'exact' })
    .eq('is_deleted', 0);

  if (phone) {
    const phoneFilter = `phone_snapshot.ilike.%${escapeLike(phone)}%`;
    query = matchedUserIds.length > 0
      ? query.or(`${phoneFilter},user_id.in.(${matchedUserIds.join(',')})`)
      : query.ilike('phone_snapshot', `%${escapeLike(phone)}%`);
  }
  if (keyword) query = query.ilike('content', `%${escapeLike(keyword)}%`);
  if (filters.direction) query = query.eq('msg_direction', filters.direction);
  if (filters.msgType) query = query.eq('msg_type', filters.msgType);

  const from = dayBoundary(filters.from, false);
  const to = dayBoundary(filters.to, true);
  if (from) query = query.gte('send_time', from);
  if (to) query = query.lte('send_time', to);

  const { data, error, count } = await query
    .order('send_time', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw new Error(describeDatabaseError(error.message));

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const [todayResult, sensitiveResult] = await Promise.all([
    client
      .from(tableName('chat_message'))
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', 0)
      .gte('send_time', todayStart.toISOString()),
    client
      .from(tableName('chat_message'))
      .select('*', { count: 'exact', head: true })
      .eq('is_deleted', 0)
      .eq('is_sensitive', 1),
  ]);

  const items = await enrichUsers((data ?? []) as unknown as ChatRecordItem[]);
  return {
    items,
    total: count ?? 0,
    page,
    pageSize,
    stats: {
      total: count ?? 0,
      today: todayResult.count ?? 0,
      sensitive: sensitiveResult.count ?? 0,
    },
  };
}



