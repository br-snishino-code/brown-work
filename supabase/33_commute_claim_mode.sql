-- 33_commute_claim_mode.sql
--
-- スタッフごとに、交通費精算の申請方法を設定できるようにする。
--   bundled  … 勤怠の確定申請とまとめて申請する（初期値）
--   separate … 交通費は個別に申請する（車通勤の方など）
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists commute_claim_mode text not null default 'bundled';

notify pgrst, 'reload schema';
