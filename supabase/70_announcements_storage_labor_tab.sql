-- 70_announcements_storage_labor_tab.sql
--
-- 【権限の修正】お知らせの添付ファイルにも「労務タブの許可」を効かせる
--
-- 経緯：
--   69番で announcements（表）の配信・削除に労務タブの許可を効かせたが、
--   添付ファイルの置き場所である Storage の announcements バケットは
--   対象外だった。
--   storage.objects のポリシーを確認したところ、こうなっていた：
--
--     announcement files admin insert  INSERT  with check (bucket_id='announcements' and is_admin())
--     announcement files admin delete  DELETE  using      (bucket_id='announcements' and is_admin())
--     announcement files read authenticated  SELECT  using (bucket_id='announcements')
--
--   insert と delete が is_admin()（役割だけ）を見ており、
--   admin_permissions を見ていない。表と同じ抜けが残っていた。
--   69番を当てたあとは、労務タブの無い管理者はお知らせの「行」を作れないが、
--   ファイルだけはバケットに置ける（＆既存の添付を消せる）状態だった。
--
-- この修正：
--   insert と delete のポリシーに public.has_admin_tab('labor') を足す。
--   条件を1つ増やすだけで、ポリシーの形と対象バケットは変えていない。
--
-- 閲覧（select）は変更しない：
--   お知らせの添付は全スタッフが開く前提のため、
--   "announcement files read authenticated" はそのまま残す。
--   画面側は10分間有効の署名付きURL（createSignedUrl）で渡している。
--
-- 他のバケットへの影響：
--   いずれのポリシーも bucket_id = 'announcements' に限っており、
--   他のバケットの条件には触れていない。
--
-- 前提：
--   54_admin_tab_permission.sql（public.has_admin_tab()）が適用済みであること
--   69_announcements_labor_tab.sql が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
--   ※ storage.objects の持ち主は supabase_storage_admin のため、
--     権限の不足で止まることがある。その場合はこのSQLを当てずに
--     ダッシュボードの Storage → Policies から
--     該当の2つのポリシーの条件に and public.has_admin_tab('labor') を
--     足してください。途中で止まっても、下の begin / commit により
--     ポリシーが消えたままになることはありません。


begin;

-- ------------------------------------------------------------
-- 前提の確認（足りなければここで止まり、すべて巻き戻る）
-- ------------------------------------------------------------
do $do$
begin
  if to_regprocedure('public.has_admin_tab(text)') is null then
    raise exception 'public.has_admin_tab(text) がありません。先に 54_admin_tab_permission.sql を適用してください';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'announcement files admin insert'
  ) then
    raise exception '"announcement files admin insert" がありません。ポリシー名が変わっていないか確認してください';
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'announcement files admin delete'
  ) then
    raise exception '"announcement files admin delete" がありません。ポリシー名が変わっていないか確認してください';
  end if;
end $do$;


-- ------------------------------------------------------------
-- 置き換え（条件に and public.has_admin_tab('labor') を足す）
-- ------------------------------------------------------------
drop policy if exists "announcement files admin insert" on storage.objects;
create policy "announcement files admin insert" on storage.objects
  as permissive
  for insert
  to authenticated
  with check (
    bucket_id = 'announcements'::text
    and public.is_admin()
    and public.has_admin_tab('labor')
  );

drop policy if exists "announcement files admin delete" on storage.objects;
create policy "announcement files admin delete" on storage.objects
  as permissive
  for delete
  to authenticated
  using (
    bucket_id = 'announcements'::text
    and public.is_admin()
    and public.has_admin_tab('labor')
  );

commit;


-- ------------------------------------------------------------
-- 確認：insert と delete の条件に has_admin_tab が入っていれば成功。
--       select は条件が変わっていないこと。
-- ------------------------------------------------------------
select
  policyname as "ポリシー名",
  cmd        as "対象の操作",
  coalesce(qual, with_check) as "条件",
  case when coalesce(qual, with_check) like '%has_admin_tab%'
       then '労務タブの許可あり' else '（タブ判定なし）' end as "判定"
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'announcement files%'
order by cmd;
