-- 55_performance_admin_edit.sql
--
-- 管理者がスタッフの実績を直せるようにする（＋直した記録を残す）
--
-- 背景：
--   これまで実績（staff_new_performance / staff_existing_performance）は
--   スタッフ本人が入力するだけで、管理者が直す画面がありませんでした。
--   入力間違いがあると、本人に修正・再提出してもらうしかない状態でした。
--
--   また、この2つの表は 01_schema.sql ではなく Supabase の SQL Editor で
--   直接作られているため、RLS ポリシーの中身がファイルに残っていません。
--   そのため、この SQL では「今あるポリシーを全部消して、必要なものを
--   あらためて作り直す」形にしています。
--
-- この SQL でやること：
--   ① 管理者が直した記録を残す列を3つ追加する
--        admin_edited_at       … 直した日時
--        admin_edited_by_id    … 直した管理者
--        admin_edited_by_name  … 直した管理者の氏名（表示用）
--   ② RLS ポリシーを作り直す
--        本人   … 自分の行だけ、読む・作る・直すができる
--        管理者 … 全員の行を、読む・作る・直す・消すができる
--        それ以外（anon・他人）… 一切触れない
--   ③ 本人が「管理者が直した記録」を書き換えられないようにする
--        スタッフが自分で admin_edited_* を入れて、管理者が直したように
--        見せかけることを防ぐ。employee_id の付け替えも止める。
--
-- 画面の動きで変わらないこと：
--   スタッフの実績入力（一時保存・提出・出し直し）はこれまでどおりです。
--   インセンティブ集計の表示・グループ目標フラグもこれまでどおりです。
--
-- 実行方法：Supabase → SQL Editor にこの中身を貼り付けて Run
--           （アプリを更新する前に、こちらを先に実行してください）


-- ============================================================
-- ① 管理者が直した記録を残す列
-- ============================================================
alter table public.staff_new_performance
  add column if not exists admin_edited_at timestamptz,
  add column if not exists admin_edited_by_id uuid,
  add column if not exists admin_edited_by_name text;

alter table public.staff_existing_performance
  add column if not exists admin_edited_at timestamptz,
  add column if not exists admin_edited_by_id uuid,
  add column if not exists admin_edited_by_name text;


-- ============================================================
-- ② RLS ポリシーを作り直す
-- ============================================================
-- caller_is_admin() は 51_self_approval_guard.sql で作った関数です。
-- 万一まだ無い場合はここで作ります（中身は51番と同じ）。
create or replace function public.caller_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $func$
  select exists (
    select 1 from public.employees e
     where e.id = auth.uid() and e.role in ('admin', 'master_admin')
  );
$func$;

do $do$
declare
  t text;
  p record;
  targets text[] := array['staff_new_performance', 'staff_existing_performance'];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      raise notice 'スキップ（表がありません）: %', t;
      continue;
    end if;

    -- 今あるポリシーを全部消す（中身が分からないため、作り直す）
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
      raise notice '% の古いポリシーを削除しました: %', t, p.policyname;
    end loop;

    execute format('alter table public.%I enable row level security', t);

    -- 読む：本人の行、または管理者なら全員の行
    execute format(
      'create policy "本人と管理者が読める" on public.%I for select to authenticated '
      || 'using (employee_id = auth.uid() or public.caller_is_admin())', t);

    -- 作る：本人は自分の行だけ。管理者は誰の行でも
    execute format(
      'create policy "本人と管理者が作れる" on public.%I for insert to authenticated '
      || 'with check (employee_id = auth.uid() or public.caller_is_admin())', t);

    -- 直す：本人は自分の行だけ。管理者は誰の行でも
    -- （using と with check の両方に付けて、他人の行への付け替えも防ぐ）
    execute format(
      'create policy "本人と管理者が直せる" on public.%I for update to authenticated '
      || 'using (employee_id = auth.uid() or public.caller_is_admin()) '
      || 'with check (employee_id = auth.uid() or public.caller_is_admin())', t);

    -- 消す：管理者だけ
    execute format(
      'create policy "管理者だけが消せる" on public.%I for delete to authenticated '
      || 'using (public.caller_is_admin())', t);

    -- anon（ログインしていない人）には表の権限そのものを渡さない
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    raise notice 'ポリシーを作り直しました: %', t;
  end loop;
