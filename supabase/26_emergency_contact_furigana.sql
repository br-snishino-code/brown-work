-- 26_emergency_contact_furigana.sql
--
-- 緊急連絡先に「ふりがな」を追加する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists emergency_contact_furigana text;
