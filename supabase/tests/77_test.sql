-- 77番の検証。71_setup.sql → 71a → 71b → 73b → 77 の順に積んだあとに流す。
\set ON_ERROR_STOP on
set role tester;

\echo ''
\echo '=== ① 列が足され、ビューから読めるか ==='

select public.expect_value('基の表に3列ある',
  $$select count(*)::text from information_schema.columns
     where table_schema='public' and table_name='employees'
       and column_name in ('shift_request_requirement','performance_requirement','commute_claim_requirement')$$,
  '3');

select public.expect_value('ビューに3列ある',
  $$select count(*)::text from information_schema.columns
     where table_schema='public' and table_name='employees_visible'
       and column_name in ('shift_request_requirement','performance_requirement','commute_claim_requirement')$$,
  '3');

select public.expect_value('既存のスタッフは誰も設定されていない（画面が変わらない）',
  $$select count(*)::text from public.employees
     where shift_request_requirement is not null
        or performance_requirement is not null
        or commute_claim_requirement is not null$$,
  '0');

\echo ''
\echo '=== ② マスター管理者は設定できる ==='
select public.be('master');

select public.must_pass('マスター管理者がスタッフのシフト希望を「不要」にする',
  $$update public.employees set shift_request_requirement='exempt'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_pass('マスター管理者がスタッフの交通費申請を「不要」にする',
  $$update public.employees set commute_claim_requirement='exempt'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_pass('マスター管理者が実績入力を「必要」にする',
  $$update public.employees set performance_requirement='required'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_pass('マスター管理者が設定を取り消す（グループの既定に戻す）',
  $$update public.employees set performance_requirement=null
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.expect_value('マスター管理者から見える設定',
  $$select shift_request_requirement from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$,
  'exempt');

\echo ''
\echo '=== ③ 決められた値しか入らない ==='
select public.must_fail('でたらめな値は入らない',
  $$update public.employees set shift_request_requirement='maybe'
     where id='00000000-0000-0000-0000-000000000005'$$);

\echo ''
\echo '=== ④ 管理者は見えるが変えられない ==='
select public.be('admin_all');

select public.expect_value('管理者にも設定が見える（理由が分かる）',
  $$select shift_request_requirement from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$,
  'exempt');

select public.must_fail('管理者がシフト希望の設定を変える',
  $$update public.employees set shift_request_requirement='required'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_fail('管理者が交通費申請の設定を外す',
  $$update public.employees set commute_claim_requirement=null
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_fail('管理者が実績入力の設定を入れる',
  $$update public.employees set performance_requirement='exempt'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_fail('管理者が自分を免除する',
  $$update public.employees set commute_claim_requirement='exempt'
     where id='00000000-0000-0000-0000-000000000002'$$);

select public.expect_value('拒まれたあとも設定は元のまま',
  $$select shift_request_requirement from public.employees
     where id='00000000-0000-0000-0000-000000000005'$$,
  'exempt');

\echo ''
\echo '=== ⑤ スタッフ本人も変えられない ==='
select public.be('staff');

-- 今の値は 'exempt'。同じ値を入れると「変更なし」で通ってしまうため、別の値にする
select public.must_fail('スタッフが自分の交通費申請の設定を変える',
  $$update public.employees set commute_claim_requirement='required'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_fail('スタッフが自分のシフト希望の設定を外す',
  $$update public.employees set shift_request_requirement=null
     where id='00000000-0000-0000-0000-000000000005'$$);

\echo ''
\echo '=== ⑥ これまでの更新が壊れていないか（大事） ==='
select public.be('admin_all');

select public.must_pass('管理者がスタッフの所属グループを変える',
  $$update public.employees set main_group='店舗B'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.must_pass('管理者がスタッフのメモを変える',
  $$update public.employees set staff_note1='引き継ぎ済み'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.be('staff');
select public.must_pass('スタッフが自分の住所を変える',
  $$update public.employees set address='京都府亀岡市9-9'
     where id='00000000-0000-0000-0000-000000000005'$$);

select public.be('master');
select public.must_pass('マスター管理者がスタッフの時給を変える',
  $$update public.employees set hourly_wage=1300
     where id='00000000-0000-0000-0000-000000000005'$$);

\echo ''
\echo '=== ⑦ 個人情報が引き続き隠れているか（71b・73b が壊れていないか） ==='
select public.be('admin_all');
select public.expect_value('管理者には住所が見えない',
  $$select address from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$, null);
select public.expect_value('管理者には通勤手当が見えない',
  $$select commute_allowance::text from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$, null);
select public.expect_value('管理者には氏名が見える',
  $$select name from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$, 'スタッフ');
select public.must_fail('管理者が基の表から住所を読む',
  $$select address from public.employees where id='00000000-0000-0000-0000-000000000005'$$);

select public.be('staff');
select public.expect_value('本人には自分の住所が見える',
  $$select address from public.employees_visible
     where id='00000000-0000-0000-0000-000000000005'$$, '京都府亀岡市9-9');
select public.expect_value('本人に見える行は自分だけ',
  $$select count(*)::text from public.employees_visible$$, '1');

\echo ''
\echo '=== ⑧ サーバー側（Edge Function）はそのまま通る ==='
reset role;
select public.be('server');
select public.must_pass('サーバー側が設定を書き込む',
  $$update public.employees set commute_claim_requirement='required'
     where id='00000000-0000-0000-0000-000000000005'$$);

\echo ''
\echo '=== すべて OK なら 77 番は検証ずみ ==='
