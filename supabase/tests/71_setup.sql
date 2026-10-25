-- 71番の検証用の土台。アプリの列対応表に合わせて employees を再現する。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;

drop table if exists public._who cascade;
create table public._who (id uuid);
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

drop view if exists public.employees_visible cascade;
drop table if exists public.employees cascade;
create table public.employees (
  id uuid primary key,
  username text not null unique,
  name text not null,
  role text not null default 'employee' check (role in ('employee','admin','master_admin')),
  admin_permissions jsonb,
  staff_number text,
  hire_date date,
  resignation_date date,
  contract_start date,
  contract_end date,
  staff_type text,
  main_group text,
  sub_group text,
  job_title text,
  commute_allowance numeric,
  nearest_station text,
  commute_claim_mode text,
  deemed_overtime_hours numeric,
  scheduled_weekly_days numeric,
  leave_adjustment numeric,
  staff_note1 text, staff_note2 text, staff_note3 text,
  must_change_password boolean default false,
  profile_setup_completed boolean default false,
  invited_at timestamptz,
  created_at timestamptz not null default now(),
  -- ここから下は隠す対象
  postal_code text, address text, resident_address text,
  householder_name text, householder_relation text,
  birth_date date, gender text, phone text, contact_email text,
  emergency_contact_name text, emergency_contact_furigana text,
  emergency_contact_relation text, emergency_contact_phone text,
  emergency_contact_address text,
  wage_type text, hourly_wage numeric, monthly_salary numeric,
  bank_code text, bank_name text, branch_code text, branch_name text,
  account_type text, account_holder text, account_number text,
  health_insurance_status text, health_insurance_number text,
  health_insurance_acquired_date date, health_insurance_lost_date date,
  pension_status text, pension_basic_number text,
  pension_acquired_date date, pension_lost_date date,
  employment_insurance_status text, employment_insurance_number text,
  employment_insurance_acquired_date date, employment_insurance_lost_date date,
  standard_remuneration_health numeric, standard_remuneration_pension numeric,
  spouse_status text, spouse_annual_income numeric, spouse_monthly_income numeric,
  family_members jsonb,
  resident_tax_municipality_code text, resident_tax_municipality text,
  resident_tax_collection_method text,
  tax_table_type text, is_non_resident boolean,
  disability_classification text, is_working_student boolean,
  single_parent_classification text
);

update public.employees set commute_allowance=4200, nearest_station='亀岡' where true;
insert into public.employees
  (id, username, name, role, admin_permissions, main_group,
   address, birth_date, phone, hourly_wage, account_number, bank_name,
   health_insurance_number, family_members, resident_tax_municipality)
values
  ('00000000-0000-0000-0000-000000000001','master@x','マスター','master_admin',null,'本社',
   '京都府亀岡市1-1','1980-01-01','090-0000-0001',2000,'1234567','京都銀行',
   'H-001','[{"name":"子"}]','亀岡市'),
  ('00000000-0000-0000-0000-000000000002','admin@x','管理者ぜんぶ','admin','["attendance","labor","hr","payroll"]','本社',
   '京都府亀岡市2-2','1985-02-02','090-0000-0002',1800,'2345678','京都銀行',
   'H-002','[{"name":"妻"}]','亀岡市'),
  ('00000000-0000-0000-0000-000000000003','admin2@x','管理者きんたいのみ','admin','["attendance"]','本社',
   '京都府亀岡市3-3','1990-03-03','090-0000-0003',1700,'3456789','京都銀行',
   'H-003','[]','亀岡市'),
  ('00000000-0000-0000-0000-000000000005','staff@x','スタッフ','employee',null,'店舗A',
   '京都府亀岡市5-5','1995-05-05','090-0000-0005',1200,'5678901','京都銀行',
   'H-005','[]','亀岡市');

create or replace function public.be(which text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.employees
   where (which='master' and role='master_admin')
      or (which='admin_all'  and name='管理者ぜんぶ')
      or (which='admin_att'  and name='管理者きんたいのみ')
      or (which='staff' and role='employee')
   limit 1;
  delete from public._who;
  if which <> 'server' then insert into public._who values (v); end if;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id = auth.uid() and e.role in ('admin','master_admin'));
$$;

create or replace function public.is_master_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id = auth.uid() and e.role = 'master_admin');
$$;

-- 45番相当のガード（スタッフだけを止める。管理者は素通り）
create or replace function public.guard_employee_self_update()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $g$
declare caller uuid := auth.uid(); caller_role text;
begin
  if caller is null then return new; end if;
  select e.role into caller_role from public.employees e where e.id = caller;
  if caller_role in ('admin','master_admin') then return new; end if;
  if caller is distinct from new.id then
    raise exception '他のスタッフの情報は変更できません' using errcode='42501';
  end if;
  if new.role is distinct from old.role then
    raise exception 'ご自身では変更できない項目が含まれています（role）' using errcode='42501';
  end if;
  return new;
end $g$;
drop trigger if exists guard_employee_self_update on public.employees;
create trigger guard_employee_self_update before update on public.employees
  for each row execute function public.guard_employee_self_update();

alter table public.employees enable row level security;

-- 修正前の状態（is_admin なら他人の行も全部読める）
create policy "employees select own or admin" on public.employees
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "employees update own or admin" on public.employees
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname='tester') then
    create role tester in role authenticated;
  end if;
end $r$;

grant usage on schema public, auth to tester, authenticated;
-- 本番と同じく authenticated 経由で権限を持たせる（tester に直接与えない）
grant select, update on public.employees to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid(),
  public.is_admin(), public.is_master_admin() to tester;

-- 合否の小道具
create or replace function public.must_pass(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise notice '  OK   %', label;
exception when others then
  raise exception 'NG  % … 通るはずが拒まれた: %', label, sqlerrm;
end $$;

create or replace function public.must_fail(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'NG  % … 拒まれるはずが通ってしまった', label;
exception
  when insufficient_privilege or check_violation then
    raise notice '  OK   % （拒まれた）', label;
  when others then
    if sqlerrm like 'NG %' then raise; end if;
    raise notice '  OK   % （拒まれた: %）', label, sqlerrm;
end $$;

-- 値が見えているか／伏せられているかを確かめる
create or replace function public.expect_value(label text, sql text, want text) returns void
language plpgsql as $$
declare got text;
begin
  execute sql into got;
  if got is not distinct from want then
    raise notice '  OK   % （% ）', label, coalesce(got,'null');
  else
    raise exception 'NG  % … 期待 % だが実際は %', label, coalesce(want,'null'), coalesce(got,'null');
  end if;
end $$;

grant execute on function public.must_pass(text,text), public.must_fail(text,text),
  public.expect_value(text,text,text) to tester;
