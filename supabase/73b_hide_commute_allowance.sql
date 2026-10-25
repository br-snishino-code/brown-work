-- 73b_hide_commute_allowance.sql
--
-- 【権限の修正】通勤手当も本人とマスター管理者だけに限る
--
-- 経緯：
--   71a/71b で個人情報50列を隠したが、通勤手当（commute_allowance）は
--   交通費の実務で管理者が触る項目として残していた。賃金の一種のため、
--   あわせて隠すことにした。
--
-- この修正：
--   employee_sensitive_columns() に commute_allowance を足し、
--   ビューと列の権限を作り直す。
--
--   最寄り駅（nearest_station）と交通費の申請方法（commute_claim_mode）は
--   そのまま管理者も見られる。交通費精算の確認に使うため。
--
-- 必ずアプリのデプロイを済ませてから流してください：
--   アプリ側は通勤手当を「送らない項目」に加えてある。デプロイ前に
--   このSQLを流すと、古いアプリが通勤手当を送り続けるため、管理者が
--   スタッフ情報を保存できなくなる。
--   （アプリを先に出す分には問題ない。送らなくなるだけで、
--     このSQLを流すまでは画面に表示され続ける）
--
-- 前提：
--   71a_employee_visible_view.sql と 71b_employee_column_privileges.sql
--   が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


begin;

do $do$
begin
  if to_regprocedure('public.employee_sensitive_columns()') is null then
    raise exception '先に 71a_employee_visible_view.sql を適用してください';
  end if;
end $do$;


-- ------------------------------------------------------------
-- 隠す列の一覧に通勤手当を足す
-- ------------------------------------------------------------
create or replace function public.employee_sensitive_columns()
returns text[]
language sql
immutable
as $$
  select array[
    -- 住まい・本人
    'postal_code', 'address', 'resident_address',
    'householder_name', 'householder_relation',
    'birth_date', 'gender', 'phone', 'contact_email',
    -- 緊急連絡先
    'emergency_contact_name', 'emergency_contact_furigana',
    'emergency_contact_relation', 'emergency_contact_phone',
    'emergency_contact_address',
    -- 賃金
    'wage_type', 'hourly_wage', 'monthly_salary',
    'commute_allowance',
    -- 口座情報
    'bank_code', 'bank_name', 'branch_code', 'branch_name',
    'account_type', 'account_holder', 'account_number',
    -- 社会保険・年金・雇用保険
    'health_insurance_status', 'health_insurance_number',
    'health_insurance_acquired_date', 'health_insurance_lost_date',
    'pension_status', 'pension_basic_number',
    'pension_acquired_date', 'pension_lost_date',
    'employment_insurance_status', 'employment_insurance_number',
    'employment_insurance_acquired_date', 'employment_insurance_lost_date',
    'standard_remuneration_health', 'standard_remuneration_pension',
    -- 税・扶養
    'spouse_status', 'spouse_annual_income', 'spouse_monthly_income',
    'family_members',
    'resident_tax_municipality_code', 'resident_tax_municipality',
    'resident_tax_collection_method',
    'tax_table_type', 'is_non_resident',
    'disability_classification', 'is_working_student',
    'single_parent_classification'
  ];
$$;


-- ------------------------------------------------------------
-- ビューと列の権限を作り直す（71a・71b と同じ組み立て方）
-- ------------------------------------------------------------
do $do$
declare
  sensitive text[] := public.employee_sensitive_columns();
  r record;
  parts text[] := '{}';
  hidden text[] := '{}';
  shown  text[] := '{}';
begin
  for r in
    select column_name
      from information_schema.columns
     where table_schema = 'public' and table_name = 'employees'
     order by ordinal_position
  loop
    if r.column_name = any(sensitive) then
      parts := parts || format(
        'case when public.can_see_employee_detail(e.id) then e.%I else null end as %I',
        r.column_name, r.column_name);
      hidden := hidden || r.column_name;
    else
      parts := parts || format('e.%I', r.column_name);
      shown := shown || r.column_name;
    end if;
  end loop;

  if array_length(shown, 1) is null then
    raise exception '見せる列がありません。隠す列の指定を確認してください';
  end if;

  -- 列の構成が変わるため、作り直す（create or replace では列を減らせない）
  execute 'drop view if exists public.employees_visible';
  execute format(
    'create view public.employees_visible as select %s from public.employees e '
    || 'where e.id = auth.uid() or public.is_admin()',
    array_to_string(parts, ', '));
  execute 'alter view public.employees_visible set (security_invoker = false)';
  -- 利用者が書いた条件が、ビュー自身の絞り込みより先に評価されるのを防ぐ
  -- （付けないと、細工した述語で他人の行の氏名などが覗けてしまう）
  execute 'alter view public.employees_visible set (security_barrier = true)';
  execute 'grant select on public.employees_visible to authenticated';

  execute 'revoke select on public.employees from authenticated';
  execute format('grant select (%s) on public.employees to authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(shown) c));
  execute 'grant update on public.employees to authenticated';

  raise notice '隠す列：%件', array_length(hidden, 1);
  raise notice '見せる列：%件 … %', array_length(shown, 1), array_to_string(shown, ', ');
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：0 が返れば成功（通勤手当が基の表から読めなくなっている）
-- ------------------------------------------------------------
select count(*) as "基の表で読める通勤手当（0なら成功）"
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'employees'
  and grantee = 'authenticated' and privilege_type = 'SELECT'
  and column_name = 'commute_allowance';
