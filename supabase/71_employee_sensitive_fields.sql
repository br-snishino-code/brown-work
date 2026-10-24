-- 71_employee_sensitive_fields.sql
--
-- 【権限の修正】スタッフの個人情報を、本人とマスター管理者だけに限る
--
-- 経緯：
--   employees の閲覧ポリシーは "id = auth.uid() or is_admin()" で、
--   PostgreSQL の行単位セキュリティは「列」を選べない。
--   そのため管理者は他人の行の全列を読めていた。住所・生年月日・性別・
--   電話・緊急連絡先・口座情報・健康保険番号・年金基礎番号・雇用保険番号・
--   配偶者の収入・家族構成・住民税の市区町村・障害区分・賃金まで含まれる。
--
-- 採らなかったやり方：
--   閲覧ポリシーを「本人またはマスター管理者」に絞る方法は使えない。
--   PostgreSQL は UPDATE のときにも SELECT ポリシーを適用するため、
--   管理者が他人の行を一切更新できなくなり、所属グループやスタッフメモの
--   編集まで止まる（検証で確認済み）。
--
-- この修正（3つで1組。どれか欠けると意味がない）：
--   ① 基の表の「列」の権限を絞る
--      employees への表単位の SELECT 権限を外し、隠さない列だけに
--      列単位で与え直す。これで誰も基の表から隠す列を読めなくなる。
--      行の見え方（ポリシー）は変えないので、更新は従来どおり動く。
--   ② employees_visible ビューを作る
--      読み取りはすべてこのビュー経由にする。行は従来どおり管理者にも
--      見えるが、隠す列は本人とマスター管理者以外には null で返る。
--      画面では空欄になる。
--   ③ 更新を止めるトリガー
--      本人とマスター管理者以外が隠す列を書き換えようとしたら拒む。
--
-- 壊れないことの確認：
--   ・氏名・所属・雇用形態などは従来どおり全管理者に見えるため、
--     勤怠一覧・シフト・承認の画面は影響を受けない。
--   ・隠す列は計算に使われていない（社会保険料・所得税は手入力のため）。
--     給与計算は従来どおり動く。
--   ・管理者による所属グループ・スタッフメモ・契約期間などの編集は
--     従来どおりできる。
--   ・Edge Function は service_role で動き auth.uid() が null になるため、
--     ③ のトリガーは素通りする（アカウント作成などが止まらないように）。
--
-- アプリ側で必要な対応（このSQLだけでは足りない）：
--   employees を読んでいる3か所を employees_visible に差し替える。
--   差し替えないと、隠す列が読めずに画面が動かなくなる。
--
-- 前提：
--   01_schema.sql（is_admin / is_master_admin）が適用済みであること
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- ※ あとで employees に列を足したときは、このSQLをもう一度流して
--   ビューと列の権限を作り直してください。


begin;

-- ------------------------------------------------------------
-- 判定用の関数
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


-- ------------------------------------------------------------
-- 行のポリシーは従来どおりに保つ（更新を壊さないため）
-- ------------------------------------------------------------
drop policy if exists "employees select own or master" on public.employees;
drop policy if exists "employees select own or admin" on public.employees;
create policy "employees select own or admin" on public.employees
  for select to authenticated
  using (id = auth.uid() or public.is_admin());


-- ------------------------------------------------------------
-- ① 列の権限を絞る ＋ ② ビューを作る
--   実際に存在する列を見て組み立てるので、列の増減があっても
--   このSQLを流し直せば追従する。
-- ------------------------------------------------------------
do $do$
declare
  -- 本人とマスター管理者だけに見せる列
  sensitive text[] := array[
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

  -- ② ビュー（作成者の権限で動くため、行の絞り込みはビュー自身の where で行う）
  execute format(
    'create or replace view public.employees_visible as select %s from public.employees e '
    || 'where e.id = auth.uid() or public.is_admin()',
    array_to_string(parts, ', '));
  execute 'alter view public.employees_visible set (security_invoker = false)';
  execute 'grant select on public.employees_visible to authenticated';

  -- ① 基の表：表単位の SELECT を外し、隠さない列だけ与え直す
  execute 'revoke select on public.employees from authenticated';
  execute format('grant select (%s) on public.employees to authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(shown) c));
  -- 更新は従来どおり全列に許す（誰が何を変えられるかは ③ のトリガーで決める）
  execute 'grant update on public.employees to authenticated';

  select array_agg(s) into missing
    from unnest(sensitive) s where s <> all(hidden);

  raise notice '隠した列：%件', coalesce(array_length(hidden, 1), 0);
  raise notice '見せる列：%件 … %', coalesce(array_length(shown, 1), 0), array_to_string(shown, ', ');
  if missing is not null then
    raise notice '※ 表に無かったため読み飛ばした指定：%', array_to_string(missing, ', ');
  end if;
end $do$;


-- ------------------------------------------------------------
-- ③ 隠す列の書き換えを止めるトリガー
--   本人とマスター管理者は従来どおり変更できる。
--   service_role（Edge Function）は auth.uid() が null のため素通りする。
-- ------------------------------------------------------------
create or replace function public.guard_employee_sensitive_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sensitive text[] := array[
    'postal_code', 'address', 'resident_address',
    'householder_name', 'householder_relation',
    'birth_date', 'gender', 'phone', 'contact_email',
    'emergency_contact_name', 'emergency_contact_furigana',
    'emergency_contact_relation', 'emergency_contact_phone',
    'emergency_contact_address',
    'wage_type', 'hourly_wage', 'monthly_salary',
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
  c text;
  before_js jsonb := to_jsonb(old);
  after_js  jsonb := to_jsonb(new);
begin
  if auth.uid() is null then
    return new;                                  -- サーバー側の処理は通す
  end if;
  if new.id = auth.uid() or public.is_master_admin() then
    return new;                                  -- 本人とマスター管理者は通す
  end if;
  foreach c in array sensitive loop
    if (before_js ? c) and (before_js -> c) is distinct from (after_js -> c) then
      raise exception
        'この項目を変更できるのは、ご本人とマスター管理者だけです（%）', c
        using errcode = 'insufficient_privilege';
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists guard_employee_sensitive_update on public.employees;
create trigger guard_employee_sensitive_update
  before update on public.employees
  for each row execute function public.guard_employee_sensitive_update();

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
-- (1) ビューとトリガーができていること（どちらも 1 なら成功）
select
  (select count(*) from information_schema.views
    where table_schema='public' and table_name='employees_visible') as "ビュー",
  (select count(*) from pg_trigger
    where tgname='guard_employee_sensitive_update' and not tgisinternal) as "トリガー";

-- (2) 基の表から隠した列が読めなくなっていること（0件なら成功）
select count(*) as "基の表で読める隠し列の数（0なら成功）"
from information_schema.column_privileges
where table_schema='public' and table_name='employees'
  and grantee='authenticated' and privilege_type='SELECT'
  and column_name in ('address','account_number','birth_date','hourly_wage',
                      'health_insurance_number','family_members');
