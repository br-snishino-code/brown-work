-- 76_linter_hardening.sql
--
-- 【検査の指摘への対応】Supabase の database linter が報告した項目のうち、
-- 手を入れるべきものをまとめて直す。
--
-- ■ 直すもの
--   ① 関数の search_path が固定されていない（function_search_path_mutable）
--        public.employee_sensitive_columns
--        public.set_employee_attendance_schedules_updated_at
--   ② 更新ポリシーの with check が true（rls_policy_always_true）
--        shift_request_answers    "shift answer update"
--        shift_request_periods    "shift period update"
--        commute_expense_claims   "commute_expense_claims_update"
--   ③ トリガー用の関数が REST から呼べる
--        public.guard_* をまとめて anon・authenticated から外す
--        public.employee_sensitive_columns も同様
--   ④ 判定用の関数が未ログインから呼べる
--        is_admin / is_master_admin / has_admin_tab / can_see_employee_detail /
--        caller_is_admin / mfa_ok / perf_deadline_* を anon からだけ外す
--
-- ■ 直さないもの（直せないもの）
--   判定用の関数を authenticated から外すことはできない。
--   手元で試したところ、外すと employees_visible ビューが
--   「permission denied for function is_admin」で動かなくなった。
--   RLSポリシーとビューがこれらを使っているため、ログイン中の利用者には
--   実行権限が必要。したがって
--   authenticated_security_definer_function_executable の報告は
--   この構成では残り続ける。既知として扱う。
--
--   security_definer_view（employees_visible）も同様に残る。
--   75番で security_barrier を付けて実害は塞いである。
--
-- ■ ②について（検査の指摘は正しいが、現状は悪用できない）
--   with check が true でも、PostgreSQL は UPDATE のときに新しい行へ
--   SELECTポリシーも適用するため、他人の行に書き換えることはできない。
--   手元で試して確認済み。ただしSELECTポリシーを将来広げたときに
--   穴になるため、with check を使う側と揃えておく。
--
-- ■ 検査の報告のうち、SQLでは直せないもの
--   auth_leaked_password_protection（流出パスワードの照合）は
--   ダッシュボードの Authentication の設定。SQLでは変更できない。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


begin;

-- ============================================================
-- ① 関数の search_path を固定する
-- ============================================================
create or replace function public.employee_sensitive_columns()
returns text[]
language sql
immutable
set search_path = pg_catalog, public
as $$
  select array[
    'postal_code', 'address', 'resident_address',
    'householder_name', 'householder_relation',
    'birth_date', 'gender', 'phone', 'contact_email',
    'emergency_contact_name', 'emergency_contact_furigana',
    'emergency_contact_relation', 'emergency_contact_phone',
    'emergency_contact_address',
    'wage_type', 'hourly_wage', 'monthly_salary',
    'commute_allowance',
    'bank_code', 'bank_name', 'branch_code', 'branch_name',
    'account_type', 'account_holder', 'account_number',
    'health_insurance_status', 'health_insurance_number',
    'health_insurance_acquired_date', 'health_insurance_lost_date',
    'pension_status', 'pension_basic_number',
    'pension_acquired_date', 'pension_lost_date',
    'employment_insurance_status', 'employment_insurance_number',
    'employment_insurance_acquired_date', 'employment_insurance_lost_date',
    'standard_remuneration_health', 'standard_remuneration_pension',
    'spouse_status', 'spouse_annual_income', 'spouse_monthly_income',
    'family_members',
    'resident_tax_municipality_code', 'resident_tax_municipality',
    'resident_tax_collection_method',
    'tax_table_type', 'is_non_resident',
    'disability_classification', 'is_working_student',
    'single_parent_classification'
  ];
$$;

do $do$
begin
  if to_regprocedure('public.set_employee_attendance_schedules_updated_at()') is not null then
    execute 'alter function public.set_employee_attendance_schedules_updated_at() '
         || 'set search_path = pg_catalog, public';
    raise notice 'search_path を固定しました: set_employee_attendance_schedules_updated_at';
  else
    raise notice 'スキップ（関数がありません）: set_employee_attendance_schedules_updated_at';
  end if;
