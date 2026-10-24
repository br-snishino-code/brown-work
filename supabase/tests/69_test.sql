-- 69番の検証。あるべき姿を書いてある。
-- 69番を当てる前に流すと「勤怠のみの管理者」のところで落ちる（それが今の不具合）。
\set ON_ERROR_STOP on
set role tester;

-- 下ごしらえ：更新・削除に使う行を1つ入れておく
select public.be('master');
insert into public.announcements (id, title, category)
  values ('11111111-1111-1111-1111-111111111111', 'たたき台', 'お知らせ');

do $$
begin

raise notice '--- マスター管理者（すべて通るべき）---';
perform public.be('master');
perform public.must_pass('マスター：配信',
  $q$insert into public.announcements (title, category) values ('マスターの配信','お知らせ')$q$);
perform public.must_touch_some('マスター：書き換え',
  $q$update public.announcements set title='書き換え' where id='11111111-1111-1111-1111-111111111111'$q$);
perform public.must_pass('マスター：閲覧',
  $q$select count(*) from public.announcements$q$);

raise notice '--- 管理者・全タブ許可（通るべき）---';
perform public.be('admin_all');
perform public.must_pass('全タブ管理者：配信',
  $q$insert into public.announcements (title, category) values ('管理者の配信','お知らせ')$q$);
perform public.must_touch_some('全タブ管理者：書き換え',
  $q$update public.announcements set title='書き換え2' where id='11111111-1111-1111-1111-111111111111'$q$);

raise notice '--- 管理者・admin_permissions が未設定（既定で全許可。通るべき）---';
perform public.be('admin_null');
perform public.must_pass('未設定の管理者：配信',
  $q$insert into public.announcements (title, category) values ('未設定の配信','お知らせ')$q$);

raise notice '--- 管理者・勤怠タブのみ（ここが今回の修正点。拒まれるべき）---';
perform public.be('admin_att');
perform public.must_fail('勤怠のみの管理者：配信',
  $q$insert into public.announcements (title, category) values ('通ってはいけない','お知らせ')$q$);
perform public.must_touch_none('勤怠のみの管理者：書き換え',
  $q$update public.announcements set title='通ってはいけない' where id='11111111-1111-1111-1111-111111111111'$q$);
perform public.must_touch_none('勤怠のみの管理者：削除',
  $q$delete from public.announcements where id='11111111-1111-1111-1111-111111111111'$q$);
perform public.must_pass('勤怠のみの管理者：閲覧はできる（ここが狭まってはいけない）',
  $q$select count(*) from public.announcements$q$);

raise notice '--- スタッフ（読めるが書けない）---';
perform public.be('staff');
perform public.must_pass('スタッフ：閲覧',
  $q$select count(*) from public.announcements$q$);
perform public.must_fail('スタッフ：配信',
  $q$insert into public.announcements (title, category) values ('通ってはいけない','お知らせ')$q$);
perform public.must_touch_none('スタッフ：削除',
  $q$delete from public.announcements where id='11111111-1111-1111-1111-111111111111'$q$);

raise notice '--- 最後に、マスターなら削除できることを確かめる ---';
perform public.be('master');
perform public.must_touch_some('マスター：削除',
  $q$delete from public.announcements where id='11111111-1111-1111-1111-111111111111'$q$);

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
