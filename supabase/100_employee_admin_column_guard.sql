-- 100_employee_admin_column_guard.sql
--
-- 【セキュリティ修正】管理者が「見られない列」を書き換えられる点を塞ぐ
--
-- 経緯：
--   employees の読み取りは employees_visible ビューを通しており、
--   住所・賃金・口座・社会保険番号などの列は
--   can_see_employee_detail()（本人またはマスター管理者）が false の人には
--   null で返している。つまり管理者（admin）には見えない。
--
--   ところが書き込み側の guard_employee_self_update() は
--     if caller_role in ('admin', 'master_admin') then return new;
--   となっており、管理者も全列を更新できた。
--   画面からは起こらないが、APIを直接呼べば書き換えられる。
--   賃金が書き換わると給与計算が狂う。
--
-- このSQLでやること：
--   guard_employee_self_update() を作り直し、管理者には
--   employee_sensitive_columns()（＝読み取りで隠している列）の
--   変更を許さないようにする。
--   列の一覧は関数から取るので、今後 列が増えても読み取りと書き込みがずれない。
--
-- 変えないこと：
--   ・マスター管理者は、これまでどおり全列を更新できる
--   ・本人が変更できない列（protected_cols）は、これまでどおり
--   ・管理者が業務で使う列（氏名・所属グループ・雇用形態・入社日・
--     退職日・役職・契約期間など）は、これまでどおり更新できる
--     （これらは読み取りでも管理者に見せている列なので、隠す対象ではない）
--   ・Edge Function（service_role）からの更新は、これまでどおり通る
--   ・役割と管理者権限の変更は、別のトリガー
--     guard_employee_role_change がマスター管理者だけに限っている
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--           読み取り専用ではありません。関数を1つ作り直します。

begin;

-- 前提の確認
do $pre$
begin
  if to_regprocedure('public.employee_sensitive_columns()') is null then
    raise exception 'public.employee_sensitive_columns() がありません。先に 71a を適用してください';
  end if;
  if to_regclass('public.employees') is null then
    raise exception 'public.employees がありません';
  end if;
end $pre$;


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
  -- 管理者では変更できない列
  --   ＝ 読み取りで管理者に隠している列（employees_visible と同じ一覧）
  sensitive_cols text[] := public.employee_sensitive_columns();
  caller uuid := auth.uid();
  caller_role text;
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  changed text[] := '{}';
  col text;
begin
  -- サーバー側の処理（Edge Function）はそのまま通す
  if caller is null then
    return new;
  end if;

  select e.role into caller_role from public.employees e where e.id = caller;

  -- マスター管理者は全列を更新できる
  if caller_role = 'master_admin' then
    return new;
  end if;

  -- 管理者：見られない列は、書き換えもできない
  if caller_role = 'admin' then
    foreach col in array sensitive_cols loop
      if (old_row ? col) and (new_row -> col) is distinct from (old_row -> col) then
        changed := changed || col;
      end if;
    end loop;

    if array_length(changed, 1) > 0 then
      raise exception '管理者では変更できない項目が含まれています（%）。お手数ですがマスター管理者にご依頼ください。',
        array_to_string(changed, ', ')
        using errcode = '42501';
    end if;

    return new;
  end if;

  -- ここから下はスタッフ本人

  -- 念のため：他人の行を更新しようとした場合は拒否（RLS でも止まるが、二重の防御）
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

-- トリガーは既にあるものをそのまま使います（関数を差し替えただけです）
drop trigger if exists guard_employee_self_update on public.employees;
create trigger guard_employee_self_update
  before update on public.employees
  for each row
  execute function public.guard_employee_self_update();

commit;

notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：この3つが出れば成功です
--   ・管理者が変更できない列の数 … 50前後（読み取りで隠している列と同じ数）
--   ・本人が変更できない列の数   … 51
--   ・トリガー                   … 2件（self_update と role_change）
-- ------------------------------------------------------------
select
  array_length(public.employee_sensitive_columns(), 1) as "管理者が変更できない列の数",
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'employees') as "employeesの全列数",
  (select count(*) from pg_trigger t
    where t.tgrelid = 'public.employees'::regclass and not t.tgisinternal) as "トリガーの数";
