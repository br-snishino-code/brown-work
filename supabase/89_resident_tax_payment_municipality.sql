-- 89_resident_tax_payment_municipality.sql
--
-- 住民税の「納付先市区町村」を別に持てるようにする
--
-- これまで、スタッフ詳細の住民税欄には市区町村が1つしかなく、
-- 「給与支払報告書提出先」として使っていました。
-- 納付先はそれとは別に持ちたいので、2列足します。
--
--   resident_tax_payment_municipality_code … 納付先の市区町村コード（6桁）
--   resident_tax_payment_municipality      … 納付先の市区町村名
--
-- どちらも全国地方公共団体コード（総務省）の6桁です。
-- 提出先の2列（resident_tax_municipality_code / resident_tax_municipality）は
-- これまでどおり残ります。
--
-- 誰が見られるか：
--   本人とマスター管理者だけです。提出先と同じ扱いにします。
--   ご本人も「自分では変更できない列」に入れます（住民税は会社が扱うため）。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- 流す順番：
--   アプリのデプロイより先でもあとでも構いません。
--   先に流した場合、古いアプリは新しい列を読まないだけで壊れません。
--   あとに流す場合、SQLを流すまでは納付先を保存できません。

begin;

-- ============================================================
-- ① 納付先の列を足す
-- ============================================================
alter table public.employees
  add column if not exists resident_tax_payment_municipality_code text;
alter table public.employees
  add column if not exists resident_tax_payment_municipality text;

comment on column public.employees.resident_tax_payment_municipality_code is
  '住民税の納付先市区町村コード（全国地方公共団体コード・6桁）';
comment on column public.employees.resident_tax_payment_municipality is
  '住民税の納付先市区町村名（都道府県名を含む表記）';

comment on column public.employees.resident_tax_municipality_code is
  '給与支払報告書の提出先市区町村コード（全国地方公共団体コード・6桁）';
comment on column public.employees.resident_tax_municipality is
  '給与支払報告書の提出先市区町村名（都道府県名を含む表記）';


-- ============================================================
-- ② 本人では変更できない列に足す（86番の作り直し）
--    足したのは納付先の2列だけです。
-- ============================================================
create or replace function public.guard_employee_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  -- 本人では変更できない列（権限・給与・雇用条件・社会保険・税）
  protected_cols text[] := array[
    'role', 'admin_permissions', 'username', 'staff_number',
    'wage_type', 'hourly_wage', 'monthly_salary', 'daily_wage', 'daily_wage_holiday',
    'standard_remuneration_health', 'standard_remuneration_pension',
    'hire_date', 'resignation_date', 'resignation_reason_id', 'resignation_note',
    'staff_type', 'job_title', 'main_group', 'sub_group',
    'scheduled_weekly_days', 'leave_adjustment',
    'contract_start', 'contract_end',
    'commute_allowance', 'deemed_overtime_hours', 'commute_claim_mode',
    'health_insurance_status', 'health_insurance_number',
    'health_insurance_acquired_date', 'health_insurance_lost_date',
    'pension_status', 'pension_basic_number',
    'pension_acquired_date', 'pension_lost_date',
    'employment_insurance_status', 'employment_insurance_number',
    'employment_insurance_acquired_date', 'employment_insurance_lost_date',
    'spouse_annual_income', 'spouse_monthly_income', 'family_members',
    'resident_tax_municipality_code', 'resident_tax_municipality',
    'resident_tax_payment_municipality_code', 'resident_tax_payment_municipality',
    'resident_tax_collection_method', 'tax_table_type',
    'is_non_resident', 'disability_classification',
    'is_working_student', 'single_parent_classification'
  ];
  caller      uuid := auth.uid();
  caller_role text;
  old_row     jsonb := to_jsonb(old);
  new_row     jsonb := to_jsonb(new);
  col         text;
  changed     text[] := array[]::text[];
