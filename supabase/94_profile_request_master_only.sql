-- 94_profile_request_master_only.sql
--
-- 【権限の修正】個人情報の変更申請を、マスター管理者だけが扱えるようにする
--
-- 経緯：
--   権限の洗い出しで不具合が見つかった。
--
--   スタッフが出す「個人情報の変更申請」（profile_update_requests）は、
--   管理者（admin）も承認できる作りになっていた。ところが承認したときに
--   employees へ書き戻す処理は、個人情報の列を管理者の画面から
--   落とす作りになっている（これは正しい）。その結果：
--
--     ・スタッフが申請できる24項目のうち、管理者の承認で実際に反映されるのは
--       氏名・ふりがな・最寄り駅の3つだけ
--     ・住所・電話・メールアドレス・緊急連絡先・口座情報など残り21項目は
--       黙って捨てられる
--     ・それでも申請は「承認済み」になり、本人には
--       「承認され、反映されました」と通知される
--
--   本人は変わったと思い込み、実際は古いまま残る。振込先の口座が
--   変わらないまま給与が振り込まれる、といった事故につながる。
--
--   あわせて、この表の requested_changes と original_values には
--   住所・口座番号などがそのまま入っている。閲覧の条件が
--     employee_id = auth.uid() or is_admin()
--   のままだったため、管理者が全スタッフの住所・口座を読める状態だった。
--   御社の決まり（個人情報は本人とマスター管理者だけ。管理者には見せない）
--   と合っていない。
--
-- この修正：
--   profile_update_requests に、72番・78番と同じ restrictive ポリシーを足す。
--     ・本人は自分の分をこれまでどおり提出・閲覧できる
--     ・マスター管理者はこれまでどおり閲覧・承認できる
--     ・管理者（admin）は読めず、承認もできなくなる
--
--   restrictive ポリシーは既存のポリシーと AND で効くため、
--   いま読める範囲がさらに狭まるだけ。新しく何かが読めるようにはならない。
--
-- 影響：
--   ・管理者の「人材」タブから個人情報の変更申請が消える。
--     アプリ側でも、年末調整と同じ案内を出すようにしてある。
--   ・スタッフ本人の提出・取り消し・状況の確認は変わらない。
--   ・マスター管理者は変わらない。
--
-- 流す順番：
--   どちらが先でも画面は止まらない。
--   アプリを先に出すと、SQLを流すまでのあいだ管理者には画面が出ないだけで
--   データは従来どおり。SQLを先に流すと、アプリを出すまでのあいだ
--   管理者に空の一覧が見える。混乱が少ないのは「アプリを先、SQLを後」。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- 元に戻したいとき：
--   drop policy if exists "master admin only" on public.profile_update_requests;

begin;

do $do$
begin
  if to_regclass('public.profile_update_requests') is null then
    raise exception '個人情報の変更申請の表がありません。先に 60番までを適用してください';
  end if;

  drop policy if exists "master admin only" on public.profile_update_requests;
  create policy "master admin only"
    on public.profile_update_requests as restrictive to authenticated
    using (employee_id = auth.uid() or public.is_master_admin())
    with check (employee_id = auth.uid() or public.is_master_admin());

  raise notice '適用しました: profile_update_requests（マスター管理者限定）';
end $do$;

commit;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
-- ① 1 が返れば成功（制限ポリシーが付いた）
--   select count(*) as 制限ポリシー
--     from pg_policies
--    where schemaname = 'public'
--      and tablename = 'profile_update_requests'
--      and policyname = 'master admin only';
--
-- ② この表に付いているポリシーの一覧
--   select policyname as 名前, permissive as 種類, cmd as 対象
--     from pg_policies
--    where schemaname = 'public'
--      and tablename = 'profile_update_requests'
--    order by policyname;
--
-- ③ 未処理の申請が残っていないか（管理者が承認できなくなるため、
--    残っているときはマスター管理者が処理してください）
--   select e.name as 氏名, r.submitted_at as 提出日時
--     from public.profile_update_requests r
--     join public.employees e on e.id = r.employee_id
--    where r.status = 'pending'
--    order by r.submitted_at;
