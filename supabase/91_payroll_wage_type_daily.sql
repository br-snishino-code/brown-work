-- 91_payroll_wage_type_daily.sql
--
-- 給与明細の給与形態に「日給」を入れられるようにします。
--
-- 【なぜ要るか】
--   payroll_records.wage_type には、作ったときから
--     check (wage_type in ('hourly', 'monthly'))
--   という制限が付いています（60番）。
--   2026年10月28日に給与形態へ日給制を足しましたが（cebebb5）、
--   このSQLを作っていませんでした。
--   そのため、日給制のスタッフの給与明細を保存しようとすると、
--   'daily' が制限に引っかかって保存できません。
--
-- 【このSQLでやること】
--   制限を 'hourly' / 'daily' / 'monthly' の3つに広げます。
--   すでに入っている明細には触れません。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- ⚠ 先に流しても古いアプリは壊れません（制限が広がるだけです）。

begin;

alter table public.payroll_records
  drop constraint if exists payroll_records_wage_type_check;

alter table public.payroll_records
  add constraint payroll_records_wage_type_check
  check (wage_type in ('hourly', 'daily', 'monthly'));

comment on column public.payroll_records.wage_type is
  '給与形態。hourly（時給）／daily（日給）／monthly（月給）。スタッフ詳細の設定を明細に写したもの';

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 確認
-- ============================================================
-- ① 制限が3つに広がったか
--   select pg_get_constraintdef(oid) as 制限
--     from pg_constraint
--    where conname = 'payroll_records_wage_type_check';
--   → check ((wage_type = ANY (ARRAY['hourly'::text, 'daily'::text, 'monthly'::text])))
--     のように3つ並んでいれば広がっています。
--
-- ② 今回いっしょに直した件の確認（アプリ側だけで直しています）
--    payroll_records に daily_wage / daily_wage_holiday の列は
--    もともとありません（employees の列と取り違えていました）。
--    次の問い合わせが 0行 なら、これまでどおりで正しい状態です。
--
--   select column_name as 列
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'payroll_records'
--      and column_name in ('daily_wage', 'daily_wage_holiday');
