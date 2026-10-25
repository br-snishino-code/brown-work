-- 78番を流した「後」の確認。78_setup.sql → 78_before_test.sql → 78番 → これ、の順。
\set ON_ERROR_STOP on
set role tester;

\echo ''
\echo '=== ① 管理者は年末調整を読めない ==='
select public.be('admin');
select public.expect_count('管理者から見える年末調整（0件なら成功）',
  $$select count(*) from public.year_end_adjustments$$, 0);
select public.expect_count('管理者が配偶者の所得を読む（0件なら成功）',
  $$select count(*) from public.year_end_adjustments where spouse_income is not null$$, 0);
select public.must_touch_none('管理者が年末調整を承認する',
  $$update public.year_end_adjustments set status='approved'
     where id='11111111-0000-0000-0000-00000000000A'$$);
select public.must_touch_none('管理者が年末調整を消す',
  $$delete from public.year_end_adjustments
     where id='11111111-0000-0000-0000-00000000000A'$$);

\echo ''
\echo '=== ② マスター管理者はこれまでどおり ==='
select public.be('master');
select public.expect_count('マスター管理者から見える年末調整（2件なら成功）',
  $$select count(*) from public.year_end_adjustments$$, 2);
select public.must_pass('マスター管理者が年末調整を承認する',
  $$update public.year_end_adjustments set status='approved'
     where id='11111111-0000-0000-0000-00000000000A'$$);

\echo ''
\echo '=== ③ スタッフ本人はこれまでどおり（ここが壊れると提出できなくなる） ==='
select public.be('A');
select public.expect_count('本人から見えるのは自分の分だけ（1件なら成功）',
  $$select count(*) from public.year_end_adjustments$$, 1);
select public.expect_count('本人は自分の配偶者の所得を読める（1件なら成功）',
  $$select count(*) from public.year_end_adjustments where spouse_income is not null$$, 1);
select public.must_pass('本人が自分の年末調整を修正する',
  $$update public.year_end_adjustments set life_insurance=90000
     where employee_id='00000000-0000-0000-0000-000000000005'$$);
select public.must_pass('本人が自分の年末調整を新しく提出する（翌年分）',
  $$insert into public.year_end_adjustments (employee_id, year, spouse_income)
     values ('00000000-0000-0000-0000-000000000005', 2027, 500000)$$);
select public.must_touch_none('本人が他人の年末調整を見て書き換える',
  $$update public.year_end_adjustments set spouse_income=0
     where employee_id='00000000-0000-0000-0000-000000000006'$$);

\echo ''
\echo '=== ④ 出勤規定日数は「本人または管理者」 ==='
select public.be('A');
select public.expect_count('スタッフAから見えるのは自分の分だけ（1件なら成功）',
  $$select count(*) from public.employee_attendance_schedules$$, 1);
select public.be('admin');
select public.expect_count('管理者は全員分を見られる（2件なら成功）',
  $$select count(*) from public.employee_attendance_schedules$$, 2);
select public.must_pass('管理者が出勤規定日数を直す',
  $$update public.employee_attendance_schedules set days=21
     where employee_id='00000000-0000-0000-0000-000000000005' and year=2026 and month=10$$);
select public.be('A');
select public.must_touch_none('スタッフが出勤規定日数を書き換える',
  $$update public.employee_attendance_schedules set days=1
     where employee_id='00000000-0000-0000-0000-000000000005'$$);

\echo ''
\echo '=== ⑤ サーバー側（Edge Function）はそのまま通る ==='
reset role;
select public.be('server');
select public.must_pass('サーバー側が年末調整を書き込む',
  $$update public.year_end_adjustments set status='confirmed'
     where id='11111111-0000-0000-0000-00000000000B'$$);

\echo ''
\echo '=== すべて OK なら 78 番は検証ずみ ==='
