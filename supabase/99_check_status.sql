-- 99_check_status.sql
--
-- どのSQLが実行済みかを一覧で確認するためのファイル。
-- データは一切変更しません（読み取りだけ）。何度実行しても安全です。
--
-- 実行方法：Supabase → SQL Editor → New query に貼り付けて Run
-- 「❌ 未実行」の行があれば、同じフォルダの該当ファイルを実行してください。

select '27 通知メールの送信先（app_settings）' as 確認項目,
       case when to_regclass('public.app_settings') is not null
            then '✅ 実行済み' else '❌ 未実行' end as 状態
union all
select '28 本人による交通費の修正',
       case when exists (
              select 1 from pg_policies
              where schemaname = 'public' and tablename = 'commute_expense_claims'
                and policyname = 'own commute claim update')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '29 交通費の列（対象月・明細・状態など）',
       case when (
              select count(*) from information_schema.columns
              where table_schema = 'public' and table_name = 'commute_expense_claims'
                and column_name in ('target_month','submitted_date','items','total_amount',
                                    'status','admin_comment','decided_at','created_at')
            ) = 8
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '30 月次勤怠の確定申請',
       case when to_regclass('public.monthly_attendance_confirmations') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '31 交通費の承認をマスター管理者のみに',
       case when exists (
              select 1 from pg_policies
              where schemaname = 'public' and tablename = 'commute_expense_claims'
                and policyname = 'commute_expense_claims_update'
                and qual like '%master_admin%')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '32 交通費の一時保存（draft）',
       case when to_regclass('public.commute_expense_claims') is not null
             and not exists (
              select 1 from pg_constraint
              where conrelid = to_regclass('public.commute_expense_claims')
                and contype = 'c'
                and pg_get_constraintdef(oid) ilike '%status%')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '33 交通費の申請方法（まとめて／個別）',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'commute_claim_mode')
            then '✅ 実行済み' else '❌ 未実行' end
order by 1;
