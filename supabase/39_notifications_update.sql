-- 39_notifications_update.sql
--
-- お知らせの既読がつかない不具合の修正。
--
-- 経緯：notifications には select と insert のポリシーしかなく、
-- update のポリシーが無かった。RLS では許可されていない更新は
-- エラーにならず「0件更新」で静かに終わるため、
-- 「既読にする」を押しても何も起きていなかった。
--
-- 本人（宛先のスタッフ）と管理者が、既読の状態を更新できるようにする。
--
-- 実行方法：Supabase の SQL Editor に貼り付けて Run

drop policy if exists "notifications update own or admin" on public.notifications;
create policy "notifications update own or admin" on public.notifications
  for update to authenticated
  using (to_employee_id = auth.uid() or public.is_admin())
  with check (to_employee_id = auth.uid() or public.is_admin());

notify pgrst, 'reload schema';
