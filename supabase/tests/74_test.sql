-- 74番の検証。あるべき姿を書いてある。
-- 74番を当てる前に流すと、最初の「出し直し」で落ちる（それが今の不具合）。
\set ON_ERROR_STOP on
set role tester;

do $$
declare
  rejected_claim uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  approved_claim uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
  untouched_claim uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  rejected_month uuid := 'bbbbbbbb-0000-0000-0000-000000000001';
  confirmed_month uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
begin

raise notice '--- 交通費：本人が差し戻しを出し直せること（今回の修正点）---';
perform public.be('staff');
perform public.must_pass('本人：差し戻しを直して出し直す',
  format($q$update public.commute_expense_claims
           set status='pending', admin_comment=null, decided_at=null, total_amount=700
           where id='%s'$q$, rejected_claim));

raise notice '--- 交通費：抜け道ができていないこと ---';
perform public.must_fail('本人：自分の申請を承認済みにする',
  format($q$update public.commute_expense_claims set status='approved' where id='%s'$q$, rejected_claim));
perform public.must_fail('本人：承認済みを承認待ちに戻す',
  format($q$update public.commute_expense_claims
           set status='pending', admin_comment=null, decided_at=null where id='%s'$q$, approved_claim));
perform public.must_fail('本人：出し直しつつ承認コメントを残す',
  format($q$update public.commute_expense_claims
           set status='pending', admin_comment='勝手に書いた', decided_at=null where id='%s'$q$, approved_claim));

raise notice '--- 交通費：他人の申請には触れないこと ---';
perform public.be('other');
perform public.must_fail('別のスタッフ：他人の差し戻しを出し直す',
  format($q$update public.commute_expense_claims
           set status='pending', admin_comment=null, decided_at=null where id='%s'$q$, untouched_claim));

raise notice '--- 交通費：管理者は従来どおり承認できること ---';
perform public.be('admin');
perform public.must_pass('管理者：承認する',
  format($q$update public.commute_expense_claims
           set status='approved', decided_at=now() where id='%s'$q$, rejected_claim));

raise notice '--- 月次勤怠：本人が差し戻しを出し直せること ---';
perform public.be('staff');
perform public.must_pass('本人：差し戻しの月次を出し直す',
  format($q$update public.monthly_attendance_confirmations
           set status='pending', admin_comment=null, admin_decided_by=null, admin_decided_at=null,
               master_comment=null, master_decided_by=null, master_decided_at=null
           where id='%s'$q$, rejected_month));

raise notice '--- 月次勤怠：確定済みは戻せないこと ---';
perform public.must_fail('本人：確定済みを承認待ちに戻す',
  format($q$update public.monthly_attendance_confirmations
           set status='pending' where id='%s'$q$, confirmed_month));
perform public.must_fail('本人：自分の月次を確定済みにする',
  format($q$update public.monthly_attendance_confirmations
           set status='confirmed' where id='%s'$q$, rejected_month));

raise notice '--- 月次勤怠：対象月は変えられないこと（従来どおり）---';
perform public.must_fail('本人：対象月を変える',
  format($q$update public.monthly_attendance_confirmations
           set target_month='2026-07' where id='%s'$q$, rejected_month));

raise notice '--- サーバー処理は素通りすること ---';
perform public.be('server');
perform public.must_pass('サーバー：状態を変えられる',
  format($q$update public.commute_expense_claims set status='pending' where id='%s'$q$, approved_claim));

raise notice '';
raise notice '==== すべて通りました ====';
end $$;

reset role;
