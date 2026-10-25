\set ON_ERROR_STOP on
drop schema if exists auth cascade; create schema auth;
drop table if exists public._who cascade; create table public._who (id uuid);
create or replace function auth.uid() returns uuid language sql stable as $$ select id from public._who limit 1 $$;

drop table if exists public.shift_request_answers cascade;
drop table if exists public.employees cascade;
create table public.employees (id uuid primary key, name text, role text not null);
insert into public.employees values
  ('00000000-0000-0000-0000-000000000002','管理者','admin'),
  ('00000000-0000-0000-0000-000000000005','スタッフA','employee'),
  ('00000000-0000-0000-0000-000000000006','スタッフB','employee');

create or replace function public.be(which text) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid; begin
  select id into v from public.employees
   where (which='admin' and role='admin') or (which='A' and name='スタッフA') or (which='B' and name='スタッフB') limit 1;
  delete from public._who; if which<>'server' then insert into public._who values (v); end if;
end $$;

create table public.shift_request_answers (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  target_month text not null,
  answers jsonb not null default '{}'::jsonb,
  note text,
  submitted_at timestamptz not null default now(),
  unique (employee_id, target_month)
);
insert into public.shift_request_answers (id, employee_id, target_month, answers, note) values
  ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','2026-11','{"2026-11-01":"ok"}','Aの希望'),
  ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000006','2026-12','{"2026-12-01":"ok"}','Bの希望');

alter table public.shift_request_answers enable row level security;
-- 37番の現状のポリシー
create policy "shift answer select" on public.shift_request_answers for select to authenticated
  using (employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id=auth.uid() and e.role in ('admin','master_admin')));
create policy "shift answer update" on public.shift_request_answers for update to authenticated
  using (employee_id = auth.uid()
    or exists (select 1 from public.employees e where e.id=auth.uid() and e.role in ('admin','master_admin')))
  with check (true);

do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='tester') then create role tester in role authenticated; end if;
end $r$;
grant usage on schema public, auth to tester, authenticated;
grant select, update on public.shift_request_answers to authenticated;
grant select on public.employees to authenticated;
grant select, insert, delete on public._who to tester;
grant execute on function public.be(text), auth.uid() to tester;
