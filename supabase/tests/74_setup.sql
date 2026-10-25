-- 74番の検証用の土台。51番のガードをそのまま再現する。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;
drop table if exists public._who cascade;
create table public._who (id uuid);
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

drop table if exists public.commute_expense_claims cascade;
drop table if exists public.monthly_attendance_confirmations cascade;
drop table if exists public.employees cascade;

create table public.employees (id uuid primary key, name text, role text not null);
insert into public.employees values
  ('00000000-0000-0000-0000-000000000001','マスター','master_admin'),
  ('00000000-0000-0000-0000-000000000002','管理者','admin'),
  ('00000000-0000-0000-0000-000000000005','スタッフ','employee'),
  ('00000000-0000-0000-0000-000000000006','別のスタッフ','employee');

create or replace function public.be(which text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.employees
   where (which='master' and role='master_admin')
      or (which='admin' and name='管理者')
      or (which='staff' and name='スタッフ')
      or (which='other' and name='別のスタッフ') limit 1;
  delete from public._who;
  if which <> 'server' then insert into public._who values (v); end if;
end $$;

create or replace function public.caller_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id = auth.uid() and e.role in ('admin','master_admin')); $$;

create table public.commute_expense_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  submitted_date date not null default current_date,
  items jsonb not null default '[]'::jsonb,
  total_amount numeric not null default 0,
  status text not null default 'pending',
  admin_comment text,
  decided_at timestamptz
);

create table public.monthly_attendance_confirmations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  target_month text,
  status text not null default 'pending',
  summary jsonb,
  staff_note text,
  admin_comment text, admin_decided_by uuid, admin_decided_at timestamptz,
  master_comment text, master_decided_by uuid, master_decided_at timestamptz
);

-- 差し戻し済みの申請（出し直したいもの）
insert into public.commute_expense_claims (id, employee_id, status, admin_comment, decided_at, total_amount)
values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
        'rejected','金額を確認してください', now(), 660);
-- 他人が触れないことを確かめるための、手つかずの差し戻し行
insert into public.commute_expense_claims (id, employee_id, status, admin_comment, decided_at, total_amount)
values ('aaaaaaaa-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000005',
        'rejected','確認してください', now(), 500);
-- 承認済みの申請（戻せてはいけないもの）
insert into public.commute_expense_claims (id, employee_id, status, decided_at, total_amount)
values ('aaaaaaaa-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005',
        'approved', now(), 1000);

insert into public.monthly_attendance_confirmations (id, employee_id, target_month, status, admin_comment, admin_decided_at)
values ('bbbbbbbb-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005',
        '2026-09','rejected','打刻漏れがあります', now());
insert into public.monthly_attendance_confirmations (id, employee_id, target_month, status)
values ('bbbbbbbb-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005',
        '2026-08','confirmed');

-- ---- 51番のガード（修正前の状態）----
create or replace function public.guard_commute_claim_decision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $func$
begin
  if auth.uid() is null or public.caller_is_admin() then return new; end if;
  if new.employee_id is distinct from old.employee_id then
    raise exception '申請者は変更できません' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at
     or new.admin_comment is distinct from old.admin_comment then
    raise exception '承認・却下は管理者のみ行えます' using errcode = '42501';
  end if;
  return new;
end; $func$;
drop trigger if exists guard_commute_claim_decision on public.commute_expense_claims;
create trigger guard_commute_claim_decision before update on public.commute_expense_claims
  for each row execute function public.guard_commute_claim_decision();

create or replace function public.guard_monthly_confirm_decision()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $func$
begin
  if auth.uid() is null or public.caller_is_admin() then return new; end if;
  if new.employee_id is distinct from old.employee_id
     or new.target_month is distinct from old.target_month then
    raise exception '申請者と対象月は変更できません' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     or new.admin_comment is distinct from old.admin_comment
     or new.admin_decided_by is distinct from old.admin_decided_by
     or new.admin_decided_at is distinct from old.admin_decided_at
     or new.master_comment is distinct from old.master_comment
     or new.master_decided_by is distinct from old.master_decided_by
     or new.master_decided_at is distinct from old.master_decided_at then
    raise exception '承認・却下は管理者のみ行えます' using errcode = '42501';
  end if;
  return new;
end; $func$;
drop trigger if exists guard_monthly_confirm_decision on public.monthly_attendance_confirmations;
create trigger guard_monthly_confirm_decision before update on public.monthly_attendance_confirmations
  for each row execute function public.guard_monthly_confirm_decision();

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='tester') then create role tester in role authenticated; end if;
end $r$;
grant usage on schema public, auth to tester, authenticated;
grant select, update on public.commute_expense_claims, public.monthly_attendance_confirmations to authenticated;
grant select on public.employees to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid(), public.caller_is_admin() to tester;

create or replace function public.must_pass(label text, sql text) returns void
language plpgsql as $$
begin execute sql; raise notice '  OK   %', label;
exception when others then raise exception 'NG  % … 通るはずが拒まれた: %', label, sqlerrm; end $$;

create or replace function public.must_fail(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise exception 'NG  % … 拒まれるはずが通ってしまった', label;
exception
  when insufficient_privilege then raise notice '  OK   % （拒まれた）', label;
  when others then
    if sqlerrm like 'NG %' then raise; end if;
    raise notice '  OK   % （拒まれた: %）', label, sqlerrm;
end $$;

grant execute on function public.must_pass(text,text), public.must_fail(text,text) to tester;
