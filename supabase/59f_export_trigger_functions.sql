-- 59f_export_trigger_functions.sql
--
-- トリガーが呼んでいる関数の中身を書き出すSQL。
-- 読み取るだけで、何も変更しません。
--
-- 59e で分かったこと：
--   17テーブルにトリガーが6本、索引が1本ありました。
--   うち4本（交通費・年末調整・実績2表）は既存のSQLファイルと定義が一致。
--   残り2本はリポジトリに定義がありません。
--     ・profile_update_requests の guard_profile_update_requests
--       → 呼んでいる関数 guard_decision_fields() は 01_schema.sql にあるので、
--         トリガー文を足すだけで足ります。
--     ・employee_attendance_schedules の set_updated_at
--       → 呼んでいる関数 set_employee_attendance_schedules_updated_at() が
--         リポジトリに無く、中身が分かりません。
--
-- このファイルで関数の中身を取り出します。
-- あわせて、既存ファイルにある4つの関数が本番と食い違っていないか（差分が
-- 生まれていないか）も確認します。食い違いはそれ自体が不具合になり得るためです。
--
-- ※ Supabase の SQL Editor は複数の文をまとめて実行すると最後の結果しか
--    表示しないため、このファイルにはクエリを1つだけ入れています。
--    中身をそのまま貼り付けて Run し、結果を CSV で書き出してお送りください。
--
-- ※ 中身にスタッフの個人情報は含まれません（プログラムの文面だけです）。

select p.proname::text as 関数名,
       pg_get_functiondef(p.oid) as 中身
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'set_employee_attendance_schedules_updated_at',  -- リポジトリに無い
    'guard_decision_fields',                         -- 01_schema.sql
    'guard_commute_claim_decision',                  -- 51_self_approval_guard.sql
    'guard_year_end_decision',                       -- 52_year_end_and_shift_guard.sql
    'guard_performance_self_update'                  -- 55 / 56 / 58
  )
order by p.proname;
