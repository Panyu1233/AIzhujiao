-- 修复聊天记录幂等 upsert 索引。
-- Supabase/PostgREST 按 onConflict=wechat_msg_id 推导唯一约束时，
-- 普通唯一索引比带 WHERE 的部分唯一索引更稳定。
-- 可重复执行；wechat_msg_id 为 NULL 的历史行不受唯一性限制。

drop index if exists public.chat_message_wechat_msg_id_uk;

create unique index chat_message_wechat_msg_id_uk
  on public.chat_message (wechat_msg_id);
