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
union all
select '34 シフト希望の募集',
       case when to_regclass('public.shift_request_periods') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '35 シフト希望の対象者',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shift_request_periods'
                and column_name = 'target_employee_ids')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '36 シフト希望の提出（対象月・回答）',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'shift_requests'
                and column_name = 'target_month')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '37 シフト希望の回答テーブル',
       case when to_regclass('public.shift_request_answers') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '38 実績の提出日時',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'staff_new_performance'
                and column_name = 'submitted_at')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '39 お知らせの既読（update ポリシー）',
       case when exists (
              select 1 from pg_policies
              where schemaname = 'public' and tablename = 'notifications'
                and cmd = 'UPDATE')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '40 性別',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'employees'
                and column_name = 'gender')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '41 賞与明細',
       case when to_regclass('public.bonus_records') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '42 シフト外の打刻',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'attendance_records'
                and column_name = 'off_shift')
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '43 確定シフトの取り込み',
       case when to_regclass('public.shift_assignments') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '44 シフト連携（氏名対応表・変更履歴）',
       case when to_regclass('public.shift_name_aliases') is not null
            then '✅ 実行済み' else '❌ 未実行' end
union all
select '45 【セキュリティ】employees の列ガード',
       case when exists (
              select 1 from pg_trigger
              where tgrelid = to_regclass('public.employees')
                and tgname = 'guard_employee_self_update')
            then '✅ 実行済み' else '❌ 未実行' end
order by 1;
