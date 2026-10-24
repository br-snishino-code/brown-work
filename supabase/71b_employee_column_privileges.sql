-- 71b_employee_column_privileges.sql
--
-- 【2/2】スタッフの個人情報を本人とマスター管理者だけに限る ― 後半
--
-- 前半（71a）でビューを作り、アプリの読み取りをビュー経由に切り替えたあと、
-- データベース側でも隠す列を読めなくする。
--
-- 必ずこの順で：
--   ① 71a_employee_visible_view.sql を流す
--   ② アプリをデプロイする（読み取りが employees_visible 経由になる）
--   ③ このSQL（71b）を流す
--
--   ②より先にこれを流すと、古いアプリが employees を select * で読んで
--   「権限がありません」で止まる。
--
-- 入れるもの：
--   ① 列の権限
--      employees への表単位の SELECT 権限を外し、隠さない列だけに
--      列単位で与え直す。これで誰も基の表から隠す列を読めなくなる。
--      行のポリシーは変えないので、管理者による所属グループ・スタッフメモ・
--      契約期間などの編集は従来どおり動く。
--   ② 更新を止めるトリガー
--      本人とマスター管理者以外が隠す列を書き換えようとしたら拒む。
--
-- 採らなかったやり方：
--   閲覧ポリシーを「本人またはマスター管理者」に絞る方法は使えない。
--   PostgreSQL は UPDATE のときにも SELECT ポリシーを適用するため、
--   管理者が他人の行を一切更新できなくなる（検証で確認済み）。
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- 元に戻したいときは、このファイルの末尾のコメントを参照。


begin;

-- ------------------------------------------------------------
-- 前提の確認（足りなければここで止まり、すべて巻き戻る）
-- ------------------------------------------------------------
do $do$
begin
  if to_regprocedure('public.employee_sensitive_columns()') is null then
    raise exception '先に 71a_employee_visible_view.sql を適用してください';
  end if;
  if to_regclass('public.employees_visible') is null then
    raise exception 'public.employees_visible がありません。先に 71a を適用してください';
  end if;
end $do$;


-- ------------------------------------------------------------
-- 行のポリシーは従来どおりに保つ（更新を壊さないため）
-- ------------------------------------------------------------
drop policy if exists "employees select own or master" on public.employees;
drop policy if exists "employees select own or admin" on public.employees;
create policy "employees select own or admin" on public.employees
  for select to authenticated
  using (id = auth.uid() or public.is_admin());


-- ------------------------------------------------------------
-- ① 列の権限を絞る
-- ------------------------------------------------------------
do $do$
declare
  sensitive text[] := public.employee_sensitive_columns();
  shown text[];
begin
  select array_agg(column_name order by ordinal_position) into shown
    from information_schema.columns
   where table_schema = 'public' and table_name = 'employees'
     and column_name <> all(sensitive);

  if shown is null then
    raise exception '見せる列がありません。隠す列の指定を確認してください';
  end if;

  -- 表単位の SELECT を外し、隠さない列だけ与え直す
  execute 'revoke select on public.employees from authenticated';
  execute format('grant select (%s) on public.employees to authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(shown) c));
  -- 更新は従来どおり全列に許す（誰が何を変えられるかは ② のトリガーで決める）
  execute 'grant update on public.employees to authenticated';

  raise notice '基の表から読める列：%件', array_length(shown, 1);
end $do$;


-- ------------------------------------------------------------
-- ② 隠す列の書き換えを止めるトリガー
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
  sensitive text[] := public.employee_sensitive_columns();
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
-- (1) トリガーができていること（1なら成功）
select count(*) as "トリガー（1なら成功）"
from pg_trigger where tgname = 'guard_employee_sensitive_update' and not tgisinternal;

-- (2) 基の表から隠した列が読めなくなっていること（0なら成功）
select count(*) as "基の表で読める隠し列の数（0なら成功）"
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'employees'
  and grantee = 'authenticated' and privilege_type = 'SELECT'
  and column_name = any(public.employee_sensitive_columns());


-- ------------------------------------------------------------
-- 元に戻したいとき（この3行を SQL Editor で流す）
-- ------------------------------------------------------------
--   drop trigger if exists guard_employee_sensitive_update on public.employees;
--   revoke select on public.employees from authenticated;
--   grant select on public.employees to authenticated;
--
--   これで基の表は元どおり全列読めるようになる。
--   アプリはビュー経由のままでも動く（ビューは残しておいてよい）。
