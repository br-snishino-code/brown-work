-- 78番を流す「前」の状態を確かめる。
-- ここが「NG」ではなく「不具合を再現できた」ことを示す。
\set ON_ERROR_STOP on
set role tester;

\echo ''
\echo '=== 修正前：管理者が全スタッフの年末調整を読めてしまう ==='
select public.be('admin');
select public.expect_count('管理者から見える年末調整の件数（2件＝全員分が見えている）',
  $$select count(*) from public.year_end_adjustments$$, 2);
select public.expect_count('管理者が他人の配偶者の所得を読める（1件＝読めてしまう）',
  $$select count(*) from public.year_end_adjustments
     where employee_id = '00000000-0000-0000-0000-000000000005'
       and spouse_income is not null$$, 1);

\echo ''
\echo '=== 修正前：スタッフが他人の出勤規定日数を読めてしまう ==='
select public.be('A');
select public.expect_count('スタッフAから見える出勤規定日数（2件＝他人の分も見えている）',
  $$select count(*) from public.employee_attendance_schedules$$, 2);

\echo ''
\echo '=== 不具合を再現できました。78番を流して直します ==='
