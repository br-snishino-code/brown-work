-- 59a_export_columns.sql — 列の定義（型・NULL許可・既定値）
--
-- 本番のテーブル定義を書き出すSQL（1／3）。読み取るだけで、何も変更しません。
--
-- ※ Supabase の SQL Editor は、複数の文をまとめて実行すると
--    最後の結果しか表示しません。そのため1ファイルに1つだけ入れています。
--    このファイルの中身をそのまま貼り付けて Run し、
--    結果表の右上から CSV で書き出してお送りください。

select
  c.table_name       as テーブル,
  c.ordinal_position as 順番,
  c.column_name      as 列,
  c.data_type        as 型,
  coalesce(c.character_maximum_length::text, c.numeric_precision::text, '') as 長さ,
  c.is_nullable      as NULL許可,
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
