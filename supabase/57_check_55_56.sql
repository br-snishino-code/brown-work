-- 57_check_55_56.sql
--
-- 55番・56番が実行できているかを確かめるだけのSQL。
-- 読み取るだけで、何も変更しません。何度実行しても大丈夫です。
--
-- 実行方法：Supabase → SQL Editor にこの中身を貼り付けて Run
--
-- 見方：
--   「結果」の列が すべて ✅ なら、55番・56番は実行済みです。
--   ❌ があれば、その行の案内にあるSQLを実行してください。

select '① 55番：修正記録の列' as 確認項目,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public'
                     and table_name in ('staff_new_performance', 'staff_existing_performance')
                     and column_name in ('admin_edited_at', 'admin_edited_by_id', 'admin_edited_by_name')) = 6
            then '✅ あり（6列）'
            else '❌ 足りません（'
                 || (select count(*)::text from information_schema.columns
                      where table_schema = 'public'
                        and table_name in ('staff_new_performance', 'staff_existing_performance')
                        and column_name in ('admin_edited_at', 'admin_edited_by_id', 'admin_edited_by_name'))
                 || '／6列）→ 55_performance_admin_edit.sql を実行' end as 結果

union all
select '② 55番：実績のアクセス制限',
       case when (select count(*) from pg_policies
                   where schemaname = 'public'
                     and tablename in ('staff_new_performance', 'staff_existing_performance')) = 8
            then '✅ あり（8件）'
            else '❌ 違います（'
                 || (select count(*)::text from pg_policies
                      where schemaname = 'public'
                        and tablename in ('staff_new_performance', 'staff_existing_performance'))
                 || '件／8件）→ 55_performance_admin_edit.sql を実行' end

union all
select '③ 55番：なりすまし防止のガード',
       case when (select count(*) from pg_trigger
                   where tgname = 'guard_performance_self_update' and not tgisinternal) = 2
            then '✅ あり（2件）'
            else '❌ ありません → 55_performance_admin_edit.sql を実行' end

union all
select '④ 55番：ログインしていない人の権限',
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema = 'public'
                     and table_name in ('staff_new_performance', 'staff_existing_performance')
                     and grantee = 'anon') = 0
            then '✅ なし（正常）'
            else '❌ 残っています → 55_performance_admin_edit.sql を実行' end

union all
-- 56番の関数を直接呼ぶと、未実行の環境では文の解析でエラーになる。
-- そのため、関数の有無は to_regprocedure で調べる。
select '⑤ 56番：入力期限の判定',
       case when to_regprocedure('public.perf_deadline_date(int,int)') is null
            then '❌ ありません → 56_performance_deadline.sql を実行'
            else '✅ あり' end

union all
select '⑥ 56番：いまの入力期限の設定',
       case when to_regprocedure('public.perf_deadline_date(int,int)') is null
            then '－（56番が未実行）'
            when coalesce(nullif((select value from public.app_settings
                                   where key = 'performance_deadline_day'), ''), '0') = '0'
            then '締切なし（スタッフはいつでも過去分を直せます）'
            else '翌月'
                 || (select value from public.app_settings where key = 'performance_deadline_day')
                 || '日まで' end

order by 1;
