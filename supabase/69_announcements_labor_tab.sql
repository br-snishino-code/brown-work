-- 69_announcements_labor_tab.sql
--
-- 【権限の修正】お知らせの配信・削除に「労務タブの許可」を効かせる
--
-- 経緯：
--   マニュアルには「許可されていないタブは表示されず、データも取得できません」
--   と書いているが、お知らせ（announcements）のポリシーは
--   is_admin()（役割だけ）を見ており、admin_permissions を見ていなかった。
--   そのため「勤怠のみ許可」にした管理者でも、ブラウザの開発者ツールから
--   API を直接呼べばお知らせを投稿・削除できる状態だった。
--   54_admin_tab_permission.sql で給与系5表には同じ修正を入れてあるが、
--   お知らせは対象外のままだった。
--
-- この修正：
--   announcements の insert / update / delete に制限ポリシーを足し、
--   労務タブを許可された管理者とマスター管理者だけが操作できるようにする。
--
-- 閲覧（select）は変更しない：
--   お知らせは全スタッフが読む前提のため、
--   "announcements select all authenticated"（using (true)）はそのまま残す。
--   この修正で、これまで読めていたものが読めなくなることはない。
--
-- 制限ポリシー（restrictive）は既存のポリシーと AND で効くため、
-- 通れる範囲が狭まるだけで、新しく何かができるようになることはない。
--
-- 前提：
--   54_admin_tab_permission.sql（public.has_admin_tab()）が適用済みであること
--   61_rls_policies_missing_tables.sql（announcements の各ポリシー）が適用済みであること
--
-- ※ 残っている確認事項（このSQLの対象外）
--   お知らせの添付ファイルは Storage の announcements バケットに入る。
--   バケットのポリシーはリポジトリに無く、Supabase の画面で設定されたものと
--   思われるため、未確認。表の行を作れなくなっても、ファイルの置き場所だけは
--   残る可能性がある。ダッシュボードの Storage → Policies で
--   announcements バケットの insert / delete を確認すること。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


-- ------------------------------------------------------------
-- 前提の確認（足りなければここで止まる）
-- ------------------------------------------------------------
do $do$
begin
  if to_regclass('public.announcements') is null then
    raise exception 'public.announcements がありません。先に 61_rls_policies_missing_tables.sql を適用してください';
  end if;
  if to_regprocedure('public.has_admin_tab(text)') is null then
    raise exception 'public.has_admin_tab(text) がありません。先に 54_admin_tab_permission.sql を適用してください';
  end if;
end $do$;


-- ------------------------------------------------------------
-- 制限ポリシーを足す
--   insert … with check のみ（insert に using は無い）
--   delete … using のみ（delete に with check は無い）
--   update … 両方
-- ------------------------------------------------------------
drop policy if exists "announcements labor tab required insert" on public.announcements;
create policy "announcements labor tab required insert" on public.announcements
  as restrictive
  for insert
  to authenticated
  with check (public.has_admin_tab('labor'));

drop policy if exists "announcements labor tab required update" on public.announcements;
create policy "announcements labor tab required update" on public.announcements
  as restrictive
  for update
  to authenticated
  using (public.has_admin_tab('labor'))
  with check (public.has_admin_tab('labor'));

drop policy if exists "announcements labor tab required delete" on public.announcements;
create policy "announcements labor tab required delete" on public.announcements
  as restrictive
  for delete
  to authenticated
  using (public.has_admin_tab('labor'));


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：3行（insert / update / delete）が RESTRICTIVE で出れば成功
-- ------------------------------------------------------------
select
  policyname as "ポリシー名",
  case permissive when 'RESTRICTIVE' then '制限' else '通常' end as "種別",
  cmd as "対象の操作"
from pg_policies
where schemaname = 'public'
  and tablename = 'announcements'
  and policyname like 'announcements labor tab required%'
order by cmd;
