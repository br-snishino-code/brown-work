-- 68_attendance_schedule_year.sql
--
-- 出勤規定日数を年度ごとに登録できるようにする
--
-- 直す問題：
--   出勤規定日数は「月（1〜12）」だけで保存されていて、年を持っていませんでした。
--   そのため一度設定すると毎年同じ値が使われ、年によって営業日数が変わっても
--   反映できませんでした。
--
-- 決めたこと：
--   ・年度は4月〜翌3月（2026年度＝2026年4月〜2027年3月）
--   ・保存は「暦年＋月」で持つ。画面で年度ごとにまとめて表示する。
--     給与計算は暦年の年月で引くため、変換を挟まないほうが取り違えが起きない。
--   ・いま登録されている値は 2026年度の値として移す
--     （4〜12月 → 2026年、1〜3月 → 2027年）
--   ・新しい年度は空の状態から始める
--
-- ⚠ 移したあとの注意
--   2027年度（2027年4月〜）は空になります。
--   その年度の給与計算で日割りを使う場合は、事前に登録してください。
--   登録が無い月は、これまでどおり日割りなしで計算します。
--
-- 何度流しても同じ結果になります（2回目以降は何も起きません）。
--
-- ※ Supabase の SQL Editor にそのまま貼り付けて実行できます。
--    （psql 専用の記法は使っていません）


-- ========================================================
-- 1. 年の列を足す
-- ========================================================
alter table public.group_attendance_schedules
  add column if not exists year integer;

alter table public.employee_attendance_schedules
  add column if not exists year integer;


-- ========================================================
-- 2. いまの値を対象の年度に移す（年が空の行だけ）
-- ========================================================
do $do$
declare
  -- 移す先の年度。別の年度に移したい場合はこの数字だけ変えてください。
  -- 2026 とすると 4〜12月は2026年、1〜3月は2027年として登録されます。
  v_target_fiscal_year integer := 2026;
  v_group_count integer;
  v_employee_count integer;
begin
  update public.group_attendance_schedules
  set year = case when month >= 4 then v_target_fiscal_year else v_target_fiscal_year + 1 end
  where year is null;
  get diagnostics v_group_count = row_count;

  update public.employee_attendance_schedules
  set year = case when month >= 4 then v_target_fiscal_year else v_target_fiscal_year + 1 end
  where year is null;
  get diagnostics v_employee_count = row_count;

  raise notice '%年度に移しました：グループ別 %件／個人別 %件',
    v_target_fiscal_year, v_group_count, v_employee_count;
end $do$;


-- ========================================================
-- 3. 年を必須にする
-- ========================================================
do $do$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'group_attendance_schedules'
      and column_name = 'year' and is_nullable = 'YES'
  ) then
    alter table public.group_attendance_schedules alter column year set not null;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'employee_attendance_schedules'
      and column_name = 'year' and is_nullable = 'YES'
  ) then
    alter table public.employee_attendance_schedules alter column year set not null;
  end if;
end $do$;


-- ========================================================
-- 4. 重複を防ぐ条件を「年＋月」に付け替える
-- ========================================================
-- 制約の名前は作られた時期によって違うため、列の組み合わせで探して外す
do $do$
declare
  con record;
begin
  -- group_attendance_schedules の (group_name, month) の一意制約を外す
  for con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'group_attendance_schedules'
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['group_name', 'month']
  loop
    execute format('alter table public.group_attendance_schedules drop constraint %I', con.conname);
    raise notice '外しました: %', con.conname;
  end loop;

  -- employee_attendance_schedules の (employee_id, month) の一意制約を外す
  for con in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'employee_attendance_schedules'
      and c.contype = 'u'
      and (
        select array_agg(a.attname::text order by a.attname::text)
        from unnest(c.conkey) k
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k
      ) = array['employee_id', 'month']
  loop
    execute format('alter table public.employee_attendance_schedules drop constraint %I', con.conname);
    raise notice '外しました: %', con.conname;
  end loop;
end $do$;

-- 新しい条件を付ける
do $do$
begin
  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'group_attendance_schedules'
      and c.conname = 'group_attendance_schedules_group_year_month_key'
  ) then
    alter table public.group_attendance_schedules
      add constraint group_attendance_schedules_group_year_month_key
      unique (group_name, year, month);
  end if;

  if not exists (
    select 1 from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'employee_attendance_schedules'
      and c.conname = 'employee_attendance_schedules_employee_year_month_key'
  ) then
    alter table public.employee_attendance_schedules
      add constraint employee_attendance_schedules_employee_year_month_key
      unique (employee_id, year, month);
  end if;
end $do$;


notify pgrst, 'reload schema';


-- ========================================================
-- 確認
-- ========================================================
select 'グループ別：年の列' as 確認項目,
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'group_attendance_schedules'
           and column_name = 'year' and is_nullable = 'NO'
       ) then '追加済み' else '未追加' end as 結果,
       '追加済み であれば正常' as 期待値

union all

select '個人別：年の列',
       case when exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'employee_attendance_schedules'
           and column_name = 'year' and is_nullable = 'NO'
       ) then '追加済み' else '未追加' end,
       '追加済み であれば正常'

union all

select 'グループ別：年＋月の重複防止',
       case when exists (
         select 1 from pg_constraint
         where conname = 'group_attendance_schedules_group_year_month_key'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常'

union all

select '個人別：年＋月の重複防止',
       case when exists (
         select 1 from pg_constraint
         where conname = 'employee_attendance_schedules_employee_year_month_key'
       ) then '設定済み' else '未設定' end,
       '設定済み であれば正常'

union all

select '移した件数（グループ別）',
       count(*)::text || '件',
       '登録済みの件数と一致していれば正常'
from public.group_attendance_schedules

union all

select '移した件数（個人別）',
       count(*)::text || '件',
       '登録済みの件数と一致していれば正常'
from public.employee_attendance_schedules

union all

select '登録されている年',
       coalesce((select string_agg(distinct y::text, '、' order by y::text) from (
         select year as y from public.group_attendance_schedules
         union
         select year from public.employee_attendance_schedules
       ) z), 'なし'),
       '2026、2027 であれば正常';
