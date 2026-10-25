-- 72番の検証用の土台。本番の payroll_records のポリシーを再現する。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;
drop table if exists public._who cascade;
create table public._who (id uuid);
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

drop table if exists public.payroll_records cascade;
drop table if exists public.bonus_records cascade;
drop table if exists public.commute_expense_claims cascade;
drop table if exists public.employees cascade;

create table public.employees (
  id uuid primary key, name text, role text not null, admin_permissions jsonb
);
insert into public.employees values
  ('00000000-0000-0000-0000-000000000001','マスター','master_admin',null),
  ('00000000-0000-0000-0000-000000000002','管理者きゅうよ','admin','["attendance","payroll"]'),
  ('00000000-0000-0000-0000-000000000003','管理者きんたい','admin','["attendance"]'),
  ('00000000-0000-0000-0000-000000000005','スタッフ','employee',null);

create or replace function public.be(which text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.employees
   where (which='master' and role='master_admin')
      or (which='admin_pay' and name='管理者きゅうよ')
      or (which='admin_att' and name='管理者きんたい')
      or (which='staff' and role='employee') limit 1;
  delete from public._who;
  if which <> 'server' then insert into public._who values (v); end if;
end $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id=auth.uid() and e.role in ('admin','master_admin')); $$;

create or replace function public.is_master_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id=auth.uid() and e.role='master_admin'); $$;

create or replace function public.has_admin_tab(tab text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.employees e
    where e.id=auth.uid() and (e.role='master_admin'
      or (e.role='admin' and (e.admin_permissions is null
          or to_jsonb(e.admin_permissions) ? tab)))); $$;

-- 2段階認証は通っている前提にする（今回の論点ではないため）
create or replace function public.mfa_ok() returns boolean
language sql stable as $$ select true $$;

create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  year int, month int, status text default 'draft', total numeric
);
create table public.bonus_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  year int, status text default 'draft', total numeric
);
create table public.commute_expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  target_month text, amount numeric
);

insert into public.payroll_records (employee_id, year, month, status, total) values
  ('00000000-0000-0000-0000-000000000005',2026,9,'published',250000),
  ('00000000-0000-0000-0000-000000000005',2026,10,'draft',260000),
  ('00000000-0000-0000-0000-000000000002',2026,9,'published',300000);
insert into public.bonus_records (employee_id, year, status, total) values
  ('00000000-0000-0000-0000-000000000005',2026,'published',100000);
insert into public.commute_expense_claims (employee_id, target_month, amount) values
  ('00000000-0000-0000-0000-000000000005','2026-09',4200);

alter table public.payroll_records enable row level security;
alter table public.bonus_records enable row level security;
alter table public.commute_expense_claims enable row level security;

-- 61番が入れている現状のポリシー
create policy "mfa required" on public.payroll_records
  as restrictive for all to authenticated using (mfa_ok()) with check (mfa_ok());
create policy "payroll tab required" on public.payroll_records
  as restrictive for all to authenticated
  using ((employee_id = auth.uid()) or has_admin_tab('payroll'))
  with check ((employee_id = auth.uid()) or has_admin_tab('payroll'));
create policy "payroll admin insert" on public.payroll_records
  as permissive for insert to authenticated with check (is_admin());
create policy "payroll admin update" on public.payroll_records
  as permissive for update to authenticated using (is_admin()) with check (is_admin());
create policy "payroll select own published or admin" on public.payroll_records
  as permissive for select to authenticated
  using (((employee_id = auth.uid()) and (status='published')) or is_admin());

create policy "bonus tab required" on public.bonus_records
  as restrictive for all to authenticated
  using ((employee_id = auth.uid()) or has_admin_tab('payroll'))
  with check ((employee_id = auth.uid()) or has_admin_tab('payroll'));
create policy "bonus select own published or admin" on public.bonus_records
  as permissive for select to authenticated
  using (((employee_id = auth.uid()) and (status='published')) or is_admin());

create policy "commute tab required" on public.commute_expense_claims
  as restrictive for all to authenticated
  using ((employee_id = auth.uid()) or has_admin_tab('payroll'))
  with check ((employee_id = auth.uid()) or has_admin_tab('payroll'));
create policy "commute select own or admin" on public.commute_expense_claims
  as permissive for select to authenticated
  using ((employee_id = auth.uid()) or is_admin());

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='tester') then create role tester in role authenticated; end if;
end $r$;

grant usage on schema public, auth to tester, authenticated;
grant select, insert, update, delete on
  public.payroll_records, public.bonus_records, public.commute_expense_claims to authenticated;
grant select on public.employees to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid(), public.is_admin(),
  public.is_master_admin(), public.has_admin_tab(text), public.mfa_ok() to tester;

create or replace function public.expect_count(label text, sql text, want bigint) returns void
language plpgsql as $$
declare got bigint;
begin
  execute sql into got;
  if got = want then
    raise notice '  OK   % （%件）', label, got;
  else
    raise exception 'NG  % … 期待 %件 だが実際は %件', label, want, got;
  end if;
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

create or replace function public.must_pass(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise notice '  OK   %', label;
exception when others then
  raise exception 'NG  % … 通るはずが拒まれた: %', label, sqlerrm;
end $$;

grant execute on function public.expect_count(text,text,bigint),
  public.must_fail(text,text), public.must_pass(text,text) to tester;