begin
  -- サーバー側（service_role キーを使う Edge Function）からの更新は対象外
  if caller is null then
    return new;
  end if;

  select e.role into caller_role from public.employees e where e.id = caller;

  -- 管理者・マスター管理者はこれまでどおり全列を更新できる
  if caller_role in ('admin', 'master_admin') then
    return new;
  end if;

  -- 念のため：管理者でない人が他人の行を更新しようとした場合は拒否
  -- （RLS でも止まるが、二重の防御）
  if caller is distinct from new.id then
    raise exception '他のスタッフの情報は変更できません'
      using errcode = '42501';
  end if;

  -- 保護列が1つでも変わっていたら拒否する
  foreach col in array protected_cols loop
    if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
      changed := changed || col;
    end if;
  end loop;

  if array_length(changed, 1) > 0 then
    raise exception 'ご自身では変更できない項目が含まれています（%）。お手数ですが管理者にご依頼ください。',
      array_to_string(changed, ', ')
      using errcode = '42501';
  end if;

  return new;
end;
$func$;

drop trigger if exists guard_employee_self_update on public.employees;
create trigger guard_employee_self_update
  before update on public.employees
  for each row
  execute function public.guard_employee_self_update();


-- ============================================================
-- ③ 管理者以外に見せない列に足す（86番の作り直し）
--    足したのは納付先の2列だけです。
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
    'wage_type', 'hourly_wage', 'monthly_salary', 'daily_wage', 'daily_wage_holiday',
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
    'resident_tax_payment_municipality_code', 'resident_tax_payment_municipality',
    'resident_tax_collection_method',
    'tax_table_type', 'is_non_resident',
    'disability_classification', 'is_working_student',
    'single_parent_classification'
  ];
$$;


-- ============================================================
-- ④ employees_visible を作り直す（86番と同じやり方）
--    列を足しただけではビューに入らないため、作り直しが要ります。
-- ============================================================
do $do$
declare
  r         record;
  sensitive text[] := public.employee_sensitive_columns();
  parts     text[] := '{}';
  hidden    text[] := '{}';
  shown     text[] := '{}';
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

  execute 'drop view if exists public.employees_visible';
  execute format(
    'create view public.employees_visible as select %s from public.employees e '
    || 'where e.id = auth.uid() or public.is_admin()',
    array_to_string(parts, ', '));
  execute 'alter view public.employees_visible set (security_invoker = false)';
  -- 利用者が書いた条件が、ビュー自身の絞り込みより先に評価されるのを防ぐ（75番）
  execute 'alter view public.employees_visible set (security_barrier = true)';
  execute 'grant select on public.employees_visible to authenticated';

  execute 'revoke select on public.employees from authenticated';
  execute format('grant select (%s) on public.employees to authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(shown) c));
  execute 'grant update on public.employees to authenticated';

  raise notice '隠す列：%件 / 見せる列：%件',
    array_length(hidden, 1), array_length(shown, 1);
end $do$;

notify pgrst, 'reload schema';

commit;


-- ============================================================
-- 確認（このSQLを実行したあとで試せます）
-- ============================================================
-- ① 列が増えているか
--   select column_name, data_type
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'employees'
--      and column_name like 'resident_tax_%municipality%'
--    order by column_name;
--   → 4行返ります。
--      resident_tax_municipality                   … 提出先（名称）
--      resident_tax_municipality_code              … 提出先（コード）
--      resident_tax_payment_municipality           … 納付先（名称）
--      resident_tax_payment_municipality_code      … 納付先（コード）
--
-- ② 見せない列に入っているか
--   select unnest(public.employee_sensitive_columns()) as col
--    where unnest like 'resident_tax_payment%';
--   ↑ これは書けないので、代わりに次で確かめてください：
--   select count(*) from unnest(public.employee_sensitive_columns()) c
--    where c like 'resident_tax_payment%';
--   → 2 が返ります。
--
-- ③ ビューに入っているか
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'employees_visible'
--      and column_name like 'resident_tax_payment%'
--    order by column_name;
--   → 2行返ります。
