-- 92_publish_schedule_skipped.sql
--
-- 予約公開で「公開しなかった人」の件数と名前を残せるようにします。
--
-- 【なぜ要るか】
--   予約公開（publish_schedules）は、これまでその月の下書きを
--   すべて公開していました。勤怠の最終承認が済んでいるかを見ていないため、
--   未確定のまま公開されてしまう恐れがありました。
--   （手で公開するときは、最終承認が済むまで公開できません）
--
--   最終承認が済んでいない方は公開せずに残すよう直しました。
--   そのとき「誰を残したか」を画面に出すために、2つの列を足します。
--
-- 【このSQLでやること】
--   publish_schedules に次の2列を足します。
--     skipped_count … 公開しなかった件数
--     skipped_note  … 公開しなかった方の名前（長いときは先頭だけ）
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- ⚠ このSQLを流さなくても予約公開は動きます。
--   Edge Function は、列が無いときは件数の記録だけを省きます。
--   ただし画面に「誰を残したか」が出ないので、流すことをおすすめします。

begin;

alter table public.publish_schedules
  add column if not exists skipped_count integer not null default 0;

alter table public.publish_schedules
  add column if not exists skipped_note text;

comment on column public.publish_schedules.skipped_count is
  '予約公開で公開しなかった件数（勤怠の最終承認が済んでいないなど）';
comment on column public.publish_schedules.skipped_note is
  '公開しなかった方の名前。画面に出して、手で対応してもらうためのもの';

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 確認
-- ============================================================
-- ① 列が足されたか（2行返れば足されています）
--   select column_name as 列, data_type as 型
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'publish_schedules'
--      and column_name in ('skipped_count', 'skipped_note');
--
-- ② いまの予約の様子
--   select kind as 種類, year as 年, period as 月または回,
--          status as 状態, publish_at as 公開日時,
--          published_count as 公開, skipped_count as 残した,
--          skipped_note as 残した方
--     from public.publish_schedules
--    order by publish_at desc
--    limit 20;
