-- 23_household_fields.sql
--
-- スタッフ情報に「世帯主の氏名」を追加する。
-- （配偶者の有無は spouse_status 列を使用するため、追加は不要）
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists householder_name text;
