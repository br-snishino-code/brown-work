-- 27_app_settings.sql
--
-- アプリ全体の設定を保存する表。
-- いまのところ「管理者宛の通知メールの送信先」に使用する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- ログインしていれば読める（通知の送信先を参照するため）
drop policy if exists "app settings select" on public.app_settings;
create policy "app settings select"
  on public.app_settings for select to authenticated using (true);

-- 変更できるのはマスター管理者のみ
drop policy if exists "app settings insert" on public.app_settings;
create policy "app settings insert"
  on public.app_settings for insert to authenticated
  with check (exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'master_admin'
  ));

drop policy if exists "app settings update" on public.app_settings;
create policy "app settings update"
  on public.app_settings for update to authenticated
  using (exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'master_admin'
  ))
  with check (exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'master_admin'
  ));
