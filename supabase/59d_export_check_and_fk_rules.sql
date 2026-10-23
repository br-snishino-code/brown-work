-- 59d_export_check_and_fk_rules.sql
--
-- チェック制約の条件式と、外部キーの削除時の動作を書き出すSQL。
-- 読み取るだけで、何も変更しません。
--
-- 59b では「制約があること」までしか分かりませんでした。
--   ・チェック制約が何を禁止しているのか（条件式）
--   ・親のスタッフを消したとき、子の行をどうするのか（CASCADE / RESTRICT など）
-- この2つが無いと、定義を正しく起こし直せません。
--
-- ※ Supabase の SQL Editor は複数の文をまとめて実行すると最後の結果しか
--    表示しないため、このファイルにはクエリを1つだけ入れています。
--    中身をそのまま貼り付けて Run し、結果を CSV で書き出してお送りください。

select 'チェック制約' as 区分,
       rel.relname::text as テーブル,
       con.conname::text as 制約名,
       pg_get_constraintdef(con.oid) as 内容
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.contype = 'c'
  and con.conname not like '2200\_%'   -- NOT NULL の自動生成分は除く
  and rel.relname in (
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  )

union all

select '外部キー',
       rel.relname::text,
       con.conname::text,
       pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace nsp on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and con.contype = 'f'
  and rel.relname in (
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  )

order by 1, 2, 3;
