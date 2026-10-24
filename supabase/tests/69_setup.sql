-- 69番の検証用の土台。本番のスキーマの一部だけを作る。
\set ON_ERROR_STOP on

drop schema if exists auth cascade;
create schema auth;

-- 誰として実行しているかを入れておく表（auth.uid() のスタブ）
drop table if exists public._who cascade;
create table public._who (id uuid);

create or replace function auth.uid() returns uuid
language sql stable as $$ select id from public._who limit 1 $$;

-- ---- employees（必要な列だけ）----
drop table if exists public.employees cascade;
create table public.employees (
  id uuid primary key,
  name text,
  role text not null,
  admin_permissions jsonb
);

insert into public.employees (id, name, role, admin_permissions) values
  ('00000000-0000-0000-0000-000000000001', 'マスター', 'master_admin', null),
  ('00000000-0000-0000-0000-000000000002', '管理者ぜんぶ', 'admin', '["attendance","labor","hr","payroll"]'),
  ('00000000-0000-0000-0000-000000000003', '管理者きんたいのみ', 'admin', '["attendance"]'),
  ('00000000-0000-0000-0000-000000000004', '管理者みせってい', 'admin', null),
  ('00000000-0000-0000-0000-000000000005', 'スタッフ', 'staff', null);

-- 役割を切り替えるための小道具
create or replace function public.be(which text) returns void
language plpgsql as $$
declare v uuid;
begin
  select id into v from public.employees
   where (which = 'master' and role = 'master_admin')
      or (which = 'admin_all'  and name = '管理者ぜんぶ')
      or (which = 'admin_att'  and name = '管理者きんたいのみ')
      or (which = 'admin_null' and name = '管理者みせってい')
      or (which = 'staff' and role = 'staff')
   limit 1;
  delete from public._who;
  if which <> 'anon' then insert into public._who values (v); end if;
end $$;

-- ---- 判定関数（本番と同じ定義）----
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.employees e
    where e.id = auth.uid() and e.role in ('admin', 'master_admin')
  );
$$;

create or replace function public.has_admin_tab(tab text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $func$
  select exists (
    select 1
      from public.employees e
     where e.id = auth.uid()
       and (
         e.role = 'master_admin'
         or (
           e.role = 'admin'
           and (
             e.admin_permissions is null
             or to_jsonb(e.admin_permissions) ? tab
           )
         )
       )
  );
$func$;

-- ---- announcements ----
drop table if exists public.announcements cascade;
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  body text,
  file_path text,
  file_name text,
  created_by uuid,
  created_by_name text,
  is_pinned boolean default false
);

-- ---- 61番が入れた通常ポリシー（現状の再現）----
alter table public.announcements enable row level security;

create policy "announcements admin delete" on public.announcements
  as permissive for delete to authenticated using (is_admin());
create policy "announcements admin insert" on public.announcements
  as permissive for insert to authenticated with check (is_admin());
create policy "announcements admin update" on public.announcements
  as permissive for update to authenticated using (is_admin()) with check (is_admin());
create policy "announcements select all authenticated" on public.announcements
  as permissive for select to authenticated using (true);

-- 検証用のロール（RLSを受ける側）
do $r$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated;
  end if;
end $r$;
do $r$ begin
  if not exists (select 1 from pg_roles where rolname='tester') then
    create role tester in role authenticated;
  end if;
end $r$;
grant usage on schema public, auth to tester, authenticated;
grant select, insert, update, delete on public.announcements to tester;
grant select, insert, delete on public._who to tester;
grant select on public.employees to tester;
grant execute on function public.be(text), auth.uid(),
  public.is_admin(), public.has_admin_tab(text) to tester;

-- ---- 合否を見る小道具 ----
create or replace function public.must_pass(label text, sql text) returns void
language plpgsql as $$
begin
  execute sql;
  raise notice '  OK   % （通るべきものが通った）', label;
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
    raise notice '  OK   % （拒まれるべきものが拒まれた）', label;
  when others then
    if sqlerrm like '%NG %' then raise; end if;
    raise notice '  OK   % （拒まれた: %）', label, sqlerrm;
end $$;

grant execute on function public.must_pass(text,text), public.must_fail(text,text) to tester;
-- 更新・削除は RLS が「行を絞る」ため、拒まれても例外にならず0件になる。
-- 件数で確かめるための小道具を足す。
create or replace function public.must_touch_none(label text, sql text) returns void
language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  if n = 0 then
    raise notice '  OK   % （0件。何も変わっていない）', label;
  else
    raise exception 'NG  % … %件に及んでしまった', label, n;
  end if;
end $$;

create or replace function public.must_touch_some(label text, sql text) returns void
language plpgsql as $$
declare n bigint;
begin
  execute sql;
  get diagnostics n = row_count;
  if n > 0 then
    raise notice '  OK   % （%件に及んだ）', label, n;
  else
    raise exception 'NG  % … 0件だった。通るはずが及ばなかった', label;
  end if;
end $$;

grant execute on function public.must_touch_none(text,text), public.must_touch_some(text,text) to tester;
