-- 38_performance_submitted.sql
--
-- 実績入力に「提出」を追加する。
--   一時保存 … これまでどおり内容だけを保存する（submitted_at は変えない）
--   提出     … submitted_at に日時を入れ、管理者へお知らせを送る
-- 提出後も本人が直して出し直せる（承認の手続きは無し）。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

alter table public.staff_new_performance
  add column if not exists submitted_at timestamptz;

notify pgrst, 'reload schema';
