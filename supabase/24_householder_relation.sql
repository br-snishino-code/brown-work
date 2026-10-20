-- 24_householder_relation.sql
--
-- スタッフ情報に「世帯主との続柄」を追加する。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists householder_relation text;
