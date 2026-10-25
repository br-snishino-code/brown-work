-- 78番の検証用の土台。修正前の状態（61番のポリシーそのまま）を再現する。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;

drop table if exists public._who cascade;
create table public._who (id uuid);
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

drop table if exists public.year_end_adjustments cascade;
drop table if exists public.employee_attendance_schedules cascade;
drop table if exists public.employees cascade;

create table public.employees (
  id uuid primary key, name text not null, role text not null
);
insert into public.employees values
  ('00000000-0000-0000-0000-000000000001','マスター','master_admin'),
  ('00000000-0000-0000-0000-000000000002','管理者','admin'),
  ('00000000-0000-0000-0000-000000000005','スタッフA','employee'),
  ('00000000-0000-0000-0000-000000000006','スタッフB','employee');

create or replace function public.be(which text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.employees
   where (which='master' and role='master_admin')
      or (which='admin'  and role='admin')
      or (which='A' and name='スタッフA')
      or (which='B' and name='スタッフB')
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

-- 年末調整（60番の列構成のうち、機微なものを再現）
create table public.year_end_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  status text not null default 'pending',
  spouse_income numeric,
  life_insurance numeric,
  earthquake_insurance numeric,
  housing_loan_deduction numeric,
  dependents int,
  unique (employee_id, year)
);
insert into public.year_end_adjustments
  (id, employee_id, year, status, spouse_income, life_insurance, housing_loan_deduction, dependents)
values
  ('11111111-0000-0000-0000-00000000000A','00000000-0000-0000-0000-000000000005',2026,'pending',1030000,80000,200000,2),
  ('11111111-0000-0000-0000-00000000000B','00000000-0000-0000-0000-000000000006',2026,'pending',0,40000,0,0);

-- スタッフ個別の出勤規定日数
create table public.employee_attendance_schedules (
  employee_id uuid not null references public.employees(id) on delete cascade,
  year int not null,
  month int not null,
  days numeric not null,
  primary key (employee_id, year, month)
);
insert into public.employee_attendance_schedules values
  ('00000000-0000-0000-0000-000000000005',2026,10,20),
  ('00000000-0000-0000-0000-000000000006',2026,10,15);

alter table public.employees enable row level security;
alter table public.year_end_adjustments enable row level security;
alter table public.employee_attendance_schedules enable row level security;

create policy "employees select" on public.employees
  for select to authenticated using (id = auth.uid() or public.is_admin());

-- ===== ここから下が「修正前」の状態（61番のまま）=====
create policy "year_end_adjustments_select" on public.year_end_adjustments
  for select to authenticated
  using (employee_id = auth.uid() or public.is_admin());
create policy "year_end_adjustments_insert" on public.year_end_adjustments
  for insert to authenticated
  with check (employee_id = auth.uid() or public.is_admin());
create policy "year_end_adjustments_update" on public.year_end_adjustments
  for update to authenticated
  using (employee_id = auth.uid() or public.is_admin())
  with check (employee_id = auth.uid() or public.is_admin());

create policy "employee_attendance_schedules_select" on public.employee_attendance_schedules
  for select to authenticated using (true);
create policy "employee_attendance_schedules_insert" on public.employee_attendance_schedules
  for insert to authenticated with check (public.is_admin());
create policy "employee_attendance_schedules_update" on public.employee_attendance_schedules
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname='tester') then
    create role tester in role authenticated;
  end if;
end $r$;

grant usage on schema public, auth to tester, authenticated;
grant select on public.employees to authenticated;
grant select, insert, update, delete on public.year_end_adjustments to authenticated;
grant select, insert, update, delete on public.employee_attendance_schedules to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid(),
  public.is_admin(), public.is_master_admin() to tester;

-- 合否の小道具
create or replace function public.expect_count(label text, sql text, want bigint) returns void
language plpgsql as $$
declare got bigint;
begin
  execute sql into got;
  if got = want then raise notice '  OK   % （%件）', label, got;
  else raise exception 'NG  % … 期待 %件 だが実際は %件', label, want, got;
  end if;
end $$;

create or replace function public.must_pass(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise notice '  OK   %', label;
exception when others then
  raise exception 'NG  % … 通るはずが拒まれた: %', label, sqlerrm;
end $$;

create or replace function public.must_touch_none(label text, sql text) returns void
language plpgsql as $$
declare n int;
begin
  execute sql; get diagnostics n = row_count;
  if n = 0 then raise notice '  OK   % （0件＝届いていない）', label;
  else raise exception 'NG  % … %件に届いてしまった', label, n;
  end if;
exception
  when insufficient_privilege or check_violation then
    raise notice '  OK   % （拒まれた）', label;
  when others then
    if sqlerrm like 'NG %' then raise; end if;
    raise notice '  OK   % （拒まれた: %）', label, sqlerrm;
end $$;

grant execute on function public.expect_count(text,text,bigint),
  public.must_pass(text,text), public.must_touch_none(text,text) to tester;