end $do$;


-- ============================================================
-- ③ 本人が「管理者が直した記録」を書き換えられないようにする
-- ============================================================
-- RLS は「どの行を触れるか」までしか見ないため、列の守りはトリガーで行う。
-- 管理者・マスター管理者と、サーバー側（service_role）は対象外。
create or replace function public.guard_performance_self_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $func$
begin
  -- ログインしていない呼び出し（service_role / サーバー処理）は素通し
  if auth.uid() is null then
    return new;
  end if;

  -- 管理者は何でも変更できる
  if public.caller_is_admin() then
    return new;
  end if;

  -- ここから下は本人の操作

  -- 他人の行として作る・他人に付け替えるのを止める
  if new.employee_id is distinct from auth.uid() then
    raise exception '他のスタッフの実績は変更できません';
  end if;
  if tg_op = 'UPDATE' and old.employee_id is distinct from new.employee_id then
    raise exception '実績の持ち主は変更できません';
  end if;

  -- 管理者が直した記録は本人には触らせない
  if tg_op = 'INSERT' then
    if new.admin_edited_at is not null
       or new.admin_edited_by_id is not null
       or coalesce(new.admin_edited_by_name, '') <> '' then
      raise exception '管理者の修正記録は変更できません';
    end if;
  else
    if new.admin_edited_at is distinct from old.admin_edited_at
       or new.admin_edited_by_id is distinct from old.admin_edited_by_id
       or new.admin_edited_by_name is distinct from old.admin_edited_by_name then
      raise exception '管理者の修正記録は変更できません';
    end if;
  end if;

  return new;
end;
$func$;

do $do$
declare
  t text;
  targets text[] := array['staff_new_performance', 'staff_existing_performance'];
begin
  foreach t in array targets loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop trigger if exists guard_performance_self_update on public.%I', t);
    execute format(
      'create trigger guard_performance_self_update before insert or update on public.%I '
      || 'for each row execute function public.guard_performance_self_update()', t);
    raise notice 'トリガーを設定しました: %', t;
  end loop;
end $do$;

notify pgrst, 'reload schema';


-- ============================================================
-- 確認（1つの表にまとめて出します）
-- ============================================================
select '追加した列' as 確認項目,
       (select count(*)::text || '／6列'
          from information_schema.columns
         where table_schema = 'public'
           and table_name in ('staff_new_performance', 'staff_existing_performance')
           and column_name in ('admin_edited_at', 'admin_edited_by_id', 'admin_edited_by_name')) as 結果,
       '6／6列 であれば正常' as 期待値
union all
select 'ポリシー（新規実績）',
       (select count(*)::text || '件' from pg_policies
         where schemaname = 'public' and tablename = 'staff_new_performance'),
       '4件 であれば正常'
union all
select 'ポリシー（既存実績）',
       (select count(*)::text || '件' from pg_policies
         where schemaname = 'public' and tablename = 'staff_existing_performance'),
       '4件 であれば正常'
union all
select 'トリガー',
       (select count(*)::text || '件' from pg_trigger
         where tgname = 'guard_performance_self_update' and not tgisinternal),
       '2件 であれば正常'
union all
select 'anon の権限',
       (select coalesce(count(*)::text, '0') || '件' from information_schema.role_table_grants
         where table_schema = 'public'
           and table_name in ('staff_new_performance', 'staff_existing_performance')
           and grantee = 'anon'),
       '0件 であれば正常';


-- ============================================================
-- 元に戻したいとき（この下だけを選んで実行）
-- ============================================================
-- do $do$
-- declare t text; targets text[] := array['staff_new_performance', 'staff_existing_performance'];
-- begin
--   foreach t in array targets loop
--     execute format('drop trigger if exists guard_performance_self_update on public.%I', t);
--   end loop;
-- end $do$;
-- ※ 列とポリシーはそのままでも画面は動きます（管理者の編集ができなくなるだけです）
