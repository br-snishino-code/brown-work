-- 22_address_fields.sql
--
-- スタッフ情報に「郵便番号」と「住民票の住所」を追加する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists postal_code text,
  add column if not exists resident_address text;
