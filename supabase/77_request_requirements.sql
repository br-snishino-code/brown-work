-- 77_request_requirements.sql
--
-- 【機能の追加】シフト希望・実績入力・交通費申請を、スタッフごとに「申請不要」にできるようにする
--
-- 経緯：
--   スタッフによっては、シフト希望を出さない方、実績を入力しない方、
--   交通費を申請しない方がいる。これまでは
--     ・実績入力  … グループごとに「使わない」を選べた（group_formats）
--     ・シフト希望 … 同じくグループごとに「使わない」を選べた
--     ・交通費申請 … 全員が対象で、外す仕組みが無かった
--   という状態で、どれも「この人だけ外す」ことができなかった。
--
-- この修正：
--   employees に3列足して、グループの既定に対する「個人の例外」を持たせる。
--
--     shift_request_requirement    シフト希望
--     performance_requirement      実績入力
--     commute_claim_requirement    交通費申請
--
--   どれも次の3つの値をとる。
--     null       … グループの既定に従う（これまでどおり。既存のスタッフは全員これ）
--     'exempt'   … この方には出さない（グループが使う設定でも出さない）
--     'required' … この方には出す（グループが使わない設定でも出す）
--
--   グループの既定はアプリ側の app_settings（group_formats）にあり、
--   交通費申請の既定もそこへ足す。この SQL は個人の例外だけを扱う。
--
--   既存のスタッフは全員 null で入るため、この SQL を流しただけでは
--   誰の画面も変わらない。
--
-- 変更できるのはマスター管理者だけ：
--   73a と同じ形のトリガーで守る。管理者は見えるが変えられない。
--   「なぜこの人にシフト希望が出ないのか」を管理者が確認できるよう、
--   閲覧は管理者にも許す（個人情報の隠し列には入れない）。
--
--   スタッフ本人も変えられない。45番の列ガードには足していないが、
--   このトリガーがマスター管理者以外をすべて拒むため、本人も止まる。
--
-- ビューと列の権限を作り直す：
--   71a で employees_visible を employees の列から組み立てているため、
--   列を足したらビューを作り直さないと、新しい3列がアプリから読めない。
--   71b の列単位 SELECT 権限も同じ理由で作り直す。
--   下の do ブロックは 73b と同じ組み立て方で、隠す列の一覧
--   （employee_sensitive_columns）は変えない。
--
-- 前提：
--   71a_employee_visible_view.sql / 71b_employee_column_privileges.sql /
--   73b_hide_commute_allowance.sql が適用済みであること
--
-- 流す順番：
--   この SQL を先に流し、そのあとアプリをデプロイしてください。
--   先に流しても、新しい3列は全員 null のため画面は変わりません。
--   （逆の順番にすると、新しいアプリが employees_visible に無い列を
--     読もうとして、スタッフ情報の画面が出なくなります）
--
-- 実行方法：Supabase → SQL Editor に貼り付けて Run
--
-- 元に戻したいとき：
--   drop trigger if exists guard_employee_request_requirement on public.employees;
--   alter table public.employees
--     drop column if exists shift_request_requirement,
--     drop column if exists performance_requirement,
--     drop column if exists commute_claim_requirement;
--   （そのあと 73b の do ブロックを流し直してビューを戻してください）


begin;

do $do$
begin
  if to_regprocedure('public.employee_sensitive_columns()') is null then
    raise exception '先に 71a_employee_visible_view.sql を適用してください';
  end if;
end $do$;


-- ------------------------------------------------------------
-- ① 列を足す
-- ------------------------------------------------------------
alter table public.employees
  add column if not exists shift_request_requirement  text,
  add column if not exists performance_requirement    text,
  add column if not exists commute_claim_requirement  text;

-- 決められた値以外が入らないようにする
do $do$
declare c text;
begin
  foreach c in array array['shift_request_requirement',
                           'performance_requirement',
                           'commute_claim_requirement']
  loop
    execute format('alter table public.employees drop constraint if exists %I',
                   'employees_' || c || '_check');
    execute format(
      'alter table public.employees add constraint %I check (%I is null or %I in (''exempt'', ''required''))',
      'employees_' || c || '_check', c, c);
  end loop;
  raise notice '値の制限を付けました：3列';
