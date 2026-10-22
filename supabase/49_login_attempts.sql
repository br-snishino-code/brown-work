-- 49_login_attempts.sql
--
-- 【セキュリティ強化・第3段階】ログインの失敗を記録する
--
-- 背景：
--   これまで、ログインに失敗しても何も残らなかった。
--   そのため「誰かのIDを狙って何度も試されている」状態に気づけなかった。
--   （Supabase 側にも回数制限はあるが、管理画面から見える記録が無い）
--
-- このSQLでやること：
--   失敗を1行ずつ残す表を作る。記録は Edge Function（service_role）だけが書き、
--   管理者だけが読める。パスワードは一切記録しない。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

create table if not exists public.login_attempts (
  id          uuid primary key default gen_random_uuid(),
  username    text,
  client_ip   text,
  user_agent  text,
  reason      text,
  occurred_at timestamptz not null default now()
);

create index if not exists login_attempts_time_idx
  on public.login_attempts (occurred_at desc);

create index if not exists login_attempts_ip_time_idx
  on public.login_attempts (client_ip, occurred_at desc);

create index if not exists login_attempts_username_time_idx
  on public.login_attempts (username, occurred_at desc);

alter table public.login_attempts enable row level security;

-- 閲覧は管理者のみ。書き込みは service_role だけ（＝ポリシーを作らない）
drop policy if exists "login attempts select admin" on public.login_attempts;
create policy "login attempts select admin" on public.login_attempts
  for select to authenticated
  using (public.is_admin());

-- 古い記録を消す関数（90日より前）。必要になったら手動で呼ぶ。
create or replace function public.purge_login_attempts()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.login_attempts
     where occurred_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int from deleted;
$$;

notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select
  'login_attempts' as テーブル,
  case when to_regclass('public.login_attempts') is not null
       then '✅ 作成しました' else '⚠️ 作成されていません' end as 状態
union all
select '閲覧ポリシー',
  coalesce((select count(*)::text || '件' from pg_policies
             where schemaname = 'public' and tablename = 'login_attempts'), '0件');
