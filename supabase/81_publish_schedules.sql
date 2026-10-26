-- 81_publish_schedules.sql
--
-- 給与明細・賞与明細の「予約公開」
--
-- いまは作った明細を1件ずつ手で公開しています。
-- 支給日に合わせて公開したい場合、その日に人が操作する必要がありました。
--
-- この表に「いつ公開するか」を入れておくと、Edge Function
-- （supabase/functions/publish-scheduled）が定時に見にきて公開し、
-- 本人へお知らせとメールを送ります。
--
-- 決めたこと：
--   ・予約は対象月（賞与は回）ごとに1つ。明細ごとには持ちません。
--   ・公開前は、これまでどおり本人には見えません
--     （payroll_records / bonus_records の select ポリシーが
--       status = 'published' で絞っているため、この表を足しても穴は空きません）。
--   ・予約した時刻をすぎた分だけを公開します。さかのぼって公開はしません。
--
-- ⚠ この表を入れただけでは動きません。次の2つが必要です：
--   1. Edge Function publish-scheduled をデプロイする
--   2. Supabase の Cron で、その関数を定期的に呼ぶように設定する
--   手順は Edge Function のファイル先頭に書いてあります。
--
-- 何度流しても同じ結果になります（2回目以降は何も起きません）。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。


-- ========================================================
-- 1. 予約の表
-- ========================================================
create table if not exists public.publish_schedules (
  id uuid primary key default gen_random_uuid(),

  -- payroll … 給与明細（period は月：1〜12）
  -- bonus   … 賞与明細（period は回：1〜3）
  kind text not null check (kind in ('payroll', 'bonus')),
  year integer not null check (year between 2000 and 2100),
  period integer not null check (period between 1 and 12),

  -- いつ公開するか
  publish_at timestamptz not null,

  -- scheduled … 予約中
  -- done      … 公開を実行した
  -- canceled  … 取り消した
  status text not null default 'scheduled' check (status in ('scheduled', 'done', 'canceled')),

  -- 実行の記録（あとから確認できるように残します）
  done_at timestamptz,
  published_count integer,
  notified_count integer,
  mail_sent_count integer,
  last_error text,

  created_at timestamptz not null default now(),
  created_by uuid references public.employees(id) on delete set null,

  -- 対象月（回）につき1件
  unique (kind, year, period)
);

comment on table public.publish_schedules is
  '給与明細・賞与明細の予約公開。対象月（賞与は回）ごとに1件。Edge Function publish-scheduled が実行する。';


-- ========================================================
-- 2. 権限
-- ========================================================
-- 読む・書くとも、給与タブを扱える管理者だけ。
-- スタッフには見せません（いつ公開されるかは明細そのものではありませんが、
-- 給与の運用に関わる情報のため、給与明細と同じ扱いに揃えています）。
alter table public.publish_schedules enable row level security;

drop policy if exists "publish_schedules_select" on public.publish_schedules;
create policy "publish_schedules_select"
  on public.publish_schedules for select to authenticated
  using (public.is_admin());

drop policy if exists "publish_schedules_insert" on public.publish_schedules;
create policy "publish_schedules_insert"
  on public.publish_schedules for insert to authenticated
  with check (public.is_master_admin());

drop policy if exists "publish_schedules_update" on public.publish_schedules;
create policy "publish_schedules_update"
  on public.publish_schedules for update to authenticated
  using (public.is_master_admin())
  with check (public.is_master_admin());

drop policy if exists "publish_schedules_delete" on public.publish_schedules;
create policy "publish_schedules_delete"
  on public.publish_schedules for delete to authenticated
  using (public.is_master_admin());

-- ログインしていない人には表の権限そのものを渡しません（55番と同じ扱い）
revoke all on public.publish_schedules from anon;
grant select, insert, update, delete on public.publish_schedules to authenticated;

create index if not exists publish_schedules_due_idx
  on public.publish_schedules (status, publish_at);


-- ========================================================
-- 3. 確認クエリ（まとめて1回で見られます）
-- ========================================================
select '① 表ができているか（1なら成功）' as "確認項目",
       (select count(*)::text from information_schema.tables
        where table_schema = 'public' and table_name = 'publish_schedules') as "結果"
union all
select '② ポリシーの数（4なら成功）',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'publish_schedules')
union all
select '③ いま入っている予約の数（0で正常）',
       (select count(*)::text from public.publish_schedules where status = 'scheduled');
