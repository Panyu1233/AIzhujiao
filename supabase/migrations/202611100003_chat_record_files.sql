-- 用户聊天记录：外部 API -> 暂存文件区 -> 正式库文件区 -> 上传 chat_message
-- 可直接在 Supabase SQL Editor 执行，可重复运行

create table if not exists public.chat_record_files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  content_type text,
  size integer not null default 0,
  format text not null default 'JSON',
  content text not null,
  status text not null default 'staging' check (status in ('staging', 'formal', 'committed')),
  source_type text not null default 'external_api',
  source_url text,
  record_count integer not null default 0,
  confirmed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists chat_record_files_name_uk
  on public.chat_record_files (name);
create index if not exists chat_record_files_status_updated_idx
  on public.chat_record_files (status, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists chat_record_files_set_updated_at on public.chat_record_files;
create trigger chat_record_files_set_updated_at
before update on public.chat_record_files
for each row execute function public.set_updated_at();

alter table public.chat_record_files enable row level security;

grant usage on schema public to service_role;
grant all privileges on public.chat_record_files to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 聊天记录上传使用 wechat_msg_id 做幂等 upsert；如果 001/002 已执行，此语句会因同名索引跳过。
create unique index if not exists chat_message_wechat_msg_id_uk
  on public.chat_message (wechat_msg_id);
