-- 用户信息双数据源与手机号校准
-- 可在 Supabase SQL Editor 重复执行；即使尚未执行 202611100004，也会先补建 user_kb_files。
-- 依赖：public.user_info / public.user_info_mini / public.user_info_agent 已存在。

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

alter table public.user_kb_files
  add column if not exists data_source text not null default 'gulesi_mini_program';

create unique index if not exists user_kb_files_name_uk
  on public.user_kb_files (name);
create index if not exists user_kb_files_name_idx
  on public.user_kb_files (name);
create index if not exists user_kb_files_status_updated_idx
  on public.user_kb_files (status, updated_at desc);
create index if not exists user_kb_files_data_source_idx
  on public.user_kb_files (data_source, status, updated_at desc);

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

alter table public.user_info
  add column if not exists calibration_status varchar(20) not null default 'pending';
alter table public.user_info
  add column if not exists calibration_at timestamptz;
alter table public.user_info
  add column if not exists calibration_message text;

create index if not exists user_info_calibration_status_idx
  on public.user_info (calibration_status, calibration_at desc);

alter table public.user_info_mini
  add column if not exists calibration_status varchar(20);
alter table public.user_info_mini
  add column if not exists calibration_at timestamptz;

alter table public.user_info_agent
  add column if not exists calibration_status varchar(20);
alter table public.user_info_agent
  add column if not exists calibration_at timestamptz;

grant usage on schema public to service_role;
grant all privileges on public.user_kb_files, public.user_info, public.user_info_mini, public.user_info_agent
  to service_role;
grant all privileges on all sequences in schema public to service_role;