-- 71番の検証。あるべき姿を書いてある。
\set ON_ERROR_STOP on
set role tester;

do $$
declare
  staff_id uuid := '00000000-0000-0000-0000-000000000005';
begin

raise notice '--- ビュー：行は全管理者に見える（勤怠が壊れないこと）---';
perform public.be('admin_att');
perform public.expect_value('勤怠のみの管理者：全員の行が見える',
  $q$select count(*)::text from public.employees_visible$q$, '4');
perform public.expect_value('勤怠のみの管理者：氏名は見える',
  format($q$select name from public.employees_visible where id='%s'$q$, staff_id), 'スタッフ');
perform public.expect_value('勤怠のみの管理者：所属は見える',
  format($q$select main_group from public.employees_visible where id='%s'$q$, staff_id), '店舗A');

raise notice '--- ビュー：隠す列は管理者に伏せられる ---';
perform public.be('admin_all');
perform public.expect_value('全タブ管理者：住所は伏せられる',
  format($q$select address from public.employees_visible where id='%s'$q$, staff_id), null);
perform public.expect_value('全タブ管理者：口座番号は伏せられる',
  format($q$select account_number from public.employees_visible where id='%s'$q$, staff_id), null);
perform public.expect_value('全タブ管理者：生年月日は伏せられる',
  format($q$select birth_date::text from public.employees_visible where id='%s'$q$, staff_id), null);
perform public.expect_value('全タブ管理者：時給は伏せられる',
  format($q$select hourly_wage::text from public.employees_visible where id='%s'$q$, staff_id), null);
perform public.expect_value('全タブ管理者：健康保険番号は伏せられる',
  format($q$select health_insurance_number from public.employees_visible where id='%s'$q$, staff_id), null);
perform public.expect_value('全タブ管理者：家族構成は伏せられる',
  format($q$select family_members::text from public.employees_visible where id='%s'$q$, staff_id), null);

raise notice '--- ビュー：本人は自分の分を見られる ---';
perform public.be('staff');
perform public.expect_value('スタッフ：自分の住所は見える',
  format($q$select address from public.employees_visible where id='%s'$q$, staff_id), '京都府亀岡市5-5');
perform public.expect_value('スタッフ：自分の口座番号は見える',
  format($q$select account_number from public.employees_visible where id='%s'$q$, staff_id), '5678901');
perform public.expect_value('スタッフ：他人の行は見えない',
  $q$select count(*)::text from public.employees_visible$q$, '1');

raise notice '--- ビュー：マスター管理者はすべて見える ---';
perform public.be('master');
perform public.expect_value('マスター：他人の住所が見える',
  format($q$select address from public.employees_visible where id='%s'$q$, staff_id), '京都府亀岡市5-5');
perform public.expect_value('マスター：他人の口座番号が見える',
  format($q$select account_number from public.employees_visible where id='%s'$q$, staff_id), '5678901');
perform public.expect_value('マスター：全員の行が見える',
  $q$select count(*)::text from public.employees_visible$q$, '4');

raise notice '--- 基の表：隠す列は列ごと読めない（ここが抜けていると意味がない）---';
perform public.be('admin_all');
perform public.must_fail('全タブ管理者：基の表から住所を引く',
  $q$select address from public.employees$q$);
perform public.must_fail('全タブ管理者：基の表から口座番号を引く',
  $q$select account_number from public.employees$q$);
perform public.must_fail('全タブ管理者：基の表を select * で引く',
  $q$select * from public.employees$q$);
perform public.expect_value('全タブ管理者：隠さない列は基の表から引ける',
  format($q$select main_group from public.employees where id='%s'$q$, staff_id), '店舗A');
perform public.be('master');
perform public.must_fail('マスターでも基の表から住所は引けない（読み取りはビュー経由に統一）',
  $q$select address from public.employees$q$);
perform public.be('staff');
perform public.must_fail('スタッフでも基の表から自分の住所は引けない（同上）',
  $q$select address from public.employees$q$);

raise notice '--- 更新：管理者は隠す列を書き換えられない ---';
perform public.be('admin_all');
perform public.must_fail('全タブ管理者：他人の住所を書き換え',
  format($q$update public.employees set address='書き換え' where id='%s'$q$, staff_id));
perform public.must_fail('全タブ管理者：他人の口座番号を書き換え',
  format($q$update public.employees set account_number='9999999' where id='%s'$q$, staff_id));
perform public.must_fail('全タブ管理者：他人の時給を書き換え',
  format($q$update public.employees set hourly_wage=9999 where id='%s'$q$, staff_id));

raise notice '--- 更新：管理者でも隠さない列は従来どおり変えられる ---';
perform public.must_pass('全タブ管理者：所属グループを変更',
  format($q$update public.employees set main_group='店舗B' where id='%s'$q$, staff_id));
perform public.must_pass('全タブ管理者：スタッフメモを変更',
  format($q$update public.employees set staff_note1='メモ' where id='%s'$q$, staff_id));

raise notice '--- 更新：本人とマスター管理者は隠す列も変えられる ---';
perform public.be('staff');
perform public.must_pass('スタッフ：自分の住所を変更',
  format($q$update public.employees set address='引っ越し先' where id='%s'$q$, staff_id));
perform public.be('master');
perform public.must_pass('マスター：他人の口座番号を変更',
  format($q$update public.employees set account_number='8888888' where id='%s'$q$, staff_id));

raise notice '--- サーバー処理（Edge Function）は素通りする ---';
perform public.be('server');
perform public.must_pass('サーバー：隠す列を変更できる',
  format($q$update public.employees set address='サーバー経由' where id='%s'$q$, staff_id));

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
