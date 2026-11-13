/**
 * 兼容旧导入路径：底层知识库持久化默认使用火山引擎实例。
 * 多实例客户端统一定义在 src/lib/supabase-clients.ts。
 */
import { SupabaseClient } from '@supabase/supabase-js';
import {
  getAlzhujiaoSupabaseClient,
  getSupabaseClientFor,
  getVolcesSupabaseClient,
  isSupabaseInstanceConfigured,
} from '@/lib/supabase-clients';

export function getSupabaseClient(authToken?: string): SupabaseClient {
  return getVolcesSupabaseClient(authToken);
}

export {
  getAlzhujiaoSupabaseClient,
  getSupabaseClientFor,
  getVolcesSupabaseClient,
  isSupabaseInstanceConfigured,
};