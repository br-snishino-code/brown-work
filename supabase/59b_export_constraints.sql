-- 59b_export_constraints.sql — 外部キー・チェック制約など
--
-- 本番のテーブル定義を書き出すSQL（2／3）。読み取るだけで、何も変更しません。
--
-- ※ Supabase の SQL Editor は、複数の文をまとめて実行すると
--    最後の結果しか表示しません。そのため1ファイルに1つだけ入れています。
--    このファイルの中身をそのまま貼り付けて Run し、
--    結果表の右上から CSV で書き出してお送りください。

select
  tc.table_name      as テーブル,
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
group by tc.table_name, tc.constraint_type, tc.constraint_name, ccu.table_name, ccu.column_name
order by tc.table_name, tc.constraint_type, tc.constraint_name;
