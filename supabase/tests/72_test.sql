-- 72番の検証。あるべき姿を書いてある。
-- 72番を当てる前に流すと「給与タブの管理者」のところで落ちる（それが今の状態）。
\set ON_ERROR_STOP on
set role tester;

do $$
declare
  staff uuid := '00000000-0000-0000-0000-000000000005';
begin

raise notice '--- 給与タブを許可された管理者（ここが今回の修正点）---';
perform public.be('admin_pay');
perform public.expect_count('給与タブ管理者：他人の給与明細は見えない',
  format($q$select count(*) from public.payroll_records where employee_id='%s'$q$, staff), 0);
perform public.expect_count('給与タブ管理者：他人の賞与明細は見えない',
  format($q$select count(*) from public.bonus_records where employee_id='%s'$q$, staff), 0);
perform public.expect_count('給与タブ管理者：自分の明細は見える',
  $q$select count(*) from public.payroll_records where employee_id=auth.uid()$q$, 1);
perform public.must_fail('給与タブ管理者：他人の明細を作る',
  format($q$insert into public.payroll_records (employee_id,year,month,total) values ('%s',2026,11,1)$q$, staff));
perform public.expect_count('給与タブ管理者：交通費は従来どおり見える（狭めていないこと）',
  $q$select count(*) from public.commute_expense_claims$q$, 1);

raise notice '--- 給与タブを持たない管理者（従来どおり見えない）---';
perform public.be('admin_att');
perform public.expect_count('勤怠のみの管理者：他人の給与明細は見えない',
  format($q$select count(*) from public.payroll_records where employee_id='%s'$q$, staff), 0);

raise notice '--- スタッフ本人（従来どおり自分の公開済みが見える）---';
perform public.be('staff');
perform public.expect_count('スタッフ：自分の公開済み給与明細が見える',
  $q$select count(*) from public.payroll_records where status='published'$q$, 1);
perform public.expect_count('スタッフ：自分の下書きは見えない（従来どおり）',
  $q$select count(*) from public.payroll_records where status='draft'$q$, 0);
perform public.expect_count('スタッフ：自分の賞与明細が見える',
  $q$select count(*) from public.bonus_records$q$, 1);
perform public.expect_count('スタッフ：他人の明細は見えない',
  $q$select count(*) from public.payroll_records where employee_id<>auth.uid()$q$, 0);

raise notice '--- マスター管理者（従来どおりすべて）---';
perform public.be('master');
perform public.expect_count('マスター：全員の給与明細が見える',
  $q$select count(*) from public.payroll_records$q$, 3);
perform public.expect_count('マスター：全員の賞与明細が見える',
  $q$select count(*) from public.bonus_records$q$, 1);
perform public.must_pass('マスター：明細を作れる',
  format($q$insert into public.payroll_records (employee_id,year,month,total) values ('%s',2026,11,270000)$q$, staff));
perform public.must_pass('マスター：明細を公開できる',
  format($q$update public.payroll_records set status='published' where employee_id='%s' and month=11$q$, staff));

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
