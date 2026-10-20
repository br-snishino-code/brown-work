-- 35_shift_request_targets.sql
--
-- シフト希望の受付に「対象者」を追加する。
--   未設定（null）または空のとき … 在籍スタッフ全員が対象
--   スタッフIDの配列が入っているとき … そのスタッフにだけ表示される
-- 試験運用のあいだ、特定の人だけに出しておきたい場合に使う。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.shift_request_periods
  add column if not exists target_employee_ids jsonb;

notify pgrst, 'reload schema';
