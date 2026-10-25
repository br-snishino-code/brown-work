-- 73a（権限の昇格を塞ぐ）と 73b（通勤手当を隠す）の検証。
\set ON_ERROR_STOP on
set role tester;

do $$
declare
  staff uuid := '00000000-0000-0000-0000-000000000005';
  me_admin uuid := '00000000-0000-0000-0000-000000000002';  -- 管理者ぜんぶ
begin

raise notice '--- 73a：権限の昇格が塞がれていること ---';
perform public.be('admin_all');
perform public.must_fail('管理者：自分をマスター管理者に昇格',
  format($q$update public.employees set role='master_admin' where id='%s'$q$, me_admin));
perform public.must_fail('管理者：他人を管理者に昇格',
  format($q$update public.employees set role='admin' where id='%s'$q$, staff));
perform public.must_fail('管理者：タブ許可を変える（今と違う値にする）',
  format($q$update public.employees set admin_permissions='["attendance"]'::jsonb where id='%s'$q$, me_admin));

raise notice '--- 73a：権限以外は従来どおり変えられること ---';
perform public.must_pass('管理者：所属グループを変更',
  format($q$update public.employees set main_group='店舗C' where id='%s'$q$, staff));
perform public.must_pass('管理者：スタッフメモを変更',
  format($q$update public.employees set staff_note1='メモ' where id='%s'$q$, staff));

raise notice '--- 73a：スタッフも昇格できないこと ---';
perform public.be('staff');
perform public.must_fail('スタッフ：自分をマスター管理者に昇格',
  format($q$update public.employees set role='master_admin' where id='%s'$q$, staff));

raise notice '--- 73a：マスター管理者は従来どおり変えられること ---';
perform public.be('master');
perform public.must_pass('マスター：他人の権限を変更',
  format($q$update public.employees set role='admin' where id='%s'$q$, staff));
perform public.must_pass('マスター：タブ許可を変更',
  format($q$update public.employees set admin_permissions='["attendance"]'::jsonb where id='%s'$q$, staff));
perform public.must_pass('マスター：権限を戻す',
  format($q$update public.employees set role='employee', admin_permissions=null where id='%s'$q$, staff));

raise notice '--- 73a：サーバー処理は素通りすること ---';
perform public.be('server');
perform public.must_pass('サーバー：権限を変更できる',
  format($q$update public.employees set role='employee' where id='%s'$q$, staff));

raise notice '--- 73b：通勤手当が隠れていること ---';
perform public.be('admin_all');
perform public.expect_value('管理者：ビューで通勤手当が伏せられる',
  format($q$select commute_allowance::text from public.employees_visible where id='%s'$q$, staff), null);
perform public.must_fail('管理者：基の表から通勤手当を引く',
  $q$select commute_allowance from public.employees$q$);
perform public.must_fail('管理者：通勤手当を書き換える',
  format($q$update public.employees set commute_allowance=99999 where id='%s'$q$, staff));

raise notice '--- 73b：最寄り駅は従来どおり見えること（狭めすぎていないこと）---';
perform public.expect_value('管理者：最寄り駅は見える',
  format($q$select nearest_station from public.employees_visible where id='%s'$q$, staff), '亀岡');

raise notice '--- 73b：マスター管理者と本人は通勤手当を見られること ---';
perform public.be('master');
perform public.expect_value('マスター：通勤手当が見える',
  format($q$select commute_allowance::text from public.employees_visible where id='%s'$q$, staff), '4200');
perform public.be('staff');
perform public.expect_value('スタッフ：自分の通勤手当が見える',
  format($q$select commute_allowance::text from public.employees_visible where id='%s'$q$, staff), '4200');

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
