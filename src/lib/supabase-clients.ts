import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadEnvLocal } from './config';

/**
 * Supabase 多实例客户端。
 *
 * - volces：底层知识库文件持久化
 * - alzhujiao：用户信息、手机号校准、聊天记录等业务数据
 */
export type SupabaseInstance = 'volces' | 'alzhujiao';

const INSTANCE_LABELS: Record<SupabaseInstance, string> = {
  volces: '火山引擎 Supabase',
  alzhujiao: 'Alzhujiao Supabase',
};

function firstConfigured(...names: string[]): string {
  for (const name of names) {
    const value = loadEnvLocal(name).trim();
    if (value) return value;
  }
  return '';
}

function getCredentials(instance: SupabaseInstance): { url: string; key: string; publishableKey: string } {
  if (instance === 'volces') {
    return {
      url: firstConfigured('VOLCES_SUPABASE_URL', 'SUPABASE_URL', 'SHARE_SUPABASE_URL'),
      key: firstConfigured(
        'VOLCES_SUPABASE_KEY',
        'VOLCES_SUPABASE_SECRET_KEY',
        'SUPABASE_SECRET_KEY',
        'SUPABASE_SERVICE_ROLE_KEY',
        'SHARE_SUPABASE_SECRET_KEY',
        'SHARE_SUPABASE_SERVICE_ROLE_KEY',
        'VOLCES_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_ANON_KEY',
        'SHARE_SUPABASE_KEY',
        'SHARE_SUPABASE_PUBLISHABLE_KEY',
      ),
      publishableKey: firstConfigured(
        'VOLCES_SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_PUBLISHABLE_KEY',
        'SUPABASE_ANON_KEY',
        'SHARE_SUPABASE_KEY',
        'SHARE_SUPABASE_PUBLISHABLE_KEY',
      ),
    };
  }

  return {
    url: firstConfigured('ALZHUJIAO_SUPABASE_URL'),
    key: firstConfigured(
      'ALZHUJIAO_SUPABASE_KEY',
      'ALZHUJIAO_SUPABASE_SECRET_KEY',
      'ALZHUJIAO_SUPABASE_PUBLISHABLE_KEY',
      'ALZHUJIAO_SUPABASE_ANON_KEY',
    ),
    publishableKey: firstConfigured(
      'ALZHUJIAO_SUPABASE_PUBLISHABLE_KEY',
      'ALZHUJIAO_SUPABASE_ANON_KEY',
    ),
  };
}

export function isSupabaseInstanceConfigured(instance: SupabaseInstance): boolean {
  const { url, key } = getCredentials(instance);
  return Boolean(url && key);
}

export function getSupabaseClientFor(instance: SupabaseInstance, authToken?: string): SupabaseClient {
  const { url, key, publishableKey } = getCredentials(instance);
  const label = INSTANCE_LABELS[instance];
  if (!url) throw new Error(`${label} 未配置：请设置 ${instance.toUpperCase()}_SUPABASE_URL`);
  if (!key) throw new Error(`${label} 未配置：请设置 ${instance.toUpperCase()}_SUPABASE_KEY`);

  return createClient(url, authToken ? (publishableKey || key) : key, {
    global: {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      fetch: async (input, init) => {
        try {
          return await fetch(input, {
            ...init,
            signal: init?.signal ?? AbortSignal.timeout(60_000),
          });
        } catch (error) {
          const cause = error instanceof Error ? error.cause : undefined;
          const causeCode =
            typeof cause === 'object' && cause !== null && 'code' in cause
              ? String(cause.code)
              : '';
          const suffix = causeCode ? `（底层错误：${causeCode}）` : '';
          throw new Error(
            `${label} 网络连接失败：当前服务器无法访问配置的 URL${suffix}。请检查域名可达性、代理或部署区域。`,
          );
        }
      },
    },
    db: { timeout: 60_000 },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function getVolcesSupabaseClient(authToken?: string): SupabaseClient {
  return getSupabaseClientFor('volces', authToken);
}

export function getAlzhujiaoSupabaseClient(authToken?: string): SupabaseClient {
  return getSupabaseClientFor('alzhujiao', authToken);
}