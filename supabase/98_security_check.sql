-- 98_security_check.sql
--
-- セキュリティ監査の「現状確認」用。読み取りだけで、データは一切変更しません。
-- 何度実行しても安全です。
--
-- 実行方法：Supabase → SQL Editor → New query に「この下の select 文すべて」を
--           貼り付けて Run。結果が1つの表にまとまって出ます。
--           結果をすべてコピーしてお知らせください。
--
-- 出てくる区分：
--   ① RLS        … 行単位の鍵が有効か（❌ 無効 の行は誰でも読み書きできる可能性）
--   ② ポリシー   … 誰がどの操作をできるか
--   ③ 関数       … is_admin() が master_admin を管理者として扱っているか
--   ④ その他     … 旧 app_state の有無、role の種類

with rls as (
  select
    '① RLS' as 区分,
    c.relname as 項目,
    case when c.relrowsecurity then '✅ 有効' else '❌ 無効' end
      || '（ポリシー '
      || (select count(*) from pg_policies p
           where p.schemaname = 'public' and p.tablename = c.relname)
      || '件）' as 内容
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
pol as (
  select
    '② ポリシー',
    tablename || ' / ' || policyname,
    cmd
      || ' ｜対象:' || array_to_string(roles, ',')
      || ' ｜読:'   || coalesce(qual, '-')
      || ' ｜書:'   || coalesce(with_check, '-')
  from pg_policies
  where schemaname = 'public'
),
fn as (
  select
    '③ 関数',
    p.proname,
    left(regexp_replace(pg_get_functiondef(p.oid), '[[:space:]]+', ' ', 'g'), 600)
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('is_admin', 'is_master_admin')
),
etc as (
  select '④ その他', '旧 app_state テーブル',
         case when to_regclass('public.app_state') is null
              then '✅ 削除済み' else '⚠️ 残っています' end
  union all
  select '④ その他', 'employees の role の値',
         coalesce((select string_agg(distinct role, ' / ') from public.employees), '（0件）')
  union all
  select '④ その他', 'employees の role の CHECK 制約',
         coalesce(
           (select pg_get_constraintdef(con.oid)
              from pg_constraint con
              join pg_class cl on cl.oid = con.conrelid
             where cl.relname = 'employees' and con.contype = 'c'
               and pg_get_constraintdef(con.oid) like '%role%'
             limit 1),
           '（なし）')
  union all
  select '④ その他', '45 列ガードの適用',
         case when exists (
                select 1 from pg_trigger
                 where tgrelid = to_regclass('public.employees')
                   and tgname = 'guard_employee_self_update')
              then '✅ 適用済み' else '❌ 未適用' end
)
select * from rls
union all select * from pol
union all select * from fn
union all select * from etc
order by 1, 2;
