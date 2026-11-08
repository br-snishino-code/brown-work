-- 95番の検証。あるべき姿を書いてあります。
-- 95番を当てる前に流すと、最初の「取り消す」で落ちます（それが今の状態）。
\set ON_ERROR_STOP on
set role tester;

do $$
declare
  pending_mine     uuid := 'cccccccc-0000-0000-0000-000000000001';
  pending_mine2    uuid := 'cccccccc-0000-0000-0000-000000000002';
  approved_mine    uuid := 'cccccccc-0000-0000-0000-000000000003';
  rejected_mine    uuid := 'cccccccc-0000-0000-0000-000000000004';
  pending_other    uuid := 'cccccccc-0000-0000-0000-000000000005';
  pending_mine3    uuid := 'cccccccc-0000-0000-0000-000000000006';
  pending_mine4    uuid := 'cccccccc-0000-0000-0000-000000000007';
  leave_mine       uuid := 'dddddddd-0000-0000-0000-000000000001';
begin

raise notice '--- 本人が自分の承認待ちを取り消せること（今回の追加点）---';
perform public.be('staff');
perform public.must_pass('本人：承認待ちを取り消す',
  format($q$update public.corrections set status='cancelled', decided_at=now() where id='%s'$q$, pending_mine));
perform public.must_pass('本人：取り消しの時刻だけ入れずに取り消す',
  format($q$update public.corrections set status='cancelled' where id='%s'$q$, pending_mine2));

raise notice '--- 本人の申請の中身を直す動きは、これまでどおり通ること ---';
perform public.must_pass('本人：承認待ちの中身を書き換える（出し直し）',
  format($q$update public.corrections set requested='{"clockOut":"19:00"}'::jsonb, reason='書き直し' where id='%s'$q$, pending_mine3));

raise notice '--- 抜け道ができていないこと ---';
perform public.must_fail('本人：自分の申請を承認済みにする',
  format($q$update public.corrections set status='approved' where id='%s'$q$, pending_mine4));
perform public.must_fail('本人：自分の申請を却下にする',
  format($q$update public.corrections set status='rejected' where id='%s'$q$, pending_mine4));
perform public.must_fail('本人：承認済みを取り消し済みにする',
  format($q$update public.corrections set status='cancelled' where id='%s'$q$, approved_mine));
perform public.must_fail('本人：却下済みを取り消し済みにする',
  format($q$update public.corrections set status='cancelled' where id='%s'$q$, rejected_mine));
perform public.must_fail('本人：承認済みを承認待ちに戻す',
  format($q$update public.corrections set status='pending', decided_at=null where id='%s'$q$, approved_mine));
perform public.must_fail('本人：取り消し済みの中身を書き換える',
  format($q$update public.corrections set requested='{"clockOut":"23:00"}'::jsonb where id='%s'$q$, pending_mine));
perform public.must_fail('本人：取り消し済みの理由を書き換える',
  format($q$update public.corrections set reason='あとから書いた' where id='%s'$q$, pending_mine));
perform public.must_fail('本人：承認済みの中身を書き換える',
  format($q$update public.corrections set requested='{"clockOut":"23:00"}'::jsonb where id='%s'$q$, approved_mine));
perform public.must_fail('本人：取り消し済みを承認待ちに戻す',
  format($q$update public.corrections set status='pending', decided_at=null where id='%s'$q$, pending_mine));
perform public.must_fail('本人：承認待ちに勝手に決裁の時刻を入れる',
  format($q$update public.corrections set decided_at=now() where id='%s'$q$, pending_mine4));

raise notice '--- 他人の申請には手が出せないこと（RLSが無い土台でも、ガードで止まること）---';
perform public.must_fail('本人：別のスタッフの申請を取り消す',
  format($q$update public.corrections set status='cancelled' where id='%s'$q$, pending_other));

raise notice '--- 管理者はこれまでどおりできること ---';
perform public.be('admin');
perform public.must_pass('管理者：承認する',
  format($q$update public.corrections set status='approved', decided_at=now() where id='%s'$q$, pending_mine4));
perform public.must_pass('管理者：却下する',
  format($q$update public.corrections set status='rejected', decided_at=now() where id='%s'$q$, pending_mine3));
perform public.must_pass('管理者：取り消し済みも動かせる（取り違えを直す場合）',
  format($q$update public.corrections set status='rejected' where id='%s'$q$, pending_mine2));

raise notice '--- ほかの申請のガードが巻き添えになっていないこと ---';
perform public.be('staff');
perform public.must_fail('本人：休暇申請を自分で承認する（これまでどおり拒まれる）',
  format($q$update public.leave_requests set status='approved' where id='%s'$q$, leave_mine));
perform public.must_fail('本人：休暇申請を取り消し済みにする（休暇には cancelled が無い）',
  format($q$update public.leave_requests set status='cancelled' where id='%s'$q$, leave_mine));

raise notice '--- 取り消したあと、同じ日に出し直せること（66番の重複ガード）---';
perform public.must_pass('本人：取り消した日に新しく申請する',
  $q$insert into public.corrections (employee_id, date, requested, reason, status)
     values ('00000000-0000-0000-0000-000000000005','2026-11-01','{"clockIn":"09:30"}'::jsonb,'出し直し','pending')$q$);
perform public.must_fail('本人：承認待ちが残っている日に二重で申請する',
  $q$insert into public.corrections (employee_id, date, requested, reason, status)
     values ('00000000-0000-0000-0000-000000000005','2026-11-01','{"clockIn":"09:40"}'::jsonb,'二重','pending')$q$);

raise notice '';
raise notice '95番の検証：すべて期待どおり';
end $$;

reset role;

-- 最後の状態をひと目で確認する
select status as 状態, count(*) as 件数 from public.corrections group by status order by status;
