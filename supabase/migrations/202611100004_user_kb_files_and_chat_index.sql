-- 用户信息管理暂存/正式库文件表
-- 适用于仅执行过四表迁移、尚未执行 202611100001_core_schema.sql 的数据库。
-- 可重复执行。

create table if not exists public.user_kb_files (
  id varchar(36) primary key default gen_random_uuid()::text,
  name text not null,
  content_type text,
  size integer not null default 0,
  format text,
  status text not null default 'staging',
  content text not null,
  parsed_text text,
  parsed_result text,
  parsed_at timestamptz,
  committed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_kb_files_name_uk
  on public.user_kb_files (name);
create index if not exists user_kb_files_name_idx
  on public.user_kb_files (name);
create index if not exists user_kb_files_status_updated_idx
  on public.user_kb_files (status, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_kb_files_set_updated_at on public.user_kb_files;
create trigger user_kb_files_set_updated_at
before update on public.user_kb_files
for each row execute function public.set_updated_at();

alter table public.user_kb_files enable row level security;

grant usage on schema public to service_role;
grant all privileges on public.user_kb_files to service_role;
grant all privileges on all sequences in schema public to service_role;

-- 聊天记录幂等上传依赖的唯一索引；如果 001/002 已执行则会因同名索引而跳过。
create unique index if not exists chat_message_wechat_msg_id_uk
  on public.chat_message (wechat_msg_id);
