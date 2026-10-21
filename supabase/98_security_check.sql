-- 98_security_check.sql
--
-- セキュリティ監査の「現状確認」用。読み取りだけで、データは一切変更しません。
-- 何度実行しても安全です。
--
-- 実行方法：Supabase → SQL Editor → New query に貼り付けて Run
--           結果が4つの表に分かれて出ます。すべてコピーしてお知らせください。
--
-- ① どのテーブルで RLS（行単位の鍵）が有効になっているか
-- ② 各テーブルにどんなポリシーが付いているか
-- ③ is_admin() が master_admin を管理者として扱っているか
-- ④ 旧 app_state テーブルが残っているか

-- ============================================================
-- ① RLS の有効・無効の一覧（❌ の行は誰でも読み書きできる可能性があります）
-- ============================================================
select
  c.relname                                        as テーブル名,
  case when c.relrowsecurity then '✅ 有効' else '❌ 無効' end as RLS,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname) as ポリシー数
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- ============================================================
-- ② ポリシーの中身（誰がどの操作をできるか）
-- ============================================================
select
  tablename  as テーブル名,
  policyname as ポリシー名,
  cmd        as 操作,
  roles      as 対象ロール,
  qual       as 読み取り条件,
  with_check as 書き込み条件
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- ============================================================
-- ③ is_admin() の定義（master_admin が含まれているか）
-- ============================================================
select
  p.proname as 関数名,
  pg_get_functiondef(p.oid) as 定義
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('is_admin', 'is_master_admin', 'guard_employee_self_update');

-- ============================================================
-- ④ 旧 app_state テーブルの有無と、employees の role の種類
-- ============================================================
select '旧 app_state テーブル' as 確認項目,
       case when to_regclass('public.app_state') is null
            then '✅ 削除済み' else '⚠️ 残っています' end as 状態
union all
select 'employees の role の値',
       coalesce(string_agg(distinct role, ' / '), '（0件）')
from public.employees
union all
select 'employees の role の CHECK 制約',
       coalesce(
         (select pg_get_constraintdef(con.oid)
          from pg_constraint con
          join pg_class cl on cl.oid = con.conrelid
          where cl.relname = 'employees' and con.contype = 'c'
            and pg_get_constraintdef(con.oid) like '%role%'
          limit 1),
         '（なし）');
