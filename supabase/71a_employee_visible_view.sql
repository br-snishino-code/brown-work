-- 71a_employee_visible_view.sql
--
-- 【1/2】スタッフの個人情報を本人とマスター管理者だけに限る ― 前半
--
-- この前半だけでは何も制限されない。ビューを足すだけで、
-- 既存の画面・権限はいっさい変わらない。安全に先行して流せる。
--
-- 止まらない順番：
--   ① このSQL（71a）を流す        … ビューができる。既存の画面はそのまま動く
--   ② アプリをデプロイする        … 読み取りがビュー経由になる。ここで画面上は伏せられる
--   ③ 71b_employee_column_privileges.sql を流す … データベース側でも読めなくする
--
--   逆順にすると、アプリが「まだ無いビュー」または「読めなくなった列」を
--   読みにいって画面が止まる。必ずこの順で。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run


begin;

-- ------------------------------------------------------------
-- 隠す列の一覧（71a と 71b で共有する。ここだけ直せば両方に効く）
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
-- 誰に中身を見せるか
--   本人 … true ／ マスター管理者 … true ／ それ以外 … false
-- ------------------------------------------------------------
create or replace function public.can_see_employee_detail(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select target = auth.uid() or public.is_master_admin();
$$;

grant execute on function public.can_see_employee_detail(uuid) to authenticated;
grant execute on function public.employee_sensitive_columns() to authenticated;


-- ------------------------------------------------------------
-- ビューを作る
--   行の見え方は従来の employees と同じ（本人または管理者）。
--   隠す列だけ、本人とマスター管理者以外には null で返す。
--   実際に存在する列を見て組み立てるので、列が増減しても
--   このSQLを流し直せば追従する。
-- ------------------------------------------------------------
do $do$
declare
  sensitive text[] := public.employee_sensitive_columns();
  r record;
  parts text[] := '{}';
  hidden text[] := '{}';
  shown  text[] := '{}';
  missing text[];
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

  if array_length(parts, 1) is null then
    raise exception 'public.employees の列が読めませんでした';
  end if;

  execute format(
    'create or replace view public.employees_visible as select %s from public.employees e '
    || 'where e.id = auth.uid() or public.is_admin()',
    array_to_string(parts, ', '));
  -- 作成者の権限で動かす（行の絞り込みは上の where で行っている）
  execute 'alter view public.employees_visible set (security_invoker = false)';
  -- 利用者が書いた条件が、ビュー自身の絞り込みより先に評価されるのを防ぐ
  -- （付けないと、細工した述語で他人の行の氏名などが覗けてしまう）
  execute 'alter view public.employees_visible set (security_barrier = true)';
  execute 'grant select on public.employees_visible to authenticated';

  select array_agg(s) into missing
    from unnest(sensitive) s where s <> all(hidden);

  raise notice '隠す列：%件', coalesce(array_length(hidden, 1), 0);
  raise notice '見せる列：%件 … %', coalesce(array_length(shown, 1), 0), array_to_string(shown, ', ');
  if missing is not null then
    raise notice '※ 表に無かったため読み飛ばした指定：%', array_to_string(missing, ', ');
  end if;
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認：1 が返れば成功
-- ------------------------------------------------------------
select count(*) as "ビュー（1なら成功）"
from information_schema.views
where table_schema = 'public' and table_name = 'employees_visible';
