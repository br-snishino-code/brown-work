-- 25_emergency_contact_fields.sql
--
-- 緊急連絡先に「続柄」と「住所」を追加する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists emergency_contact_relation text,
  add column if not exists emergency_contact_address text;