end $do$;


-- ============================================================
-- ② 更新ポリシーの with check を、using と揃える
-- ============================================================
do $do$
begin
  -- シフト希望の回答：本人または管理者の行だけに書き込める
  if to_regclass('public.shift_request_answers') is not null then
    drop policy if exists "shift answer update" on public.shift_request_answers;
    create policy "shift answer update"
      on public.shift_request_answers for update to authenticated
      using (
        employee_id = auth.uid()
        or exists (select 1 from public.employees e
                    where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
      )
      with check (
        employee_id = auth.uid()
        or exists (select 1 from public.employees e
                    where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
      );
    raise notice '直しました: shift answer update';
  end if;

  -- シフト希望の募集期間：管理者のみ
  if to_regclass('public.shift_request_periods') is not null then
    drop policy if exists "shift period update" on public.shift_request_periods;
    create policy "shift period update"
      on public.shift_request_periods for update to authenticated
      using (
        exists (select 1 from public.employees e
                 where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
      )
      with check (
        exists (select 1 from public.employees e
                 where e.id = auth.uid() and e.role in ('admin', 'master_admin'))
      );
    raise notice '直しました: shift period update';
  end if;

  -- 交通費精算（マスター管理者による承認の経路）：マスター管理者のみ
  -- 本人が直す経路は "own commute claim update" が別にあり、そちらは変更しない
  if to_regclass('public.commute_expense_claims') is not null then
    drop policy if exists "commute_expense_claims_update" on public.commute_expense_claims;
    create policy "commute_expense_claims_update"
      on public.commute_expense_claims for update to authenticated
      using (
        exists (select 1 from public.employees e
                 where e.id = auth.uid() and e.role = 'master_admin')
      )
      with check (
        exists (select 1 from public.employees e
                 where e.id = auth.uid() and e.role = 'master_admin')
      );
    raise notice '直しました: commute_expense_claims_update';
  end if;
end $do$;


-- ============================================================
-- ③ トリガー用の関数を REST から呼べないようにする
--    トリガーとしての動作は変わらない（手元で確認済み）
-- ============================================================
do $do$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'guard\_%' or p.proname = 'employee_sensitive_columns'
            or p.proname = 'set_employee_attendance_schedules_updated_at')
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', r.sig);
    n := n + 1;
  end loop;
  raise notice 'REST から外した関数：%件', n;
end $do$;


-- ============================================================
-- ④ 判定用の関数を、未ログイン（anon）からだけ外す
--    authenticated は RLS とビューが使うため残す
-- ============================================================
do $do$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('is_admin', 'is_master_admin', 'has_admin_tab',
                         'can_see_employee_detail', 'caller_is_admin', 'mfa_ok',
                         'perf_deadline_date', 'perf_deadline_day')
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    n := n + 1;
  end loop;
  raise notice '未ログインから外した関数：%件', n;
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
-- (1) with check が true のままの更新ポリシーが無いこと（0件なら成功）
select count(*) as "with check が true の更新ポリシー（0なら成功）"
from pg_policies
where schemaname = 'public' and cmd in ('UPDATE', 'INSERT', 'DELETE')
  and with_check = 'true';

-- (2) search_path が固定されていない関数（この2つが消えていれば成功）
select p.proname as "search_path が未設定の関数"
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef is not null
  and p.proconfig is null
  and p.proname in ('employee_sensitive_columns', 'set_employee_attendance_schedules_updated_at');

-- (3) トリガー関数が anon・authenticated から呼べないこと（0件なら成功）
select count(*) as "RESTから呼べるトリガー関数（0なら成功）"
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'guard\_%'
  and (has_function_privilege('anon', p.oid, 'execute')
       or has_function_privilege('authenticated', p.oid, 'execute'));
