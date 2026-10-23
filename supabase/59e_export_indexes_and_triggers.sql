-- 59e_export_indexes_and_triggers.sql
--
-- 17テーブルの「索引」と「トリガー」を書き出すSQL。
-- 読み取るだけで、何も変更しません。
--
-- 60番（表の形）と 61番（アクセス制限）で、列・制約・RLSは本番と一致しました。
-- 残っているのは次の2つで、まだ照合していません。
--   ・性能用の索引（主キー・一意制約を除いたもの）
--     … 無くてもデータは正しく入りますが、画面が遅くなります。
--   ・トリガー（保存時の自動チェックや更新日時の自動セット）
--     … 無いと、本人が触れない列を守る仕組みなどが効かなくなります。
--
-- ※ Supabase の SQL Editor は複数の文をまとめて実行すると最後の結果しか
--    表示しないため、このファイルにはクエリを1つだけ入れています。
--    中身をそのまま貼り付けて Run し、結果を CSV で書き出してお送りください。

with 対象 as (
  select unnest(array[
    'announcements', 'audit_logs', 'commute_expense_claims', 'employee_attendance_schedules',
    'employee_commute_routes', 'employee_salary_items', 'employee_schedule_patterns',
    'employee_standard_remuneration', 'group_attendance_schedules', 'group_incentive_flags',
    'insurance_rate_settings', 'payroll_records', 'profile_update_requests', 'resignation_reasons',
    'staff_existing_performance', 'staff_new_performance', 'year_end_adjustments'
  ]) as t
)
select '索引' as 区分,
       cls.relname::text as テーブル,
       idx.relname::text as 名前,
       pg_get_indexdef(idx.oid) as 内容
from pg_index i
join pg_class idx on idx.oid = i.indexrelid
join pg_class cls on cls.oid = i.indrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname in (select t from 対象)
  -- 主キー・一意制約の索引は 60番に反映済みなので除く
  and not exists (
    select 1 from pg_constraint c
    where c.conindid = i.indexrelid and c.contype in ('p', 'u')
  )

union all

select 'トリガー',
       cls.relname::text,
       tg.tgname::text,
       pg_get_triggerdef(tg.oid)
from pg_trigger tg
join pg_class cls on cls.oid = tg.tgrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname in (select t from 対象)
  and not tg.tgisinternal   -- 外部キーの内部トリガーは除く

order by 1, 2, 3;
