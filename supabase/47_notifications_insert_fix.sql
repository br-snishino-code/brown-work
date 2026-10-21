-- 47_notifications_insert_fix.sql
--
-- 【セキュリティ修正】お知らせの偽装を防ぐ
--
-- 経緯：
--   notifications の insert ポリシーが with check (true) で、
--   ログインしていれば誰でも「どのスタッフ宛にでも」
--   「どんな件名・本文でも」お知らせを作れる状態だった。
--   例：一般スタッフが他のスタッフ宛に
--       「【Brown Work】パスワード再設定のお願い」のような
--       偽のお知らせを出すことができた（アプリ内での なりすまし）。
--
-- この修正：
--   管理者・マスター管理者 … これまでどおり誰宛にでも作れる
--   それ以外のスタッフ     … 管理者宛（to_role が admin / master_admin で
--                            個人宛の指定が無いもの）だけ作れる
--
-- アプリへの影響：なし
--   スタッフ側から作られるお知らせは、申請を出したときの
--   「管理者へのお知らせ」だけ（notifyAdmins）で、これは管理者宛。
--   個人宛のお知らせは、承認・公開・シフト公開など
--   すべて管理者の操作から作られるため、これまでどおり動く。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

drop policy if exists "notifications insert any authenticated" on public.notifications;
drop policy if exists "notifications insert" on public.notifications;

create policy "notifications insert" on public.notifications
  for insert to authenticated
  with check (
    public.is_admin()
    or (to_employee_id is null and to_role in ('admin', 'master_admin'))
  );

notify pgrst, 'reload schema';

-- ============================================================
-- 確認
-- ============================================================
select
  policyname as ポリシー名,
  cmd        as 操作,
  with_check as 書き込み条件
from pg_policies
where schemaname = 'public' and tablename = 'notifications'
order by cmd, policyname;
