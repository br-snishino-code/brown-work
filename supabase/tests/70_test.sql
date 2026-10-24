-- 70番の検証。あるべき姿を書いてある。
-- 70番を当てる前に流すと「勤怠のみの管理者」のところで落ちる（それが今の不具合）。
\set ON_ERROR_STOP on
set role tester;

-- 下ごしらえ：削除に使うファイルを1つ置いておく
select public.be('master');
insert into storage.objects (id, bucket_id, name)
  values ('22222222-2222-2222-2222-222222222222', 'announcements', 'したごしらえ.pdf');

do $$
begin

raise notice '--- マスター管理者（すべて通るべき）---';
perform public.be('master');
perform public.must_pass('マスター：添付を置く',
  $q$insert into storage.objects (bucket_id, name) values ('announcements','マスター.pdf')$q$);
perform public.must_pass('マスター：添付を読む',
  $q$select count(*) from storage.objects where bucket_id='announcements'$q$);

raise notice '--- 管理者・全タブ許可（通るべき）---';
perform public.be('admin_all');
perform public.must_pass('全タブ管理者：添付を置く',
  $q$insert into storage.objects (bucket_id, name) values ('announcements','全タブ.pdf')$q$);

raise notice '--- 管理者・admin_permissions が未設定（既定で全許可。通るべき）---';
perform public.be('admin_null');
perform public.must_pass('未設定の管理者：添付を置く',
  $q$insert into storage.objects (bucket_id, name) values ('announcements','未設定.pdf')$q$);

raise notice '--- 管理者・勤怠タブのみ（ここが今回の修正点。拒まれるべき）---';
perform public.be('admin_att');
perform public.must_fail('勤怠のみの管理者：添付を置く',
  $q$insert into storage.objects (bucket_id, name) values ('announcements','通ってはいけない.pdf')$q$);
perform public.must_touch_none('勤怠のみの管理者：添付を消す',
  $q$delete from storage.objects where id='22222222-2222-2222-2222-222222222222'$q$);
perform public.must_pass('勤怠のみの管理者：添付は読める（ここが狭まってはいけない）',
  $q$select count(*) from storage.objects where bucket_id='announcements'$q$);

raise notice '--- スタッフ（読めるが置けない）---';
perform public.be('staff');
perform public.must_pass('スタッフ：添付を読む',
  $q$select count(*) from storage.objects where bucket_id='announcements'$q$);
perform public.must_fail('スタッフ：添付を置く',
  $q$insert into storage.objects (bucket_id, name) values ('announcements','通ってはいけない.pdf')$q$);
perform public.must_touch_none('スタッフ：添付を消す',
  $q$delete from storage.objects where id='22222222-2222-2222-2222-222222222222'$q$);

raise notice '--- 他のバケットに影響していないこと（もともと誰も書けない）---';
perform public.be('master');
perform public.must_fail('マスターでも別バケットには置けない（従来どおり）',
  $q$insert into storage.objects (bucket_id, name) values ('somethingelse','べつ.pdf')$q$);

raise notice '--- 最後に、マスターなら消せることを確かめる ---';
perform public.be('master');
perform public.must_touch_some('マスター：添付を消す',
  $q$delete from storage.objects where id='22222222-2222-2222-2222-222222222222'$q$);

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
