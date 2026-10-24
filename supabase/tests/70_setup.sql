-- 70番の検証用の土台。69_setup.sql のあとに流す。
-- storage スキーマを、本番のポリシーと同じ形で作る。
\set ON_ERROR_STOP on

drop schema if exists storage cascade;
create schema storage;

create table storage.buckets (
  id text primary key,
  name text,
  public boolean default false
);
insert into storage.buckets (id, name, public) values
  ('announcements', 'announcements', false),
  ('somethingelse', 'somethingelse', false);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid
);

alter table storage.objects enable row level security;

-- ---- 現状のポリシー（ユーザーが貼ってくれた内容のとおり）----
create policy "announcement files admin insert" on storage.objects
  as permissive for insert to authenticated
  with check ((bucket_id = 'announcements'::text) and public.is_admin());

create policy "announcement files admin delete" on storage.objects
  as permissive for delete to authenticated
  using ((bucket_id = 'announcements'::text) and public.is_admin());

create policy "announcement files read authenticated" on storage.objects
  as permissive for select to authenticated
  using (bucket_id = 'announcements'::text);

grant usage on schema storage to tester, authenticated;
grant select, insert, update, delete on storage.objects to tester;
grant select on storage.buckets to tester;
