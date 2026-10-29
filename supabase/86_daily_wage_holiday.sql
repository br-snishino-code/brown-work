-- 86_daily_wage_holiday.sql
--
-- 日給制に「土日祝の日額」を足す
--
-- 日給制の方は、平日と土日祝で日額が違います。
-- これまでの daily_wage を平日の日額として使い、
-- 土日祝の日額（daily_wage_holiday）を1列足します。
--
-- 計算の決まり（御社に確認済み）：
--   基本給   = 平日の日額 × 平日の出勤日数 ＋ 土日祝の日額 × 土日祝の出勤日数
--   残業単価 = その日の日額 ÷ 1日の所定労働時間
--              平日の残業は平日の日額から、土日祝の残業は土日祝の日額から出します。
--              （労働基準法施行規則第19条第1項第2号）
--   深夜手当も同じく、その日の日額から出します。
--   有給休暇も、取得した日が平日か土日祝かでその日の日額を使います。
--
-- 土日祝の日額が未登録（または0円）の方は、平日の日額を土日祝にも使います。
-- 単価が分かれていない方の設定を増やさないためです。
--
-- この列は賃金の情報なので、時給・日給・月給と同じ扱いにします：
--   ・本人では変更できない（45番・85番の保護列に足す）
--   ・管理者以外には見えない（employee_sensitive_columns に足す）
--   ・employees_visible を作り直して、新しい列を含める
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
-- 何度流しても同じ結果になります。
--
-- 流す順番：
--   85番（日給制）を先に流してください。
--   アプリのデプロイより先でもあとでも構いません。
--   先に流した場合、古いアプリは daily_wage_holiday を読まないだけで壊れません。
--   あとに流す場合、SQLを流すまでは土日祝の日額を保存できません。

begin;

-- ============================================================
-- ① 土日祝の日額の列を足す
-- ============================================================
alter table public.employees
  add column if not exists daily_wage_holiday numeric;

comment on column public.employees.daily_wage_holiday is
  '日給制の土日祝1日あたりの賃金。未登録または0のときは daily_wage（平日）を使う';

comment on column public.employees.daily_wage is
  '日給制の平日1日あたりの賃金。wage_type = ''daily'' のときに使う';


-- ============================================================
-- ② 本人では変更できない列に足す（45番の作り直し）
--    足したのは 'daily_wage_holiday' の1つだけです。
-- ============================================================
create or replace function public.guard_employee_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
declare
  -- 本人では変更できない列（権限・給与・雇用条件・社会保険）
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
-- ③ 管理者以外に見せない列に足す（76番の作り直し）
--    足したのは 'daily_wage_holiday' の1つだけです。
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
    'resident_tax_collection_method',
    'tax_table_type', 'is_non_resident',
    'disability_classification', 'is_working_student',
    'single_parent_classification'
  ];
$$;


-- ============================================================
-- ④ employees_visible を作り直す（77番と同じやり方）
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
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'employees'
--      and column_name = 'daily_wage_holiday';
--   → 1行返れば足せています。
--
-- ② ビューに入っているか
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'employees_visible'
--      and column_name = 'daily_wage_holiday';
--   → 1行返れば入っています。
--
-- ③ 本人では変えられないか
--   スタッフのアカウントでログインした状態で、ブラウザのコンソールから
--     await supabase.from('employees').update({ daily_wage_holiday: 99999 }).eq('id', 自分のID)
--   を実行すると、error に
--     「ご自身では変更できない項目が含まれています（daily_wage_holiday）」
--   が返ります。