end $do$;


-- ------------------------------------------------------------
-- ② マスター管理者だけが変えられるようにする
-- ------------------------------------------------------------
create or replace function public.guard_employee_request_requirement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cols text[] := array['shift_request_requirement',
                       'performance_requirement',
                       'commute_claim_requirement'];
  col  text;
  o    jsonb := to_jsonb(old);
  n    jsonb := to_jsonb(new);
begin
  -- サーバー側の処理（Edge Function）はそのまま通す
  if auth.uid() is null then
    return new;
  end if;

  -- マスター管理者はそのまま通す
  if public.is_master_admin() then
    return new;
  end if;

  foreach col in array cols loop
    if n -> col is distinct from o -> col then
      raise exception '申請の対象（シフト希望・実績入力・交通費申請）を変更できるのはマスター管理者だけです'
        using errcode = '42501';
    end if;
  end loop;

  return new;
end $$;

-- トリガー関数は REST から直接呼べないようにする（76番と同じ扱い）
revoke execute on function public.guard_employee_request_requirement()
  from anon, authenticated, public;

drop trigger if exists guard_employee_request_requirement on public.employees;
create trigger guard_employee_request_requirement
  before update on public.employees
  for each row execute function public.guard_employee_request_requirement();


-- ------------------------------------------------------------
-- ③ ビューと列の権限を作り直す（73b と同じ組み立て方）
--    隠す列の一覧は変えない。新しい3列は管理者にも見える
-- ------------------------------------------------------------
do $do$
declare
  sensitive text[] := public.employee_sensitive_columns();
  r record;
  parts text[] := '{}';
  hidden text[] := '{}';
  shown  text[] := '{}';
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

  if array_length(shown, 1) is null then
    raise exception '見せる列がありません。隠す列の指定を確認してください';
  end if;

  execute 'drop view if exists public.employees_visible';
  execute format(
    'create view public.employees_visible as select %s from public.employees e '
    || 'where e.id = auth.uid() or public.is_admin()',
    array_to_string(parts, ', '));
  execute 'alter view public.employees_visible set (security_invoker = false)';
  -- 利用者が書いた条件が、ビュー自身の絞り込みより先に評価されるのを防ぐ（75番）
  execute 'alter view public.employees_visible set (security_barrier = true)';
  execute 'grant select on public.employees_visible to authenticated';

  execute 'revoke select on public.employees from authenticated';
  execute format('grant select (%s) on public.employees to authenticated',
    (select string_agg(quote_ident(c), ', ') from unnest(shown) c));
  execute 'grant update on public.employees to authenticated';

  raise notice '隠す列：%件 / 見せる列：%件',
    array_length(hidden, 1), array_length(shown, 1);
end $do$;

commit;


notify pgrst, 'reload schema';


-- ------------------------------------------------------------
-- 確認
-- ------------------------------------------------------------
-- (1) 3 が返れば成功（列が3つ足された）
select count(*) as "足した列（3なら成功）"
from information_schema.columns
where table_schema = 'public' and table_name = 'employees'
  and column_name in ('shift_request_requirement',
                      'performance_requirement',
                      'commute_claim_requirement');

-- (2) 3 が返れば成功（ビューから読める）
select count(*) as "ビューに入った列（3なら成功）"
from information_schema.columns
where table_schema = 'public' and table_name = 'employees_visible'
  and column_name in ('shift_request_requirement',
                      'performance_requirement',
                      'commute_claim_requirement');

-- (3) 1 が返れば成功（トリガーが付いた）
select count(*) as "トリガー（1なら成功）"
from pg_trigger
where tgname = 'guard_employee_request_requirement' and not tgisinternal;

-- (4) 0 が返れば成功（既存のスタッフは誰も設定されていない＝画面は変わらない）
select count(*) as "設定済みのスタッフ（0なら成功）"
from public.employees
where shift_request_requirement is not null
   or performance_requirement is not null
   or commute_claim_requirement is not null;
