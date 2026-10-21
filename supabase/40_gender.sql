-- 40_gender.sql
--
-- 性別（gender）をスタッフ情報に追加する。
-- 選択肢は「男性」「女性」「回答しない」。未設定は空のまま。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.employees
  add column if not exists gender text;

notify pgrst, 'reload schema';
