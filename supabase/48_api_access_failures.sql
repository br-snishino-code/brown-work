-- 48_api_access_failures.sql
--
-- 【セキュリティ強化】シフト連携の合言葉（x-api-key）の失敗を記録して、
-- 連続して間違えた相手を一時的に遮断できるようにする。
--
-- 経緯：
--   シフト連携の2つの Edge Function は、ログインの代わりに
--   合言葉（x-api-key）で守っている。スプレッドシートから
--   ログインせずに呼ぶ必要があるため、この方式自体は妥当。
--   ただし、これまでは
--     ・間違えた回数が記録されない（総当たりに気づけない）
--     ・何回間違えても遮断されない
--   という状態だった。
--
-- このSQLでやること：
--   失敗を1行ずつ残す表を作る。
--   Edge Function 側は、同じ相手からの直近15分の失敗が20回を超えたら
--   合言葉の照合すらせずに 429 を返す。
--
-- 記録は管理者だけが見られる。書き込みは Edge Function（service_role）のみ。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

create table if not exists public.api_access_failures (
  id            uuid primary key default gen_random_uuid(),
  function_name text not null,
  client_ip     text,
  reason        text,
  occurred_at   timestamptz not null default now()
);

create index if not exists api_access_failures_ip_time_idx
  on public.api_access_failures (client_ip, occurred_at desc);

create index if not exists api_access_failures_time_idx
  on public.api_access_failures (occurred_at desc);

alter table public.api_access_failures enable row level security;

-- 閲覧は管理者のみ（書き込みは service_role だけ＝ポリシーを作らない）
drop policy if exists "api failures select admin" on public.api_access_failures;
create policy "api failures select admin" on public.api_access_failures
  for select to authenticated
  using (public.is_admin());

-- 古い記録を消す関数（90日より前）。必要になったら手動で呼ぶ。
create or replace function public.purge_api_access_failures()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with deleted as (
    delete from public.api_access_failures
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
  'api_access_failures' as テーブル,
  case when to_regclass('public.api_access_failures') is not null
       then '✅ 作成しました' else '⚠️ 作成されていません' end as 状態
union all
select '閲覧ポリシー',
  coalesce((select count(*)::text || '件' from pg_policies
             where schemaname = 'public' and tablename = 'api_access_failures'), '0件');
