-- 42_off_shift.sql
--
-- シフト上は休みの日に出勤したことを、打刻の記録に残せるようにする。
--   off_shift      … シフト外の出勤かどうか
--   off_shift_note … そのときにスタッフが入力した理由（応援、代打など）
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.attendance_records
  add column if not exists off_shift boolean;

alter table public.attendance_records
  add column if not exists off_shift_note text;

notify pgrst, 'reload schema';
