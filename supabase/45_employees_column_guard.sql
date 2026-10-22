-- 45_employees_column_guard.sql
--
-- 【緊急・セキュリティ修正①】スタッフが自分で権限や給与を書き換えられる問題をふさぐ
--
-- 経緯：
--   employees の更新ポリシーは「自分の行なら更新できる」だけで、
--   どの列を更新できるかは制限していなかった。
--   そのため、ブラウザの開発者ツールから
--     update employees set role = 'master_admin' where id = 自分のID
--   に相当する命令を1行送るだけで、誰でもマスター管理者に昇格できた。
--   時給・月給・標準報酬・入社日なども同じように書き換えられた。
--
-- この修正：
--   「本人が自分の行を更新するとき」に限り、下の 保護列 の変更を拒否する。
--   管理者・マスター管理者は、これまでどおりすべての列を更新できる。
--   サーバー側（service_role を使う Edge Function）も対象外。
--
-- 画面の動きは変わりません：
--   初回ログインの登録情報（氏名・ふりがな・生年月日・性別・連絡先・住所・
--   世帯・緊急連絡先・口座）はすべて保護列の外なので、これまでどおり保存できます。
--   パスワード変更後のフラグ（must_change_password / profile_setup_completed）も対象外です。
--   登録情報の変更申請は、管理者が承認したときに管理者の権限で書き込むため影響ありません。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run

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
    'wage_type', 'hourly_wage', 'monthly_salary',
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

notify pgrst, 'reload schema';

-- ============================================================
-- 確認（このSQLを実行したあとで試せます）
-- ============================================================
-- スタッフのアカウントでログインした状態で、ブラウザのコンソールから
--   await supabase.from('employees').update({ role: 'master_admin' }).eq('id', 自分のID)
-- を実行すると、error に
--   「ご自身では変更できない項目が含まれています（role）」
-- が返るようになります（修正前は成功していました）。
--
-- 管理者アカウントでのスタッフ情報の編集・時給の変更は、
-- これまでどおり成功します。
