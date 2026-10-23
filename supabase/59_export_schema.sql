-- 59_export_schema.sql
--
-- 本番のテーブル定義を書き出すためのSQL（読み取るだけ。何も変更しません）
--
-- 背景：
--   給与まわりのテーブルは Supabase の SQL Editor で直接作られており、
--   CREATE TABLE 文がリポジトリに残っていません。
--   定義がファイルに残っていないと、本番が壊れたときに作り直せず、
--   列の型や制約もコードから確認できません。
--
--   このSQLで現在の定義を書き出し、その結果をもとに
--   60番以降のSQLファイル（スキーマ定義）を作ります。
--
-- 使い方：
--   ① 下の【1】を実行し、結果をすべてコピーして送ってください
--   ② 続けて【2】【3】【4】も同じように実行して送ってください
--   どれも読み取るだけなので、何度実行しても問題ありません。
--
--   結果が長い場合は、SQL Editor の結果表の右上から CSV で
--   書き出していただくほうが確実です。


-- ============================================================
-- 【1】列の定義（型・NULL許可・既定値）
-- ============================================================
-- リポジトリに定義が無いテーブルだけに絞っています。
-- 対象を増やしたいときは、下のリストに名前を足してください。
select
  c.table_name   as テーブル,
  c.ordinal_position as 順番,
  c.column_name  as 列,
  c.data_type    as 型,
  coalesce(c.character_maximum_length::text, c.numeric_precision::text, '') as 長さ,
  c.is_nullable  as NULL許可,
  coalesce(c.column_default, '') as 既定値
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in (
    -- 本番の36テーブルのうち、リポジトリに CREATE TABLE が無い17個
    'announcements',
    'audit_logs',
    'commute_expense_claims',
    'employee_attendance_schedules',
    'employee_commute_routes',
    'employee_salary_items',
    'employee_schedule_patterns',
    'employee_standard_remuneration',
    'group_attendance_schedules',
    'group_incentive_flags',
    'insurance_rate_settings',
    'payroll_records',
    'profile_update_requests',
    'resignation_reasons',
    'staff_existing_performance',
    'staff_new_performance',
    'year_end_adjustments'
  )
order by c.table_name, c.ordinal_position;


-- ============================================================
-- 【2】主キー・一意制約・外部キー・チェック制約
-- ============================================================
select
  tc.table_name  as テーブル,
  tc.constraint_type as 種別,
  tc.constraint_name as 制約名,
  coalesce(string_agg(kcu.column_name, ', ' order by kcu.ordinal_position), '') as 対象列,
  coalesce(ccu.table_name, '')  as 参照先テーブル,
  coalesce(ccu.column_name, '') as 参照先列
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
       on kcu.constraint_name = tc.constraint_name
      and kcu.table_schema = tc.table_schema
left join information_schema.constraint_column_usage ccu
       on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
      and tc.constraint_type = 'FOREIGN KEY'
where tc.table_schema = 'public'
  and tc.table_name in (
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  )
group by tc.table_name, tc.constraint_type, tc.constraint_name, ccu.table_name, ccu.column_name
order by tc.table_name, tc.constraint_type, tc.constraint_name;


-- ============================================================
-- 【3】アクセス制限（RLSポリシー）の中身
-- ============================================================
select
  tablename   as テーブル,
  policyname  as ポリシー,
  permissive  as 種別,
  roles::text as 対象ロール,
  cmd         as 操作,
  coalesce(qual, '')       as 読める条件,
  coalesce(with_check, '') as 書ける条件
from pg_policies
where schemaname = 'public'
order by tablename, policyname;


-- ============================================================
-- 【4】索引（インデックス）と、RLSが有効かどうか
-- ============================================================
select '索引' as 区分, tablename as テーブル, indexname as 名前, indexdef as 内容
from pg_indexes
where schemaname = 'public'
union all
select 'RLS', c.relname, '', case when c.relrowsecurity then '有効' else '❌ 無効' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1, 2, 3;
