-- 95番の検証用の土台。
-- 01_schema.sql の corrections と guard_decision_fields、
-- 66番の重複ガードを、最小限の形で再現します。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;
drop table if exists public._who cascade;
create table public._who (id uuid);
create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

drop table if exists public.corrections cascade;
drop table if exists public.employees cascade;

create table public.employees (id uuid primary key, name text, role text not null);
insert into public.employees values
  ('00000000-0000-0000-0000-000000000001','マスター','master_admin'),
  ('00000000-0000-0000-0000-000000000002','管理者','admin'),
  ('00000000-0000-0000-0000-000000000005','スタッフ','employee'),
  ('00000000-0000-0000-0000-000000000006','別のスタッフ','employee');

-- だれとして操作するかを切り替える
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

-- 01_schema.sql の is_admin() と同じ役目
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e
    where e.id = auth.uid() and e.role in ('admin','master_admin')); $$;

-- 01_schema.sql の corrections（適用前の状態）
create table public.corrections (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  original jsonb,
  requested jsonb not null,
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  decided_at timestamptz
);

-- 01_schema.sql の共通ガード
create or replace function public.guard_decision_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  if new.status is distinct from old.status
     or new.decided_at is distinct from old.decided_at then
    raise exception '承認・却下は管理者のみ行えます';
  end if;
  return new;
end $$;

create trigger guard_corrections before update on public.corrections
  for each row execute function public.guard_decision_fields();

-- 66番の重複ガード（承認待ちの申請だけを見る）
create or replace function public.guard_correction_duplicate()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare existing_count integer;
begin
  select count(*) into existing_count
  from public.corrections c
  where c.employee_id = new.employee_id and c.date = new.date and c.status = 'pending';
  if existing_count > 0 then
    raise exception '% の勤怠修正申請はすでに送信済みです', to_char(new.date, 'YYYY年MM月DD日')
      using errcode = '23505';
  end if;
  return new;
end $$;

create trigger guard_correction_duplicate before insert on public.corrections
  for each row execute function public.guard_correction_duplicate();

-- ほかの申請の表も1つ置いて、95番の巻き添えが無いことを確かめられるようにする
drop table if exists public.leave_requests cascade;
create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decided_at timestamptz
);
create trigger guard_leave_requests before update on public.leave_requests
  for each row execute function public.guard_decision_fields();

-- ---- 検証に使う申請 ----
-- 承認待ちの申請は「同じ人・同じ日」に1件までのため、日付を分けています
insert into public.corrections (id, employee_id, date, original, requested, reason, status, decided_at) values
  ('cccccccc-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','2026-11-01',
   '{"clockIn":"2026-11-01T00:12:00.000Z"}'::jsonb, '{"clockIn":"09:00"}'::jsonb, '打刻忘れ', 'pending', null),
  ('cccccccc-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000005','2026-11-02',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'pending', null),
  ('cccccccc-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000005','2026-11-03',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'approved', now()),
  ('cccccccc-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000005','2026-11-04',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'rejected', now()),
  ('cccccccc-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000006','2026-11-05',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'pending', null),
  ('cccccccc-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000005','2026-11-06',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'pending', null),
  ('cccccccc-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000005','2026-11-07',
   null, '{"clockOut":"18:00"}'::jsonb, '退勤忘れ', 'pending', null);

insert into public.leave_requests (id, employee_id, status) values
  ('dddddddd-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','pending');

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='tester') then create role tester in role authenticated; end if;
end $r$;
grant usage on schema public, auth to tester, authenticated;
grant select, insert, update on public.corrections, public.leave_requests to authenticated;
grant select on public.employees to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid(), public.is_admin() to tester;

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
